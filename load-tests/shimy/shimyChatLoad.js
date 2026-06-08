// Shimy — WebSocket chat load test.
//
// Endpoint: wss://api.shimy.app/ws/connect?token=<jwt>
// Modes (via __ENV.MODE):
//   send   — each VU periodically sends `chat.send` to its pair's chat;
//            the peer VU receives `chat.message` and records delivery latency.
//   typing — each VU periodically sends `chat.typing` (ephemeral, no DB write).
//            Lighter, useful to stress just the WS pipeline.
//
// IMPORTANT — Shimy server rule:
//   "If the same user opens a second WebSocket, the previous connection is
//    closed with code 4409."
// → A given user can hold ONLY ONE concurrent session. The test caps VU count
//   at the size of the user pool so we never get 4409 collisions.
//
// Run:
//   ./scripts/k6-run-report.sh shimy/shimyChatLoad.js                   # send + load profile
//   MODE=typing ./scripts/k6-run-report.sh shimy/shimyChatLoad.js
//   PROFILE=stress ./scripts/k6-run-report.sh shimy/shimyChatLoad.js

import ws from 'k6/ws';
import { check, sleep, fail } from 'k6';
import { Counter, Trend } from 'k6/metrics';
import {
  SHIMY_WS_URL,
  USERS,
  signInAll,
  pickForVU,
  chatIdForPair,
} from './lib/auth.js';

// ---- LOAD PROFILES --------------------------------------------------------
// VU count is auto-capped to USERS.length to avoid the 4409 (duplicate session) close.
function capStages(stages) {
  return stages.map((s) => ({
    ...s,
    target: Math.min(s.target, USERS.length),
  }));
}

const PROFILES = {
  smoke: {
    stages: capStages([
      { duration: '15s', target: 10 },
      { duration: '45s', target: 10 },
      { duration: '10s', target: 0 },
    ]),
    sessionDurationMs: 30_000,
  },
  load: {
    stages: capStages([
      { duration: '30s', target: 50 },
      { duration: '3m', target: 50 },
      { duration: '20s', target: 0 },
    ]),
    sessionDurationMs: 120_000,
  },
  stress: {
    stages: capStages([
      { duration: '30s', target: 50 },
      { duration: '8m', target: 50 },
      { duration: '20s', target: 0 },
    ]),
    sessionDurationMs: 300_000,
  },
};

const PROFILE_NAME = (__ENV.PROFILE || 'load').toLowerCase();
const PROFILE = PROFILES[PROFILE_NAME];
if (!PROFILE) {
  throw new Error(
    `Unknown PROFILE="${PROFILE_NAME}". Valid: ${Object.keys(PROFILES).join(', ')}`
  );
}

const MODE = (__ENV.MODE || 'send').toLowerCase();
if (MODE !== 'send' && MODE !== 'typing') {
  throw new Error(`Unknown MODE="${MODE}". Valid: send, typing`);
}

// How often a VU emits a message while connected.
const SEND_INTERVAL_MS = MODE === 'send' ? 2_000 : 500;

export const options = {
  stages: PROFILE.stages,
  thresholds: {
    socket_connection_failures: ['count<5'],
    socket_session_duration: ['avg>2000'],
    // Looser RTT bound for `send` mode; ignored if metric is empty.
    chat_delivery_latency_ms: ['p(95)<2000'],
  },
  // k6 default Trend stats omit p(50)/p(99); enable both so the report has
  // full latency percentiles for session duration / chat RTT.
  summaryTrendStats: ['avg', 'min', 'med', 'max', 'p(50)', 'p(90)', 'p(95)', 'p(99)'],
};

// ---- CUSTOM METRICS -------------------------------------------------------
// Names chosen to be compatible with the existing HTML report generator.
const sessionsOk = new Counter('socket_sessions_ok');
const connectionFailures = new Counter('socket_connection_failures');
const messagesReceived = new Counter('socket_messages_received');
const sessionDuration = new Trend('socket_session_duration', true);

// Shimy-specific (rendered as extra cards in the HTML report).
const chatMessagesSent = new Counter('chat_messages_sent');
const chatTypingSent = new Counter('chat_typing_sent');
const chatDeliveryLatency = new Trend('chat_delivery_latency_ms', true);
const closeCode4409 = new Counter('ws_close_4409');
const closeCode4401 = new Counter('ws_close_4401');

