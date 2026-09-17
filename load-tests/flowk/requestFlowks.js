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
  m: 'flowks',
  d: {
    id: 2403,
    offset: 0,
    limit: 15,
  },
});

// ==== LOAD PROFILE ====
//
// 🔥 Ціль — довести до 8000 одночасних підключених VU (сокет-клієнтів)
// і потримати цей пік. Кожен VU = окреме websocket-зʼєднання.
//
export const options = {
  stages: [
    { duration: '20s', target: 200 },    // розігрів
    { duration: '20s', target: 600 },    // агресивний ріст
    { duration: '20s', target: 1000 },   // тиснемо далі
    { duration: '30s', target: 2500 },   // вийшли на 2.5k
    { duration: '30s', target: 2500 },   // утримуємо 2.5k
    { duration: '1m',  target: 5000 },   // штовхаємо до 5k
    { duration: '1m',  target: 5000 },   // тримаємо 5k
    { duration: '1m',  target: 8000 },   // фінальний пік 8k
    { duration: '1m',  target: 8000 },   // утримуємо пік 8k
    { duration: '20s', target: 0 },      // плавний спад
  ],

  // thresholds перевіряються після завершення тесту.
  // ВАЖЛИВО:
  // - socket_connection_failures ми тепер інкрементимо ТІЛЬКИ якщо handshake (101) не вдалось.
  // - socket_session_duration: середній час життя конекту >2с, інакше вважаємо що нас відразу дропає.
  thresholds: {
    socket_connection_failures: ['count<20'],
    socket_session_duration: ['avg>2000'],
  },
};

// ==== CUSTOM METRICS ====
//
// Ці метрики йдуть у summary.json і потім підхоплюються репортером.
//
const connectionFailures = new Counter('socket_connection_failures'); // НЕ вдалось підʼєднатись (handshake не 101)
const messagesReceived = new Counter('socket_messages_received');     // кількість отриманих повідомлень від сервера
const sessionDuration = new Trend('socket_session_duration');         // як довго VU тримав сокет (мс)
const successfulSessions = new Counter('socket_sessions_ok');         // VU успішно встановив WS (status === 101)

// ==== MAIN TEST BODY ====
//
// k6 буде багато разів викликати export default function()
// паралельно у різних VU.
//
export default function () {
  const sessionStart = Date.now();

  // ws.connect повертає об'єкт Response (з .status)
  const res = ws.connect(SOCKET_URL, {}, function (socket) {
    socket.on('open', () => {
      // одразу після відкриття шлемо payload
      socket.send(FEED_REQUEST);
    });

    socket.on('message', (msg) => {
      // кожен меседж від сервера рахуємо
      messagesReceived.add(1);
      // console.log('WS message:', msg); // можна врубити локально для дебагу (НЕ радити на 8k :)
    });

    // ВАЖЛИВО:
    // У варіанті 1 ми не вважаємо runtime error фейлом сесії,
    // якщо handshake вже відбувся. Тобто тут НЕ лічимо як failure.
    socket.on('error', (err) => {
      // console.error('WS error:', err);
    });

    socket.on('close', () => {
      // коли сокет закрився — заміряємо тривалість сесії
      const lifetime = Date.now() - sessionStart;
      sessionDuration.add(lifetime);
    });

    // Тримаємо підключення ~5 секунд, потім просимо закритись
    socket.setTimeout(() => {
      try {
        socket.close();
      } catch (_) {
        // ignore, якщо вже закрито
      }
    }, 5000);
  });

  // === Перевірка, що апгрейд до WebSocket був успішний ===
  const ok = check(res, {
    '🟢 WebSocket handshake OK (101)': (r) => r && r.status === 101,
  });

  if (ok) {
    // успішна сесія (рахуємо як "pass")
    successfulSessions.add(1);
  } else {
    // handshake не пройшов -> це той самий "fail", який ми показуємо в звіті
    connectionFailures.add(1);
  }

  // невелика пауза між циклами одного й того ж VU,
  // щоб він не спамив reconnection у tight loop.
  sleep(1);
}

// ==== SUMMARY EXPORT ====
//
// Цей блок створює summary.json після завершення тесту.
// Цей файл буде використаний нашим генератором HTML-звіту.
//
export function handleSummary(data) {
  return {
    'summary.json': JSON.stringify(data, null, 2),
  };
}