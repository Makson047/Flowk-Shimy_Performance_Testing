// Bootstrap chats between paired Shimy test users.
//
// Reads load-tests/shimy/.secrets/users.json, walks every pair_id, and runs
// the post → response → approve flow for any pair that doesn't yet have a
// chat_id. Updates users.json in place (with .bak backup).
//
// Usage:
//   node tools/shimy-bootstrap-chats.mjs                # only fill missing chats
//   node tools/shimy-bootstrap-chats.mjs --force        # recreate every chat
//   node tools/shimy-bootstrap-chats.mjs --dry-run      # plan only, no API calls
//
// Env knobs:
//   LAT, LON          — geo center for the post (default: Vinnytsia)
//   RADIUS_MILES      — post radius (default 20, so the pair is comfortably inside)
//   SHIMY_BASE        — override API base (default https://api.shimy.app/api/v1)

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

// ---- ARGS / CONFIG --------------------------------------------------------
const args = new Set(process.argv.slice(2));
const FORCE = args.has('--force') || args.has('-f');
const DRY_RUN = args.has('--dry-run');

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const SECRETS_PATH = path.join(
  ROOT,
  'load-tests/shimy/.secrets/users.json'
);
const BACKUP_PATH = SECRETS_PATH + '.bak';

const BASE = process.env.SHIMY_BASE || 'https://api.shimy.app/api/v1';
const LAT = Number(process.env.LAT) || 49.195099341953004;
const LON = Number(process.env.LON) || 28.36791279543137;
const RADIUS_MILES = Number(process.env.RADIUS_MILES) || 20;

// Hard-coded selfie photo IDs reused across the whole pool. The dev backend
// does not enforce ownership of these photos, which keeps bootstrap simple.
// If that ever changes you'll need to upload a real selfie per user via
// /api/v1/photos/* before running this script.
const SELFIE_FOR_POST = '3a463992-b677-4b67-93c5-930141b7fa6d';
const SELFIE_FOR_RESPONSE = 'ea5afe3b-3d5a-44a7-97f9-f715ae049b86';

// Small delay between pairs to avoid surprise rate-limits on dev.
const PAIR_PAUSE_MS = 200;

