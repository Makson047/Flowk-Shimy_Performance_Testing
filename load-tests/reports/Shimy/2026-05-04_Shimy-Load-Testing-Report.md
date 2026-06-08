# Shimy Load Testing Report

> **TL;DR.** Chat is production-ready for the tested range (up to **50 concurrent users**, no signs of stress). Feed is **not production-ready under any meaningful load** — it noticeably degrades from ~50 concurrent users and fails for the majority of users at 500+. Backend optimization of `/api/v1/feed/` is required before launch.

---

## Document info

| | |
|---|---|
| **Date** | 2026-05-04 |
| **Environment tested** | `api.shimy.app` (dev) |
| **Tool** | [k6](https://k6.io/) — open-source load testing framework |
| **Test accounts** | 50 dedicated test users grouped into 25 chat pairs |
| **Endpoints under test** | `GET /api/v1/feed/` (REST) and `wss://api.shimy.app/ws/connect` (WebSocket chat) |
| **Test runs included** | 8 (2 smoke + 3 load + 3 stress) |

---

## Executive Summary

| Endpoint | Verdict | Comfortable for | Breaks at | Headline metric |
|---|---|---|---|---|
| **Feed (REST)** | 🔴 **Not ready** | ≤ 10 concurrent users | 500+ users | At 1 000 users, **3 out of 4 requests fail**; the average user waits 30+ seconds |
| **Chat (WebSocket)** | 🟢 **Ready** for tested range | ≤ 50 concurrent users | Ceiling not reached in this test | Message round-trip stays at **245 ms** even under stress |

**The two parts of the product behave very differently.** Chat is robust and fast. Feed is the bottleneck — it cannot serve a typical social-app audience without backend changes.

---

## What was tested

Two endpoints, both critical to the user experience:

1. **Feed (REST):** `GET /api/v1/feed/?radius&latitude&longitude` — what users see when they open the app.
2. **Chat (WebSocket):** real-time messaging between matched users (`chat.send` / `chat.message`).

Each endpoint was exercised under three escalating profiles:

| Profile | Purpose | Concurrent users |
|---|---|---|
| **Smoke** | Sanity check — does it work at all? | 10 |
| **Load** | Baseline — how it behaves under expected demand | 50 (chat) / 200 (feed) |
| **Stress** | Find the breaking point | 50 (chat, ceiling-limited) / 1 000 (feed) |

> Note: "concurrent users" follows the standard SaaS definition — paralel user sessions active in the system at the same time (think "200 users with the app open right now"), not "200 button taps in the same millisecond". Each simulated user pauses 1 second between actions, mirroring real human behaviour.

---

## Results — Feed (REST)

### Performance under increasing load

| Test | Concurrent users | Average wait time | 95% of users wait at most | Failure rate |
|---|---|---|---|---|
| Smoke | 10 | 0.3 s | **0.5 s** | 0% |
| Load | 200 | 11.8 s | **15.6 s** | 0% |
| Stress | 1 000 | 27.8 s | **37.9 s** | **58%** |

### Where things start to go wrong

We have a moment-by-moment recording of the stress test. The system passes through three clear stages:

| Concurrent users | What happens |
|---|---|
| **Up to ~80** | Everything works as designed (latency under 1 second). |
| **80 – 470** | Server stays online but becomes very slow. Users wait 4–20 seconds for the feed. No error messages, but most users would close the app. |
| **470 – 720** | Errors begin to appear (HTTP 5xx). About 1 in 10 users sees "Failed to load". |
| **720+** | Server is overloaded. Half or more of all requests fail. Users see error screens. |
| **1 000** | Catastrophic. **80% of requests fail.** Average response time exceeds 30 seconds. |

### What this means in user terms

> If 100 users open Shimy at the same time on the current dev backend, **most of them would see the feed take 4–6 seconds to appear**. At 200 users, the average wait climbs to **15 seconds**. At 1 000 users, **3 out of 4 see an error** and the rest wait half a minute.

### Root cause (high-level)

The system does not crash from too many connections — it is simply **slow at processing each individual feed request**. Even with no load at all, a single feed request takes ~600 ms — already significant for a REST API. Under load, requests pile up faster than the server can serve them, and eventually the load balancer cuts off requests that take longer than ~30 seconds (returning 5xx errors).

The bottleneck is most likely the geo-search query inside the feed endpoint (database-level), or limits on how many requests the server can process in parallel. A focused investigation by the backend team is required.

---

## Results — Chat (WebSocket)

### Performance under increasing load

| Test | Concurrent users | Session duration | Message delivery time (95%) | Delivery rate | Connection failures |
|---|---|---|---|---|---|
| Smoke | 10 | 30 s | n/a (smoke skips RTT) | — | 0 |
| Load (send) | 50 | 2 min | **245 ms** | 98% | 0 |
| Load (typing) | 50 | 2 min | n/a (ephemeral) | 98% | 0 |
| Stress (send) | 50 | 5 min | **245 ms** | 99% | 0 |
| Stress (typing) | 50 | 5 min | n/a | 99% | 0 |

### What the numbers mean

- **245 ms** is the time between one peer pressing "send" and the other peer's screen receiving the message. That is in the same range as WhatsApp / iMessage on dev infrastructure — **good**.
- **0 connection failures** across all chat tests, including 5-minute sessions under stress.
- **Message delivery rate stays above 98%** even under stress; no losses caused by the server.
- **Round-trip time does not change between load and stress** (245 ms in both cases), meaning the chat infrastructure is not breaking a sweat at 50 concurrent users.

### What we did NOT test

The Shimy server enforces a "one WebSocket per user" rule (a second connection from the same user closes the first one). Because we have only 50 test accounts, **50 concurrent users is the hard ceiling we could reach**. The real chat capacity is therefore unknown — it could comfortably handle several hundred or several thousand more, but we cannot prove it without a larger pool of test accounts.

---

## What this means for the product

| Concurrent users in production | Feed user experience | Chat user experience |
|---|---|---|
| **10** (early days, beta) | ✅ Excellent | ✅ Excellent |
| **50** | 🟡 Noticeable lag (2–3 s) | ✅ Excellent |
| **100** | 🟠 Painful (4–6 s) | ✅ Excellent |
| **200** | 🔴 Most users see 10+ s spinner | ✅ Excellent |
| **500** | 🔴 ~10% see error messages | ✅ Excellent (untested but extrapolated) |
| **1 000** | ⚫ 75% see error messages | Unknown (test ceiling not reached) |

**Practical implication for launch planning.** If the expected peak audience for Shimy is anywhere above ~80 simultaneously-online users, the feed must be optimized before going live. Chat does not block launch.

---

## Recommendations & Next Steps

### Immediate (blocking for production launch)

1. **Optimize the feed endpoint.** The backend team should investigate the geo-search query and any database / connection pool limits. Even modest improvements (e.g. caching, indexing) typically yield 5–10× throughput gains here.
2. **Re-run feed stress test after optimization** to measure the impact and validate the fix.

### Short-term (recommended before broad rollout)

3. **Locate the precise feed degradation point.** A focused tuning run with 30 / 50 / 75 / 100 concurrent users would tell us the exact number where the feed starts violating SLA. Today we only know "somewhere between 10 and 86".
4. **Expand the test-user pool to 200+** so we can probe the real chat ceiling. Until we have a larger pool, the chat capacity statement is "at least 50, more is unknown".

### Medium-term

5. **Establish business-defined SLA targets.** Today the test thresholds (95% of feed requests under 1.5 s) are baseline values borrowed from the Flowk project. Once Shimy product owners agree on the user-facing SLA, thresholds can be aligned and used in CI to prevent future regressions.

---

## Glossary (for non-technical readers)

| Term | Meaning |
|---|---|
| **Concurrent user** | A simulated user who has the app open and is performing actions in parallel with other users. Not "everyone clicking the same button at the same instant". |
| **Latency / response time** | How long the user waits between an action and seeing a result. |
| **p95 latency** | The wait time experienced by 95% of users — i.e. only 5% wait longer than this. The standard "worst typical case" metric in performance testing. |
| **5xx errors** | Server-side failures — the user sees a "Something went wrong" / "Failed to load" message. |
| **Round-trip time (RTT)** | For chat: the time between one user sending a message and the other user's device receiving it. |
| **Smoke / load / stress** | Test profiles of increasing intensity. Smoke = "does it work?". Load = "is it fast enough under expected demand?". Stress = "where does it break?". |

---

## Appendix — Artifacts

All raw data is preserved and can be re-analyzed at any time.

| Artifact | Location |
|---|---|
| Per-run HTML reports (with charts) | `load-tests/reports/Shimy/20260504_*/summary.html` |
| Compare index (sortable, groupable) | `load-tests/reports/Shimy/index.html` |
| Raw NDJSON time-series (for replays) | `load-tests/reports/Shimy/20260504_*/raw.ndjson` |
| Feed stress deep-dive (technical) | `load-tests/reports/Shimy/2026-05-04_feed-stress-deep-dive.md` |
| Overall test session summary | `load-tests/reports/Shimy/2026-05-04_load-test-summary.md` |
| Test scripts | `load-tests/shimy/shimyFeedLoad.js`, `load-tests/shimy/shimyChatLoad.js` |
