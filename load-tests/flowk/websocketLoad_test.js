import ws from 'k6/ws';
import { check, sleep } from 'k6';
import { Trend, Counter } from 'k6/metrics';

// ==== CONFIG ====

// WebSocket endpoint
// Якщо сокет працює по wss (TLS), залишаємо wss://
// Якщо plain ws:// — тоді треба буде змінити тут.
const SOCKET_URL = 'wss://stagesocket.letsflowk.com';

// Token you provided
const SOCKET_TOKEN = 'ZXKob62xkSBSQ32C4qPe5cGJsYGxdtegz9ZLcGkL3GnQm07aFgl54vVQHmdnKQWC';

// We'll attach token as a query param ?token=... (звичайний підхід для WS auth).
// Якщо у вас інша схема (наприклад, треба хедер Authorization), я можу адаптувати.
// Для теперішнього варіанту припустимо query.
const SOCKET_FULL_URL = `${SOCKET_URL}?token=${encodeURIComponent(SOCKET_TOKEN)}`;


// ==== LOAD PROFILE ====
//
// Це "сходинка" до 500 одночасних підключень з невеликим прогрівом.
// Кожен VU = окремий socket-клієнт.
//
export const options = {
  stages: [
    { duration: '1m',  target: 500 },  // дотискаємо до 500
    { duration: '2m',  target: 500 },  // тримаємо пік 500
    { duration: '30s', target: 0 },    // відпуск
  ],
  thresholds: {
    // частка невдалих конектів повинна бути низька
    socket_connection_failures: ['count<10'],
    // ми хочемо щоб середній час життя сесії був хоча б 2 секунди
    socket_session_duration: ['avg>2000'],
  },
};


// ==== Custom metrics ====
//
// 1. Скільки разів ми не змогли встановити конекшн
// 2. Як довго тривало з'єднання
// 3. Скільки повідомлень отримали
//
const connectionFailures = new Counter('socket_connection_failures');
const messagesReceived = new Counter('socket_messages_received');
const sessionDuration = new Trend('socket_session_duration'); // ms


// ==== Test logic per VU ====
//
// Кожен VU робить:
//
// - відкриває WebSocket
// - чекає "open"
// - надсилає тестове повідомлення (опційно)
// - слухає вхідні повідомлення
// - тримає конекшн ~5 секунд
// - закриває
//
export default function () {
  const startTs = Date.now();

  const res = ws.connect(SOCKET_FULL_URL, {}, function (socket) {
    // --- lifecycle events ---

    socket.on('open', () => {
      // підключилися
      // можна одразу щось відправити, якщо бекенд очікує якийсь handshake/ping/subscription
      socket.send(JSON.stringify({
        type: 'hello',
        client: 'k6-load-test',
        ts: Date.now(),
      }));
    });

    socket.on('message', (msg) => {
      // отримали повідомлення від сервера
      messagesReceived.add(1);
      // можеш розпарсити JSON тут, якщо треба аналіз в майбутньому
      // const data = JSON.parse(msg);
    });

    socket.on('error', (e) => {
      // помилка на сокеті
      connectionFailures.add(1);
      console.error(`WebSocket error: ${e}`);
    });

    socket.on('close', () => {
      // закриття з'єднання сервером чи клієнтом
      const lifetimeMs = Date.now() - startTs;
      sessionDuration.add(lifetimeMs);
    });

    // утримуємо конекшн ~5 секунд у цьому VU і закриваємо
    socket.setTimeout(() => {
      try {
        socket.close();
      } catch (err) {
        // ignore
      }
    }, 5000);
  });

  // res.status буде 101 (Switching Protocols), якщо handshake успішний
  const ok = check(res, {
    'websocket connected (HTTP 101)': (r) => r && r.status === 101,
  });

  if (!ok) {
    connectionFailures.add(1);
  }

  // Трошки спимо між підключеннями, щоб VU не робив reconnect у tight loop.
  sleep(1);
}


// ==== Summary export ====
//
// Це дозволяє нам генерувати summary.json, яке потім ковтає наш репортер.
// У майбутньому можна буде додати ще 'timeseries.json' тощо.
//
export function handleSummary(data) {
  return {
    'summary.json': JSON.stringify(data, null, 2),
  };
}