// ---- HTTP -----------------------------------------------------------------
async function httpJson(method, url, body, token) {
  const headers = { Accept: 'application/json' };
  if (token) headers.Authorization = `Bearer ${token}`;
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  const res = await fetch(url, {
    method,
    headers,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let json = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch (_) {}
  return { status: res.status, ok: res.ok, json, text };
}

async function signIn(phone, password) {
  const r = await httpJson('POST', `${BASE}/auth/sign-in`, {
    phone_number: phone,
    password,
  });
  if (!r.ok) {
    throw new Error(`sign-in HTTP ${r.status}: ${r.text.slice(0, 200)}`);
  }
  if (!r.json?.access_token) {
    throw new Error('sign-in: no access_token in response');
  }
  return r.json.access_token;
}

async function createPost(tokenA) {
  const r = await httpJson(
    'POST',
    `${BASE}/posts/`,
    {
      longitude: LON,
      latitude: LAT,
      radius_miles: RADIUS_MILES,
      visible_to: { Woman: true, Man: true, 'Non-Binary': true },
      age_range_min: 18,
      age_range_max: 99,
      selfie_photo_id: SELFIE_FOR_POST,
    },
    tokenA
  );
  if (!r.ok)
    throw new Error(`POST /posts HTTP ${r.status}: ${r.text.slice(0, 200)}`);
  if (!r.json?.id) throw new Error('POST /posts: no id in response');
  return r.json.id;
}

async function createResponse(tokenB, postId) {
  const r = await httpJson(
    'POST',
    `${BASE}/posts/${postId}/responses`,
    { selfie_photo_id: SELFIE_FOR_RESPONSE },
    tokenB
  );
  if (!r.ok)
    throw new Error(
      `POST responses HTTP ${r.status}: ${r.text.slice(0, 200)}`
    );
  if (!r.json?.id) throw new Error('POST responses: no id in response');
  return r.json.id;
}

async function approveResponse(tokenA, responseId) {
  // approve has empty body — pass undefined to skip Content-Type.
  const r = await httpJson(
    'POST',
    `${BASE}/responses/${responseId}/approve`,
    undefined,
    tokenA
  );
  if (!r.ok)
    throw new Error(`approve HTTP ${r.status}: ${r.text.slice(0, 200)}`);
  if (!r.json?.chat_id) throw new Error('approve: no chat_id in response');
  return r.json.chat_id;
}

// ---- MAIN -----------------------------------------------------------------
async function main() {
  if (!fs.existsSync(SECRETS_PATH)) {
    console.error(`❌ ${SECRETS_PATH} not found.`);
    console.error(
      '   Copy load-tests/shimy/.secrets/users.example.json to users.json and fill it first.'
    );
    process.exit(1);
  }

  const data = JSON.parse(fs.readFileSync(SECRETS_PATH, 'utf8'));
  const allUsers = Array.isArray(data.users) ? data.users : [];
  if (!Array.isArray(data.chats)) data.chats = [];

  if (allUsers.length === 0) {
    console.error('❌ users.json has no users. Add credentials first.');
    process.exit(1);
  }

  // USER_LIMIT: only consider the first N users. Use this to repeat a
  // previous run against a smaller subset of a now-larger pool — keeps
  // before/after comparisons honest.
  const USER_LIMIT = process.env.USER_LIMIT
    ? Number(process.env.USER_LIMIT)
    : null;
  const users =
    USER_LIMIT && USER_LIMIT > 0 ? allUsers.slice(0, USER_LIMIT) : allUsers;

  // Group users by pair_id.
  const pairs = new Map();
  for (const u of users) {
    if (u.pair_id == null) continue;
    const list = pairs.get(u.pair_id) || [];
    list.push(u);
    pairs.set(u.pair_id, list);
  }

  if (USER_LIMIT) {
    console.log(
      `USER_LIMIT=${USER_LIMIT} → using first ${users.length}/${allUsers.length} users.`
    );
  }
  console.log(`Pool: ${users.length} users → ${pairs.size} pair_ids.`);
  console.log(`Existing chats[] entries: ${data.chats.length}`);
  console.log(`Geo: lat=${LAT} lon=${LON} radius_miles=${RADIUS_MILES}`);
  if (FORCE) console.log('⚠️  --force: existing chat_ids will be overwritten.');
  if (DRY_RUN) console.log('ℹ️  --dry-run: no API calls, no file writes.');
  console.log('');

  let created = 0;
  let skipped = 0;
  const failed = [];

  const sortedPairs = [...pairs.entries()].sort((a, b) => a[0] - b[0]);

  for (const [pairId, members] of sortedPairs) {
    const existing = data.chats.find((c) => c.pair_id === pairId);
    const hasValidChat =
      existing &&
      existing.chat_id &&
      !String(existing.chat_id).startsWith('REPLACE');

    if (hasValidChat && !FORCE) {
      skipped += 1;
      console.log(`pair ${pairId}: chat_id=${existing.chat_id} — skip`);
      continue;
    }

    if (members.length < 2) {
      failed.push({ pairId, error: `only ${members.length} member(s)` });
      console.log(`pair ${pairId}: ❌ only ${members.length} member(s)`);
      continue;
    }

    const [a, b] = members;
    const credsBad = (u) =>
      !u.phone_number ||
      !u.password ||
      u.password === 'REPLACE_ME';
    if (credsBad(a) || credsBad(b)) {
      failed.push({ pairId, error: 'placeholder/missing credentials' });
      console.log(`pair ${pairId}: ❌ placeholder credentials`);
      continue;
    }

    if (DRY_RUN) {
      console.log(
        `pair ${pairId}: would bootstrap (${a.phone_number} ⇄ ${b.phone_number})`
      );
      continue;
    }

    try {
      const tokenA = await signIn(a.phone_number, a.password);
      const tokenB = await signIn(b.phone_number, b.password);
      const postId = await createPost(tokenA);
      const responseId = await createResponse(tokenB, postId);
      const chatId = await approveResponse(tokenA, responseId);

      const idx = data.chats.findIndex((c) => c.pair_id === pairId);
      const entry = { pair_id: pairId, chat_id: chatId };
      if (idx >= 0) data.chats[idx] = entry;
      else data.chats.push(entry);

      created += 1;
      console.log(
        `pair ${pairId}: ✅ chat_id=${chatId}  (post=${postId} → resp=${responseId})`
      );
    } catch (e) {
      const msg = String(e.message || e);
      failed.push({ pairId, error: msg });
      console.log(`pair ${pairId}: ❌ ${msg}`);
    }

    if (PAIR_PAUSE_MS > 0) {
      await new Promise((r) => setTimeout(r, PAIR_PAUSE_MS));
    }
  }

  // Persist (only if we actually created something or forced).
  if (!DRY_RUN && (created > 0 || FORCE)) {
    // keep chats[] sorted by pair_id for readability
    data.chats.sort((a, b) => a.pair_id - b.pair_id);

    fs.copyFileSync(SECRETS_PATH, BACKUP_PATH);
    const tmp = SECRETS_PATH + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(data, null, 2) + '\n');
    fs.renameSync(tmp, SECRETS_PATH);
    console.log(`\n💾 Updated ${path.basename(SECRETS_PATH)} (backup: ${path.basename(BACKUP_PATH)})`);
  } else if (!DRY_RUN) {
    console.log('\nNo changes to write.');
  }

  console.log('\n=== Summary ===');
  console.log(`Created: ${created}`);
  console.log(`Skipped: ${skipped}`);
  console.log(`Failed:  ${failed.length}`);
  for (const f of failed) {
    console.log(`  pair ${f.pairId}: ${f.error}`);
  }

  process.exit(failed.length === 0 ? 0 : 2);
}

main().catch((e) => {
  console.error('fatal:', e);
  process.exit(1);
});
