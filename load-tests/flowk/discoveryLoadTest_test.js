import http from 'k6/http';
import { check, sleep } from 'k6';

export const options = {
  stages: [
    { duration: '30s', target: 250 },   // розігрів
    { duration: '60s', target: 500 },  // утримуємо 20 VU
    { duration: '10s', target: 0 }    // спад
  ],
  thresholds: {
    http_req_duration: ['p(95)<1000'], // 95% запитів < 1s
    http_req_failed: ['rate<0.05']     // до 5% фейлів допускаємо
  },
};

const BASE_URL = 'https://api.letsflowk.com/v1/flowk/discovery?offset=0&limit=2';

const AUTH_TOKEN =
  'eyJ0eXAiOiJKV1QiLCJhbGciOiJIUzI1NiJ9.eyJpc3MiOiJodHRwOi8vZGV2YXBpLmxldHNmbG93ay5jb20vdjEvYXV0aC9sb2dpbiIsImlhdCI6MTc2MTYxNDg3NCwiZXhwIjoxNzY2Nzk4ODc0LCJuYmYiOjE3NjE2MTQ4NzQsImp0aSI6IklLdURVNWI1d0lMRE96UjQiLCJzdWIiOiIxNDEzIiwicHJ2IjoiMjNiZDVjODk0OWY2MDBhZGIzOWU3MDFjNDAwODcyZGI3YTU5NzZmNyJ9.O9n_6KyJBBFrUSNXYlKieUaQqvfWCutnIF6Qq1JcB6o';

const HEADERS = {
  Authorization: `Bearer ${AUTH_TOKEN}`,
  'Content-Type': 'application/json',
  Accept: 'application/json',
};

export default function () {
  const res = http.get(BASE_URL, { headers: HEADERS });

  check(res, {
    'status is 200': (r) => r.status === 200,
    'response is JSON': (r) =>
      r.headers['Content-Type'] && r.headers['Content-Type'].includes('application/json'),
  });

  sleep(1);
}