// Shimy — REST feed load test.
//
// Endpoint: GET /api/v1/feed/?radius=2&latitude=...&longitude=...
// Auth:     Bearer JWT (per-VU from token pool).
//
// Run:
//   ./scripts/k6-run-report.sh shimy/shimyFeedLoad.js                # default profile (load)
//   PROFILE=smoke  ./scripts/k6-run-report.sh shimy/shimyFeedLoad.js # tiny check
//   PROFILE=stress ./scripts/k6-run-report.sh shimy/shimyFeedLoad.js # heavy
//
// Override the geo center: LAT=49.19 LON=28.36 ./scripts/k6-run-report.sh ...

import http from 'k6/http';
import { check, sleep } from 'k6';
import { Counter, Trend } from 'k6/metrics';
import {
  SHIMY_BASE_URL,
  signInAll,
  pickForVU,
  randomNearbyCoords,
} from './lib/auth.js';

// ---- LOAD PROFILES --------------------------------------------------------
const PROFILES = {
  smoke: {
    stages: [
      { duration: '15s', target: 10 },
      { duration: '45s', target: 10 },
      { duration: '10s', target: 0 },
    ],
    thresholds: {
      http_req_duration: ['p(95)<1000'],
      http_req_failed: ['rate<0.05'],
    },
  },
  load: {
    stages: [
      { duration: '1m', target: 200 },
      { duration: '3m', target: 200 },
      { duration: '30s', target: 0 },
    ],
    thresholds: {
      'http_req_duration{name:feed}': ['p(95)<800', 'p(99)<1500'],
      http_req_failed: ['rate<0.01'],
    },
  },
  stress: {
    stages: [
      { duration: '1m', target: 500 },
      { duration: '1m', target: 1000 },
      { duration: '3m', target: 1000 },
      { duration: '30s', target: 0 },
    ],
    thresholds: {
      'http_req_duration{name:feed}': ['p(95)<1500'],
      http_req_failed: ['rate<0.05'],
    },
  },
};

const PROFILE_NAME = (__ENV.PROFILE || 'load').toLowerCase();
const PROFILE = PROFILES[PROFILE_NAME];
if (!PROFILE) {
  throw new Error(
    `Unknown PROFILE="${PROFILE_NAME}". Valid: ${Object.keys(PROFILES).join(', ')}`
  );
}

export const options = {
  stages: PROFILE.stages,
  thresholds: PROFILE.thresholds,
  // k6 default Trend stats omit p(50)/p(99); enable both so the report has
  // full latency percentiles instead of "n/a".
  summaryTrendStats: ['avg', 'min', 'med', 'max', 'p(50)', 'p(90)', 'p(95)', 'p(99)'],
};

// ---- CUSTOM METRICS -------------------------------------------------------
// These line up with what the HTML report generator already understands
// (request_success / request_failures), plus Shimy-specific error breakdown.
const reqSuccess = new Counter('request_success');
const reqFailure = new Counter('request_failures');
const err4xx = new Counter('errors_4xx');
const err5xx = new Counter('errors_5xx');
const errNetwork = new Counter('errors_network');
const feedLatency = new Trend('feed_latency_ms', true);

// ---- SETUP: sign in once for the whole pool ------------------------------
export function setup() {
  console.log(`[shimyFeedLoad] profile="${PROFILE_NAME}"`);
  const authPool = signInAll();
  return { authPool };
}

// ---- VU CODE --------------------------------------------------------------
export default function (data) {
  const me = pickForVU(data.authPool, __VU);
  const { latitude, longitude } = randomNearbyCoords();
  const url =
    `${SHIMY_BASE_URL}/feed/` +
    `?radius=2&latitude=${latitude}&longitude=${longitude}`;

  const res = http.get(url, {
    headers: {
      Authorization: `Bearer ${me.access_token}`,
      Accept: 'application/json',
    },
    tags: { name: 'feed' },
  });

  feedLatency.add(res.timings.duration);

  const ok = check(res, {
    'status is 200': (r) => r.status === 200,
    'body has posts array': (r) => {
      try {
        return Array.isArray(r.json('posts'));
      } catch (_) {
        return false;
      }
    },
  });

  if (ok) {
    reqSuccess.add(1);
  } else {
    reqFailure.add(1);
    if (res.status === 0) errNetwork.add(1);
    else if (res.status >= 500) err5xx.add(1);
    else if (res.status >= 400) err4xx.add(1);
  }

  sleep(1);
}

// ---- SUMMARY EXPORT -------------------------------------------------------
export function handleSummary(data) {
  return {
    'summary.json': JSON.stringify(data, null, 2),
  };
}
