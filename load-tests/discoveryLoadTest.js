import http from 'k6/http';
import { check, sleep } from 'k6';

// Конфігурація навантаження
export const options = {
  stages: [
   
    // High load
    { duration: '1m', target: 1500 },
    { duration: '2m', target: 1500 },

    // Cooldown
    { duration: '30s', target: 0 },
  ],
  thresholds: {
    // 95-й перцентиль часу відповіді < 800мс
    http_req_duration: ['p(95)<800'],

    // фейлів менше 1%
    http_req_failed: ['rate<0.01'],

    // як приклад бізнес-критичного SLA: 99% запитів менше 1500мс
    'http_req_duration{expected_response:true}': ['p(99)<1500']
  },
};

// Базові константи
const BASE_URL = 'https://api.letsflowk.com/v1/flowk/discovery?offset=0&limit=2';

// Токен авторизації
const AUTH_TOKEN =
  'eyJ0eXAiOiJKV1QiLCJhbGciOiJIUzI1NiJ9.eyJpc3MiOiJodHRwOi8vZGV2YXBpLmxldHNmbG93ay5jb20vdjEvYXV0aC9sb2dpbiIsImlhdCI6MTc2MTYxNDg3NCwiZXhwIjoxNzY2Nzk4ODc0LCJuYmYiOjE3NjE2MTQ4NzQsImp0aSI6IklLdURVNWI1d0lMRE96UjQiLCJzdWIiOiIxNDEzIiwicHJ2IjoiMjNiZDVjODk0OWY2MDBhZGIzOWU3MDFjNDAwODcyZGI3YTU5NzZmNyJ9.O9n_6KyJBBFrUSNXYlKieUaQqvfWCutnIF6Qq1JcB6o';

// Загальні хедери
const HEADERS = {
  Authorization: `Bearer ${AUTH_TOKEN}`,
  'Content-Type': 'application/json',
  Accept: 'application/json',
};

// Основна функція для кожного VU в кожній ітерації
export default function () {
  const res = http.get(BASE_URL, { headers: HEADERS });

  // базові перевірки, які також впливають на метрику expected_response:true
  check(res, {
    'status is 200': (r) => r.status === 200,
    'response is JSON': (r) => r.headers['Content-Type']?.includes('application/json'),
  });

  // маленька пауза, щоб не перетворювати це на DDoS із 0 think time
  sleep(1);
}