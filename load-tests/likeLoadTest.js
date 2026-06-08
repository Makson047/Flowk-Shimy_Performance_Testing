import http from 'k6/http';
import { check, sleep } from 'k6';

export const options = {
  stages: [
    // High load
    { duration: '1m', target: 1000 },
    { duration: '2m', target: 1000 },

    // Very high load
    { duration: '1m', target: 1500 },
    { duration: '2m', target: 1500 },

    // Cooldown
    { duration: '30s', target: 0 },
  ],
  thresholds: {
    // Латентність
    http_req_duration: ['p(95)<800'], // 95% запитів мають пройти <800мс

    // Рівень помилок
    http_req_failed: ['rate<0.01'],   // не більше 1% фейлів

    // Майже-SLA: навіть при стресі
    'http_req_duration{expected_response:true}': ['p(99)<1500'],
  },
};

// твій endpoint PATCH для лайку
const LIKE_URL = 'https://devapi.letsflowk.com/v1/flowk/like/3520';

// токен, який ти дала
const AUTH_TOKEN =
  'eyJ0eXAiOiJKV1QiLCJhbGciOiJIUzI1NiJ9.eyJpc3MiOiJodHRwOi8vZGV2YXBpLmxldHNmbG93ay5jb20vdjEvYXV0aC9sb2dpbiIsImlhdCI6MTc2MTYxNDg3NCwiZXhwIjoxNzY2Nzk4ODc0LCJuYmYiOjE3NjE2MTQ4NzQsImp0aSI6IklLdURVNWI1d0lMRE96UjQiLCJzdWIiOiIxNDEzIiwicHJ2IjoiMjNiZDVjODk0OWY2MDBhZGIzOWU3MDFjNDAwODcyZGI3YTU5NzZmNyJ9.O9n_6KyJBBFrUSNXYlKieUaQqvfWCutnIF6Qq1JcB6o';

// заголовки з авторизацією
const HEADERS = {
  Authorization: `Bearer ${AUTH_TOKEN}`,
  'Content-Type': 'application/json',
  Accept: 'application/json',
};

// якщо PATCH-ендпойнт не вимагає тіла, ми можемо відправити порожній body.
// якщо він очікує щось типу { "like": true }, це можна додати тут
const PAYLOAD = JSON.stringify({});

// головна функція сценарію — що робить кожен віртуальний користувач
export default function () {
  const res = http.patch(LIKE_URL, PAYLOAD, { headers: HEADERS });

  check(res, {
    'status is 200 or 204': (r) => r.status === 200 || r.status === 204,
    'response is JSON or empty': (r) => {
      const ct = r.headers['Content-Type'] || '';
      // деякі PATCH можуть повертати 204 No Content без тіла — це теж ок
      return r.status === 204 || ct.includes('application/json');
    },
  });

  // think time — користувач поставив лайк і "відпочиває"
  sleep(1);
}