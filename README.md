# k6 Load Testing — Flowk & Shimy

Performance/load testing harness built on [k6](https://k6.io/). The project
runs load tests against two apps (Flowk and Shimy), produces rich HTML
reports with timeline charts, and ships helper scripts to seed test data
in the Shimy dev environment.

This README focuses on **Shimy**. Flowk scripts live under
`load-tests/*.js` (top level) and are run the same way through `npm run report`.

---

## Table of contents

1. [Prerequisites](#prerequisites)
2. [Setup — Shimy test users](#setup--shimy-test-users)
3. [Shimy helper scripts](#shimy-helper-scripts)
   - [Bootstrap chats](#bootstrap-chats)
   - [Bootstrap posts](#bootstrap-posts)
   - [Seed demo data (single target user)](#seed-demo-data-single-target-user)
4. [Shimy load tests](#shimy-load-tests)
   - [Feed (REST)](#feed-rest)
   - [Chat (WebSocket)](#chat-websocket)
5. [Environment variables](#environment-variables)
6. [Reports & artifacts](#reports--artifacts)
7. [Common recipes](#common-recipes)

---

## Prerequisites

| Tool | Why | Install |
|---|---|---|
| **k6** ≥ 0.50 | Runs the load tests | `brew install k6` (macOS) or see [k6 install docs](https://grafana.com/docs/k6/latest/set-up/install-k6/) |
| **Node.js** ≥ 18 | Runs the helper scripts and HTML report generator | `brew install node` or use `nvm` |

No `npm install` is needed — the project has zero npm dependencies; helpers
use Node's built-in `fs`/`fetch`/`readline`.

---

## Setup — Shimy test users

All Shimy commands need a pool of test accounts. Credentials live in a
**gitignored** file:

```
load-tests/shimy/.secrets/users.json
```

1. Copy the template:
   ```bash
   cp load-tests/shimy/.secrets/users.example.json \
      load-tests/shimy/.secrets/users.json
   ```
2. Fill `users[]` with real test accounts (50+ recommended). Two users with
   the same `pair_id` form a chat pair.
3. Fill `chats[]` with `chat_id` for each pair (or let
   `shimy:bootstrap-chats` create them via the API).

> The example file is the only thing committed to git. The real
> `users.json` and any `*.bak` backups are ignored.

---

## Shimy helper scripts

One-shot data-management scripts. They are **not** load tests — they just
prepare the dev DB so the load tests have something realistic to hit.

### Bootstrap chats

Creates a chat for every `pair_id` in `users.json` by walking the full
post → response → approve flow. Updates `users.json.chats[]` in place
(with `.bak` backup).

```bash
# Idempotent — only create chats for pairs that don't have one yet
npm run shimy:bootstrap-chats

# Plan only, no API calls
npm run shimy:bootstrap-chats:dry

# Recreate every chat (use after the 3-hour chat-inactivity expiry)
npm run shimy:bootstrap-chats:force
```

### Bootstrap posts

Creates one active post per user from the pool (Shimy enforces "1 active
post per user"). Updates `users.json` with the resulting `post_id` for each
user.

```bash
# Idempotent — only post for users that don't have an active post
npm run shimy:bootstrap-posts

# Plan only
npm run shimy:bootstrap-posts:dry

# DELETE old → POST new for everyone
npm run shimy:bootstrap-posts:force

# DELETE all posts for the entire pool (no creation)
npm run shimy:bootstrap-posts:teardown

# Plan the teardown without hitting the API
npm run shimy:bootstrap-posts:teardown:dry
```

Honoured env knobs:

| Var | Default | Meaning |
|---|---|---|
| `LAT`, `LON` | Vinnytsia (49.1951, 28.3679) | Geo center for the posts |
| `RADIUS_MILES` | 20 | Post visibility radius |
| `JITTER_MILES` | 1.5 | Randomization around the center |
| `USER_LIMIT` | (all users) | Only operate on the first N users |
| `SHIMY_BASE` | `https://api.shimy.app/api/v1` | API base URL |

> `--teardown` intentionally ignores `USER_LIMIT` and wipes posts for the
> whole pool — guaranteeing a clean feed for repeat tests.

### Seed demo data (single target user)

Seeds demo content for a **single target user X** so a manual UI walk-through
shows realistic feed and chat content. Two phases:

1. **Feed** — N pool users each create a post at X's coordinates →
   they appear in X's feed.
2. **Chats** — M *different* pool users each go through the full match
   flow with X → X ends up with M active chats.

Saved state (`load-tests/shimy/.secrets/demo-state.json`) is used by the
teardown command later.

```bash
# Seed (default: 12 feed posts + 12 chats)
npm run shimy:seed-demo

# Plan only
npm run shimy:seed-demo:dry

# Remove everything we created (DELETE all seeded posts)
npm run shimy:seed-demo:teardown
```

Honoured env knobs:

| Var | Default | Meaning |
|---|---|---|
| `TARGET_PHONE` | `+380668968268` | Phone of the demo target user |
| `TARGET_PASSWORD` | `test1234` | Password of the demo target user |
| `TARGET_LAT` | 33.42828810 | Target latitude (Orange County, CA) |
| `TARGET_LON` | -117.61373852 | Target longitude |
| `FEED_POSTS` | 12 | How many feed-only posts to create |
| `CHAT_COUNT` | 12 | How many chats to create with X |
| `POOL_OFFSET` | 0 | Start index into pool users |
| `JITTER_MILES` | 0.3 | Random spread around the target point |

Example — custom target:
```bash
TARGET_PHONE=+380... TARGET_PASSWORD=secret \
  TARGET_LAT=40.7128 TARGET_LON=-74.0060 \
  FEED_POSTS=20 CHAT_COUNT=10 \
  npm run shimy:seed-demo
```

---

## Shimy load tests

All Shimy load tests share three named profiles — **smoke** / **load** /
**stress** — controlled by the `PROFILE` env. Reports are written to
`load-tests/reports/Shimy/<TIMESTAMP>/` and the comparison index at
`load-tests/reports/Shimy/index.html` is refreshed after every run.

### Feed (REST)

Target endpoint: `GET /api/v1/feed/?radius&latitude&longitude`

| Command | Profile | Peak VUs | Approx. duration |
|---|---|---|---|
| `npm run shimy:feed` | load (default) | 200 | ~4.5 min |
| `npm run shimy:feed:smoke` | smoke | 10 | ~70 sec |
| `npm run shimy:feed:load` | load | 200 | ~4.5 min |
| `npm run shimy:feed:stress` | stress | 1 000 | ~6 min |

### Chat (WebSocket)

Target endpoint: `wss://api.shimy.app/ws/connect`

`MODE=send` (default) measures real chat round-trip latency by exchanging
`chat.send` / `chat.message`. `MODE=typing` exercises the lighter
`chat.typing` path (ephemeral, no DB writes).

| Command | Profile | Mode | Peak VUs | Approx. duration |
|---|---|---|---|---|
| `npm run shimy:chat` | load (default) | send | 50 | ~4 min |
| `npm run shimy:chat:smoke` | smoke | send | 10 | ~70 sec |
| `npm run shimy:chat:load` | load | send | 50 | ~4 min |
| `npm run shimy:chat:load:typing` | load | typing | 50 | ~4 min |
| `npm run shimy:chat:stress` | stress | send | 50 | ~10 min |
| `npm run shimy:chat:stress:typing` | stress | typing | 50 | ~10 min |
| `npm run shimy:chat:typing` | load (default) | typing | 50 | ~4 min |

> Chat peak VU is hard-capped to `users.length` (Shimy rejects a second
> WebSocket from the same user with code 4409). For higher chat ceilings,
> add more users to the pool.

---

## Environment variables

These env vars work with **any** of the npm commands above.

| Var | Used by | Effect |
|---|---|---|
| `TIMELINE=1` | All k6 tests | Writes `raw.ndjson` (per-sample) so the HTML report draws line charts over time (VUs/RPS/p95). Recommended for load/stress. |
| `USER_LIMIT=N` | k6 tests + bootstrap helpers | Use only the first N users from the pool. Useful for repeating an earlier comparison after the pool grew. |
| `PROFILE=smoke\|load\|stress` | k6 tests | Selects load profile. Already set by the `:smoke`/`:load`/`:stress` npm aliases. |
| `MODE=send\|typing` | `shimy:chat*` | Selects chat behaviour. Already set by `:typing` aliases. |
| `LAT`, `LON` | feed test + bootstrap-posts | Geo center. |

Examples:
```bash
# Smoke feed with timeline charts and only 20 of the 100 users in pool
USER_LIMIT=20 TIMELINE=1 npm run shimy:feed:smoke

# Stress chat in typing mode against a 50-user subset
USER_LIMIT=50 TIMELINE=1 npm run shimy:chat:stress:typing
```

---

## Reports & artifacts

Every k6 run writes the following inside
`load-tests/reports/Shimy/<TIMESTAMP>/`:

| File | What it is |
|---|---|
| `summary.html` | Main interactive report (auto-opens in browser) |
| `summary.md` | Short TL;DR — verdict + key KPIs |
| `summary.csv` | All metrics, importable into a spreadsheet |
| `summary.json` | Raw k6 summary export |
| `meta.json` | Test file, profile, mode, timestamp (for the compare index) |
| `raw.ndjson` | Per-sample timeline data (only if `TIMELINE=1`) |

The cross-run compare index — `load-tests/reports/Shimy/index.html` — is
regenerated after each run. It supports sortable columns, full-text filter
and "Group by test" view (`testFile + profile + mode`).

---

## Common recipes

### First-time setup
```bash
# 1. Fill users.json with real test accounts (see Setup)
# 2. Create chats for every pair
npm run shimy:bootstrap-chats

# 3. Sanity-check both endpoints
npm run shimy:feed:smoke
npm run shimy:chat:smoke
```

### Full performance session (smoke → load → stress)
```bash
# Refresh chats first — they expire after ~3 hours of inactivity
npm run shimy:bootstrap-chats:force

# Smoke
npm run shimy:feed:smoke
npm run shimy:chat:smoke

# Load (with timeline)
TIMELINE=1 npm run shimy:feed:load
TIMELINE=1 npm run shimy:chat:load
TIMELINE=1 npm run shimy:chat:load:typing

# Stress — wait ~5 min between runs so dev recovers
TIMELINE=1 npm run shimy:feed:stress
TIMELINE=1 npm run shimy:chat:stress
```

### Apples-to-apples re-test after a backend fix
```bash
# Use the same 50-user subset that the previous run used
export USER_LIMIT=50

npm run shimy:bootstrap-chats:force
npm run shimy:feed:smoke
npm run shimy:chat:smoke
TIMELINE=1 npm run shimy:feed:load
TIMELINE=1 npm run shimy:chat:load
TIMELINE=1 npm run shimy:feed:stress
TIMELINE=1 npm run shimy:chat:stress
```

### Manual UI demo for the PM
```bash
# Seed 12 feed posts + 12 chats for the demo target user
npm run shimy:seed-demo

# After the demo, clean up
npm run shimy:seed-demo:teardown
```

### Empty the dev DB of all pool posts (before A/B comparison)
```bash
# Wipes posts for every user in the pool
npm run shimy:bootstrap-posts:teardown
```
