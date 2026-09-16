# Flowk & Shimy k6 Load Testing

This repository is a small load-testing harness built with [k6](https://k6.io/). It supports two families of tests:

- Flowk legacy scenarios under `load-tests/*.js`
- Shimy feed/chat performance tests under `load-tests/shimy/*.js`

The project also includes helper scripts for preparing realistic Shimy test data, generating HTML reports, and comparing multiple runs side by side.

---

## What is in this repo

```text
.
├── README.md
├── package.json
├── scripts/
│   └── k6-run-report.sh          # common wrapper for k6 + report generation
├── load-tests/
│   ├── badgetTest.js
│   ├── discoveryLoadTest.js
│   ├── discoveryLoadTest_test.js
│   ├── feedLoad.js
│   ├── likeLoadTest.js
│   ├── requestFlowks.js
│   ├── showCommentsLoad.js
│   ├── websocketLoad_test.js
│   ├── reports/                  # generated HTML/CSV/JSON reports
│   └── shimy/
│       ├── lib/auth.js
│       ├── shimyFeedLoad.js
│       └── shimyChatLoad.js
├── tools/
│   ├── k6-html-report.mjs
│   ├── k6-compare-index.mjs
│   ├── shimy-bootstrap-chats.mjs
│   ├── shimy-bootstrap-posts.mjs
│   └── shimy-seed-demo.mjs
└── SHIMY-TESTS.md               # detailed Shimy-specific documentation
```

The repository is intentionally lightweight: there are no npm dependencies, and helper scripts rely on Node.js built-ins such as `fs`, `fetch`, and `readline`.

---

## Prerequisites

| Tool | Why | Install |
|---|---|---|
| k6 >= 0.50 | Runs the load scenarios | `brew install k6` |
| Node.js >= 18 | Runs helper scripts and report generation | `brew install node` |

---

## Common execution flow

The main wrapper is:

```bash
./scripts/k6-run-report.sh <path-to-test-file>
```

Examples:

```bash
./scripts/k6-run-report.sh discoveryLoadTest.js
./scripts/k6-run-report.sh shimy/shimyFeedLoad.js
```

Via npm, the project also exposes a number of Shimy aliases:

```bash
npm run shimy:feed
npm run shimy:feed:smoke
npm run shimy:chat
npm run shimy:chat:typing
```

---

## Flowk tests

The legacy Flowk scenarios are placed directly under `load-tests/*.js`. They are ordinary k6 files and can be launched through the shared report runner.

Examples:

```bash
npm run report -- discoveryLoadTest.js
npm run report -- badgetTest.js
npm run report -- likeLoadTest.js
```

The generic report runner creates a timestamped directory under `load-tests/reports/` and also writes summary artifacts, including HTML/CSV/JSON output.

---

## Shimy tests

The Shimy suite is more structured and includes both REST and WebSocket tests:

### Feed test

- File: `load-tests/shimy/shimyFeedLoad.js`
- Endpoint: `GET /api/v1/feed/?radius&latitude&longitude`
- Profiles: `smoke`, `load`, `stress`

```bash
npm run shimy:feed
npm run shimy:feed:smoke
npm run shimy:feed:load
npm run shimy:feed:stress
```

### Chat test

- File: `load-tests/shimy/shimyChatLoad.js`
- Endpoint: `wss://api.shimy.app/ws/connect?token=<jwt>`
- Modes: `send` and `typing`

```bash
npm run shimy:chat
npm run shimy:chat:smoke
npm run shimy:chat:load
npm run shimy:chat:load:typing
npm run shimy:chat:stress
npm run shimy:chat:stress:typing
npm run shimy:chat:typing
```

Common environment variables for the Shimy suite:

```bash
PROFILE=smoke
MODE=typing
USER_LIMIT=50
TIMELINE=1
LAT=33.42828810
LON=-117.61373852
```

---

## Shimy setup and helper scripts

A dedicated Shimy pool lives under the gitignored folder:

```text
load-tests/shimy/.secrets/
├── users.example.json
├── users.json
├── demo-state.json
```

These scripts are not performance tests; they prepare data for realistic load scenarios.

### 1) Bootstrap chats

Creates chats for every pair in `users.json` by walking the match flow.

```bash
npm run shimy:bootstrap-chats
npm run shimy:bootstrap-chats:dry
npm run shimy:bootstrap-chats:force
```

### 2) Bootstrap posts

Creates one active post per user from the pool.

```bash
npm run shimy:bootstrap-posts
npm run shimy:bootstrap-posts:dry
npm run shimy:bootstrap-posts:force
npm run shimy:bootstrap-posts:teardown
npm run shimy:bootstrap-posts:teardown:dry
```

### 3) Seed demo data for one target user

Seeds a realistic feed and chat state for a single target account so product demos look like real data.

```bash
npm run shimy:seed-demo
npm run shimy:seed-demo:dry
npm run shimy:seed-demo:teardown
```

---

## Reports and artifacts

Every k6 run writes a timestamped result folder. For Shimy runs, the output is grouped under:

```text
load-tests/reports/Shimy/<TIMESTAMP>/
```

Artifacts include:

- `summary.html` — interactive report and browser output
- `summary.json` — raw k6 export
- `summary.csv` — tabular metric export
- `summary.md` — short human-readable summary
- `meta.json` — test metadata used by comparison pages
- `raw.ndjson` — per-sample timeline data, if `TIMELINE=1`

The compare page is refreshed automatically and lives at:

```text
load-tests/reports/Shimy/index.html
```

---

## Practical workflow

### First-time check

```bash
cp load-tests/shimy/.secrets/users.example.json \
  load-tests/shimy/.secrets/users.json

npm run shimy:bootstrap-chats
npm run shimy:feed:smoke
npm run shimy:chat:smoke
```

### Full benchmarking pass

```bash
npm run shimy:bootstrap-chats:force

TIMELINE=1 npm run shimy:feed:load
TIMELINE=1 npm run shimy:chat:load
TIMELINE=1 npm run shimy:chat:load:typing

TIMELINE=1 npm run shimy:feed:stress
TIMELINE=1 npm run shimy:chat:stress
```

---

## Notes

- `SHIMY-TESTS.md` is the detailed reference for Shimy-specific scenarios, env vars, and operational caveats.
- `scripts/k6-run-report.sh` is the main orchestration layer and is responsible for writing reports and opening generated HTML output.
- The project is optimized for reproducible test runs and comparison over time rather than for generic app deployment.
