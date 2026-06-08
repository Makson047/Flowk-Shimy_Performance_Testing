import ws from 'k6/ws';
import { check, sleep } from 'k6';
import { Trend, Counter } from 'k6/metrics';

// ==== CONFIG ====

// Твій токен
const SOCKET_TOKEN =
  'ZXKob62xkSBSQ32C4qPe5cGJsYGxdtegz9ZLcGkL3GnQm07aFgl54vVQHmdnKQWC';

// Формуємо повну URL з токеном як query-параметром
const SOCKET_URL = `ws://stageapi.letsflowk.com:2347?authkey=${encodeURIComponent(
  SOCKET_TOKEN
)}`;

// Тіло запиту, яке треба відправити після конекту
const FEED_REQUEST = JSON.stringify({
  m: 'feed',
  d: {
    offset: 0,
    limit: 15,
  },
});

// ==== LOAD PROFILE ====
export const options = {
  stages: [
    { duration: '20s', target: 200 },   // швидкий розігрів
    { duration: '20s', target: 600 },   // агресивний ріст
    { duration: '20s', target: 1000 },  // тиснемо далі
    { duration: '30s', target: 2500 },  // вихід на пік 2500
    { duration: '30s', target: 2500 },  // утримуємо пік під навантаженням
    { duration: '1m',  target: 5000 },  // вихід на пік 5000
    { duration: '1m',  target: 5000 },  // утримуємо пік під навантаженням
    { duration: '1m',  target: 8000 },  // вихід на пік 5000
    { duration: '1m',  target: 8000 },  // утримуємо пік під навантаженням
    { duration: '20s', target: 0 },     // відпуск
  ],
  thresholds: {
    socket_connection_failures: ['count<20'], // не більше 20 фейлів
    socket_session_duration: ['avg>2000'],    // середній час > 2с
  },
};

// ==== CUSTOM METRICS ====
const connectionFailures = new Counter('socket_connection_failures'); // невдалі конекти
const messagesReceived = new Counter('socket_messages_received');     // отримані повідомлення
const sessionDuration = new Trend('socket_session_duration');         // тривалість з'єднання
const successfulSessions = new Counter('socket_sessions_ok');         // успішні сесії

// ==== MAIN TEST BODY ====
//
// Ця функція ОБОВ’ЯЗКОВО має бути export default,
// інакше k6 не бачитиме тест.
//
export default function () {
  const sessionStart = Date.now();

  // ws.connect повертає об'єкт Response
  const res = ws.connect(SOCKET_URL, {}, function (socket) {
    socket.on('open', () => {
      socket.send(FEED_REQUEST);
    });

    socket.on('message', (msg) => {
      messagesReceived.add(1);
      // console.log('WS message:', msg); // можна включити для дебагу
    });

    socket.on('error', (err) => {
      connectionFailures.add(1);
      // console.error('WS error:', err);
    });

    socket.on('close', () => {
      const lifetime = Date.now() - sessionStart;
      sessionDuration.add(lifetime);
    });

    // Тримаємо підключення 5 секунд, потім закриваємо
    socket.setTimeout(() => {
      try {
        socket.close();
      } catch (e) {
        // ignore
      }
    }, 5000);
  });

  // === Перевірка, що апгрейд до WebSocket успішний ===
  const ok = check(res, {
    '🟢 WebSocket handshake OK (101)': (r) => r && r.status === 101,
  });

  if (ok) {
    successfulSessions.add(1);
  } else {
    connectionFailures.add(1);
  }

  // Маленька пауза між циклами VU
  sleep(1);
}

// ==== SUMMARY EXPORT ====
//
// Цей блок створює summary.json після завершення тесту.
//
export function handleSummary(data) {
  const out = JSON.stringify(data, null, 2);
  return {
    'summary.json': out,
  };
}