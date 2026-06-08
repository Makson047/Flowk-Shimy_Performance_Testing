// Shimy auth helpers for k6 load tests.
//
// Loads the test-user pool from .secrets/users.json (gitignored),
// signs them all in once during k6 setup(), and exposes helpers for
// each VU to pick its own token + chat.

import http from 'k6/http';
import { fail } from 'k6';

// k6 `open()` is only valid in init context. We read the secret file
// at module-load time so both setup() and VU code can use the parsed
// pool without re-parsing.
const SECRETS_PATH = '../.secrets/users.json';

let credentials;
try {
  credentials = JSON.parse(open(SECRETS_PATH));
} catch (e) {
  fail(
    `Could not read ${SECRETS_PATH}. Copy load-tests/shimy/.secrets/users.example.json ` +
      `to load-tests/shimy/.secrets/users.json and fill in real test credentials. ` +
      `Original error: ${e}`
  );
}

const SIGN_IN_URL = 'https://api.shimy.app/api/v1/auth/sign-in';
const REFRESH_URL = 'https://api.shimy.app/api/v1/auth/refresh';

export const SHIMY_BASE_URL = 'https://api.shimy.app/api/v1';
export const SHIMY_WS_URL = 'wss://api.shimy.app/ws/connect';

// Base point for geo-aware tests (Vinnytsia). Override via __ENV.LAT / __ENV.LON.
export const BASE_LAT = Number(__ENV.LAT) || 49.195099341953004;
export const BASE_LON = Number(__ENV.LON) || 28.36791279543137;

// 2-mile radius in degrees (approx). 1° lat ≈ 111 km; 1° lon ≈ 111 * cos(lat) km.
// 2 mi ≈ 3.22 km → ~0.029° lat. At lat≈49.2°, cos ≈ 0.654 → ~0.044° lon.
export function randomNearbyCoords() {
  const latJitter = (Math.random() * 2 - 1) * 0.029;
  const lonJitter = (Math.random() * 2 - 1) * 0.044;
  return {
    latitude: BASE_LAT + latJitter,
    longitude: BASE_LON + lonJitter,
  };
}

// Public: list of users (without secrets stripped — k6 keeps them in memory only).
// USER_LIMIT env var truncates the pool to the first N users — useful when
// users.json has grown but you want to repeat a previous run against the same
// subset for an apples-to-apples comparison.
const ALL_USERS = Array.isArray(credentials.users) ? credentials.users : [];
const USER_LIMIT = __ENV.USER_LIMIT ? Number(__ENV.USER_LIMIT) : null;
export const USERS =
  USER_LIMIT && USER_LIMIT > 0 ? ALL_USERS.slice(0, USER_LIMIT) : ALL_USERS;
export const CHATS = Array.isArray(credentials.chats) ? credentials.chats : [];

if (USERS.length === 0) {
  fail(`users.json contains no users. Add at least one entry under "users".`);
}

if (USER_LIMIT) {
  console.log(
    `[auth] USER_LIMIT=${USER_LIMIT} → using first ${USERS.length}/${ALL_USERS.length} users from pool`
  );
}

// Sign in every user in the pool. Called once from setup().
// Returns an array aligned with USERS: [{ user, access_token, refresh_token, user_id }, ...].
// Failed logins are kept as { user, error } so the test can decide how strict to be.
export function signInAll() {
  const results = [];
  for (const user of USERS) {
    if (
      !user.phone_number ||
      !user.password ||
      user.password === 'REPLACE_ME'
    ) {
      results.push({ user, error: 'missing or placeholder credentials' });
      continue;
    }

    const res = http.post(
      SIGN_IN_URL,
      JSON.stringify({
        phone_number: user.phone_number,
        password: user.password,
      }),
      {
        headers: {
          'Content-Type': 'application/json',
          Accept: 'application/json',
        },
        tags: { name: 'auth.sign-in' },
      }
    );

    if (res.status !== 200) {
      results.push({
        user,
        error: `sign-in HTTP ${res.status}: ${res.body && String(res.body).slice(0, 200)}`,
      });
      continue;
    }

    let body;
    try {
      body = res.json();
    } catch (e) {
      results.push({ user, error: `sign-in response not JSON: ${e}` });
      continue;
    }

    if (!body || !body.access_token) {
      results.push({ user, error: 'sign-in response missing access_token' });
      continue;
    }

    results.push({
      user,
      access_token: body.access_token,
      refresh_token: body.refresh_token,
      user_id: body.user_id,
    });
  }

  const ok = results.filter((r) => r.access_token).length;
  console.log(
    `[auth] signed in ${ok}/${USERS.length} users` +
      (ok < USERS.length
        ? `. Failures: ${results
            .filter((r) => r.error)
            .map((r) => `#${r.user.id}(${r.error})`)
            .join(', ')}`
        : '')
  );

  if (ok === 0) {
    fail('No users could sign in — aborting test.');
  }
  return results;
}

// Pick a user record (from setup data) for the current VU.
// VU index is 1-based; we wrap around modulo pool size.
export function pickForVU(authPool, vuId) {
  // Filter to only successful logins so a failed sign-in doesn't take down a VU.
  const usable = authPool.filter((r) => r.access_token);
  if (usable.length === 0) {
    fail('No usable tokens in auth pool.');
  }
  return usable[(vuId - 1) % usable.length];
}

// Find the chat_id for a given pair_id. Returns undefined if missing.
export function chatIdForPair(pairId) {
  const entry = CHATS.find((c) => c.pair_id === pairId);
  return entry && entry.chat_id;
}

// Refresh an access token. Use only if you expect the test to outlive token TTL (~30 min).
export function refresh(refreshToken) {
  const res = http.post(
    REFRESH_URL,
    JSON.stringify({ refresh_token: refreshToken }),
    {
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      tags: { name: 'auth.refresh' },
    }
  );
  if (res.status !== 200) return null;
  try {
    return res.json();
  } catch (_) {
    return null;
  }
}
