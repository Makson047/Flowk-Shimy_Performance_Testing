import http from 'k6/http';
import { check, sleep } from 'k6';
import { Trend, Counter } from 'k6/metrics';

// Custom metrics for later time-series visualization
const latencyTrend = new Trend('latency_ms');
const rpsCounter = new Counter('rps_total');
const failCounter = new Counter('request_failures');

// Auth token (replace with yours or use env var)
const AUTH_TOKEN =
  'eyJ0eXAiOiJKV1QiLCJhbGciOiJIUzI1NiJ9.eyJpc3MiOiJodHRwOi8vZGV2YXBpLmxldHNmbG93ay5jb20vdjEvYXV0aC9sb2dpbiIsImlhdCI6MTc2MTYxNDg3NCwiZXhwIjoxNzY2Nzk4ODc0LCJuYmYiOjE3NjE2MTQ4NzQsImp0aSI6IklLdURVNWI1d0lMRE96UjQiLCJzdWIiOiIxNDEzIiwicHJ2IjoiMjNiZDVjODk0OWY2MDBhZGIzOWU3MDFjNDAwODcyZGI3YTU5NzZmNyJ9.O9n_6KyJBBFrUSNXYlKieUaQqvfWCutnIF6Qq1JcB6o';

// Test configuration
export const options = {
  stages: [
    { duration: '1m', target: 1000 },   // moderate load
    { duration: '30s', target: 1500 },  // heavy load
    { duration: '30s', target: 1500 },  // heavy load
    { duration: '30s', target: 0 },     // cool down
  ],
  thresholds: {
    http_req_duration: ['p(95)<800'], // 95% requests should complete <800ms
    http_req_failed: ['rate<0.02'],   // <2% requests failed
  },
};

// The endpoint under test
const BASE_URL = 'https://devapi.letsflowk.com/v1/badget';

// Default function executed by each VU (virtual user)
export default function () {
  const res = http.get(BASE_URL, {
    headers: {
      Authorization: `Bearer ${AUTH_TOKEN}`,
    },
  });

  const ok = check(res, {
    'status is 200': (r) => r.status === 200,
  });

  // record latency and success/fail
  latencyTrend.add(res.timings.duration);
  rpsCounter.add(1);
  if (!ok) failCounter.add(1);

  sleep(1);
}

// After-test summary handler
export function handleSummary(data) {
  // Optionally, export extra metrics later for time series
  return {
    'summary.json': JSON.stringify(data, null, 2),
  };
}