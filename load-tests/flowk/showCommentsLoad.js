import http from 'k6/http';
import { check, sleep } from 'k6';
import { Trend, Counter } from 'k6/metrics';

// ---------- Config ----------

// endpoint under test
const COMMENTS_URL =
  'https://devapi.letsflowk.com/v1/comment/3045?parent_id=null&offset=0&limit=50';

// auth token (reuse from previous tests; replace if needed)
const AUTH_TOKEN =
  'eyJ0eXAiOiJKV1QiLCJhbGciOiJIUzI1NiJ9.eyJpc3MiOiJodHRwOi8vZGV2YXBpLmxldHNmbG93ay5jb20vdjEvYXV0aC9sb2dpbiIsImlhdCI6MTc2MTYxNDg3NCwiZXhwIjoxNzY2Nzk4ODc0LCJuYmYiOjE3NjE2MTQ4NzQsImp0aSI6IklLdURVNWI1d0lMRE96UjQiLCJzdWIiOiIxNDEzIiwicHJ2IjoiMjNiZDVjODk0OWY2MDBhZGIzOWU3MDFjNDAwODcyZGI3YTU5NzZmNyJ9.O9n_6KyJBBFrUSNXYlKieUaQqvfWCutnIF6Qq1JcB6o';

// ---------- Load Model ----------
//
// Ми робимо короткий stress burst:
// - швидко піднімаємось до 1500 одночасних VU,
// - тримаємо трошки,
// - дропаємо.
// Це гарно показує, чи сервіс виживає короткий піковий сплеск.
//
// Кожен VU буде виконувати GET у циклі і спатиме 1s між запитами.
//
export const options = {
  stages: [
    { duration: '30s', target: 300 },   // швидкий прогрів
    { duration: '30s', target: 800 },   // агресивний ріст
    { duration: '30s', target: 1500 },  // максимум
    { duration: '1m',  target: 1500 },  // тримаємо пік ~1 хв
    { duration: '30s', target: 0 },     // скидання
  ],
  thresholds: {
    http_req_duration: ['p(95)<1000'], // 95% запитів мають бути <1s
    http_req_failed: ['rate<0.02'],    // не більше 2% упавших запитів
  },
};

// ---------- Custom metrics ----------
//
// ці метрики ми вже юзали в інших сценаріях, і вони корисні для репортів
//
const latencyTrend = new Trend('latency_ms');                // скільки тривав запит
const requestFailures = new Counter('request_failures');     // скільки разів запит не ок
const requestSuccess = new Counter('request_success');       // скільки разів запит ок

// ---------- VU logic ----------
export default function () {
  const res = http.get(COMMENTS_URL, {
    headers: {
      Authorization: `Bearer ${AUTH_TOKEN}`,
    },
  });

  const ok = check(res, {
    'status is 200': (r) => r.status === 200,
  });

  // збираємо кастомні метрики
  latencyTrend.add(res.timings.duration);
  if (ok) {
    requestSuccess.add(1);
  } else {
    requestFailures.add(1);
  }

  // трішки sleep, щоб не було tight loop ~0ms між запитами,
  // імітуємо реального юзера який робить фетч контенту/коментів
  sleep(1);
}

// ---------- Summary export ----------
//
// Це важливо для нашого пайплайна: k6 після прогону збере summary.json,
// а потім наш скрипт k6-run-report.sh і k6-html-report.mjs зроблять HTML.
//
export function handleSummary(data) {
  return {
    'summary.json': JSON.stringify(data, null, 2),
  };
}