// Sentinel marker so peers can recognise messages produced by THIS test
// run (and not e.g. by a manual chat from your phone in parallel).
const RUN_MARKER = `LOAD_TEST_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

// ---- SETUP ----------------------------------------------------------------
export function setup() {
  console.log(
    `[shimyChatLoad] profile="${PROFILE_NAME}" mode="${MODE}" ` +
      `userPool=${USERS.length} runMarker=${RUN_MARKER}`
  );
  if (USERS.length < 2) {
    fail(
      'Need at least 2 users (one chat pair) to run the chat test. ' +
        'Fill load-tests/shimy/.secrets/users.json with real credentials.'
    );
  }
  const authPool = signInAll();
  return { authPool, runMarker: RUN_MARKER };
}

// ---- VU CODE --------------------------------------------------------------
export default function (data) {
  const me = pickForVU(data.authPool, __VU);
  const pairId = me.user && me.user.pair_id;
  const chatId = chatIdForPair(pairId);

  if (!chatId) {
    // No chat configured for this pair: still test the connection itself,
    // but skip sending. This keeps a half-configured pool from blowing up.
    runConnectionOnly(me);
    return;
  }

  runChatSession(me, chatId, data.runMarker);
}

function runConnectionOnly(me) {
  const url = `${SHIMY_WS_URL}?token=${encodeURIComponent(me.access_token)}`;
  const start = Date.now();
  const res = ws.connect(url, {}, (socket) => {
    socket.on('close', () => sessionDuration.add(Date.now() - start));
    socket.setTimeout(() => {
      try {
        socket.close();
      } catch (_) {}
    }, 5000);
  });
  if (res && res.status === 101) sessionsOk.add(1);
  else connectionFailures.add(1);
  sleep(1);
}

function runChatSession(me, chatId, runMarker) {
  const url = `${SHIMY_WS_URL}?token=${encodeURIComponent(me.access_token)}`;
  const start = Date.now();
  let messageCounter = 0;

  const res = ws.connect(url, {}, (socket) => {
    socket.on('open', () => {
      // Send periodically while connected.
      socket.setInterval(() => {
        if (MODE === 'send') {
          messageCounter += 1;
          const sentAt = Date.now();
          // Encoded marker so the receiving peer can extract the send timestamp.
          // Format: <RUN_MARKER>::<vuId>::<seq>::<sentAt>
          const content = `${runMarker}::vu${__VU}::seq${messageCounter}::ts${sentAt}`;
          socket.send(
            JSON.stringify({
              type: 'chat.send',
              data: { chat_id: chatId, content },
            })
          );
          chatMessagesSent.add(1);
        } else {
          socket.send(
            JSON.stringify({
              type: 'chat.typing',
              data: { chat_id: chatId },
            })
          );
          chatTypingSent.add(1);
        }
      }, SEND_INTERVAL_MS);
    });

    socket.on('message', (raw) => {
      messagesReceived.add(1);
      if (MODE !== 'send') return;
      // Look for our run marker — that means the peer's chat.send made it
      // through the server pipeline and was delivered to us.
      let parsed;
      try {
        parsed = JSON.parse(raw);
      } catch (_) {
        return;
      }
      if (
        !parsed ||
        parsed.type !== 'chat.message' ||
        !parsed.data ||
        typeof parsed.data.content !== 'string'
      ) {
        return;
      }
      const m = parsed.data.content.match(
        /LOAD_TEST_[A-Za-z0-9_]+::vu\d+::seq\d+::ts(\d+)/
      );
      if (!m) return;
      const sentAt = Number(m[1]);
      if (Number.isFinite(sentAt)) {
        chatDeliveryLatency.add(Date.now() - sentAt);
      }
    });

    socket.on('error', (_err) => {
      // Variant-1 semantics (consistent with Flowk): runtime errors during a
      // valid session are NOT counted as handshake failures. Real handshake
      // failures are detected via res.status below.
    });

    socket.on('close', (code) => {
      sessionDuration.add(Date.now() - start);
      if (code === 4409) closeCode4409.add(1);
      else if (code === 4401) closeCode4401.add(1);
    });

    socket.setTimeout(() => {
      try {
        socket.close();
      } catch (_) {}
    }, PROFILE.sessionDurationMs);
  });

  const ok = check(res, {
    'WebSocket handshake OK (101)': (r) => r && r.status === 101,
  });
  if (ok) sessionsOk.add(1);
  else connectionFailures.add(1);

  // Tiny pause before this VU's next iteration. With long sessionDurationMs,
  // a single VU re-iterates only a few times per test.
  sleep(1);
}

// ---- SUMMARY EXPORT -------------------------------------------------------
export function handleSummary(data) {
  return {
    'summary.json': JSON.stringify(data, null, 2),
  };
}
