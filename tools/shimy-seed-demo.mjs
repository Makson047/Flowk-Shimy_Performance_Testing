// Seed Shimy demo data for a single target user X.
//
// What it does (Variant B — feed + chats are separate sets of pool users):
//   Phase 1 — Feed seeding:
//     12 pool users (by default) each create a post at X's coordinates.
//     X is not involved — these posts simply appear in X's feed when X
//     opens the app.
//   Phase 2 — Chat creation:
//     12 different pool users each go through the full match flow with X:
//       1. Pool user creates a post at X's coordinates.
//       2. X signs in and responds to that post.
//       3. Pool user approves X's response → chat_id is returned.
//     Result: X has 12 active matches/chats with 12 different partners.
//
// X is NOT in users.json — it's a standalone test account (defaulting to
// the credentials provided by the PM). The "filler" users come from
// load-tests/shimy/.secrets/users.json.
//
// Created post_ids / chat_ids are written to
// load-tests/shimy/.secrets/demo-state.json so a later --teardown can clean
// everything up.
//
// Usage:
//   node tools/shimy-seed-demo.mjs              # seed everything
//   node tools/shimy-seed-demo.mjs --dry-run    # plan only, no API calls
//   node tools/shimy-seed-demo.mjs --teardown   # DELETE everything we created
//
// Env knobs:
//   TARGET_PHONE      — phone of the demo target user (default: +380668968268)
//   TARGET_PASSWORD   — password of the demo target user (default: test1234)
//   TARGET_LAT        — target latitude  (default: 33.42828810, Orange County CA)
//   TARGET_LON        — target longitude (default: -117.61373852)
//   FEED_POSTS        — how many feed-only posts to seed (default: 12)
//   CHAT_COUNT        — how many chats to create with X (default: 12)
//   POOL_OFFSET       — start index into pool users (default: 0). Useful if a
//                       previous run already used users 0..23 and they still
//                       have active posts — set POOL_OFFSET=24 to start fresh.
//   JITTER_MILES      — random spread around the target point (default: 0.3)
//   SHIMY_BASE        — override API base (default: https://api.shimy.app/api/v1)

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

// ---- ARGS / CONFIG --------------------------------------------------------
const args = new Set(process.argv.slice(2));
const TEARDOWN = args.has('--teardown');
const DRY_RUN = args.has('--dry-run');

if (TEARDOWN && DRY_RUN) {
  console.error('❌ --teardown and --dry-run are mutually exclusive.');
  process.exit(1);
}

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const USERS_PATH = path.join(ROOT, 'load-tests/shimy/.secrets/users.json');
const STATE_PATH = path.join(ROOT, 'load-tests/shimy/.secrets/demo-state.json');

const BASE = process.env.SHIMY_BASE || 'https://api.shimy.app/api/v1';
const TARGET_PHONE = process.env.TARGET_PHONE || '+380668968268';
const TARGET_PASSWORD = process.env.TARGET_PASSWORD || 'test1234';
// PM demo target: Orange County, California (the demo target user's home location).
// Override via TARGET_LAT / TARGET_LON env vars for other demos.
const TARGET_LAT = Number.isFinite(Number(process.env.TARGET_LAT))
  ? Number(process.env.TARGET_LAT)
  : 33.42828810;
const TARGET_LON = Number.isFinite(Number(process.env.TARGET_LON))
  ? Number(process.env.TARGET_LON)
  : -117.61373852;
const FEED_POSTS = Number(process.env.FEED_POSTS) || 12;
const CHAT_COUNT = Number(process.env.CHAT_COUNT) || 12;
const POOL_OFFSET = Number(process.env.POOL_OFFSET) || 0;
const JITTER_MILES = Number(process.env.JITTER_MILES) || 0.3;
const RADIUS_MILES = Number(process.env.RADIUS_MILES) || 20;

// Selfies are alternated for visual variety. Both work for any user — Shimy
// dev does not enforce photo ownership.
const SELFIE_PHOTO_IDS = [
  'ea5afe3b-3d5a-44a7-97f9-f715ae049b86',
  '3a463992-b677-4b67-93c5-930141b7fa6d',
];
const selfieFor = (i) => SELFIE_PHOTO_IDS[i % SELFIE_PHOTO_IDS.length];

const PAUSE_MS = 200;

// ---- GEO ------------------------------------------------------------------
function jitterCoords(centerLat, centerLon, jitterMiles) {
  if (jitterMiles <= 0) return { latitude: centerLat, longitude: centerLon };
  const latDegPerMile = 1 / 69;
  const lonDegPerMile = 1 / (69 * Math.cos((centerLat * Math.PI) / 180));
  const dLat = (Math.random() * 2 - 1) * jitterMiles * latDegPerMile;
  const dLon = (Math.random() * 2 - 1) * jitterMiles * lonDegPerMile;
  return { latitude: centerLat + dLat, longitude: centerLon + dLon };
}

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

// Create a post for the signed-in user. If the user already has an active
// post, delete it first (we need the new post to be at X's coordinates, not
// wherever the old one was).
async function createPostAtTarget(token, selfiePhotoId) {
  const { latitude, longitude } = jitterCoords(
    TARGET_LAT,
    TARGET_LON,
    JITTER_MILES
  );
  const body = {
    longitude,
    latitude,
    radius_miles: RADIUS_MILES,
    visible_to: { Woman: true, Man: true, 'Non-Binary': true },
    age_range_min: 18,
    age_range_max: 99,
    selfie_photo_id: selfiePhotoId,
  };

  let r = await httpJson('POST', `${BASE}/posts/`, body, token);

  // Already has an active post at some other location — remove and retry.
  if (r.status === 409 && r.json?.detail?.active_post_id) {
    const oldId = r.json.detail.active_post_id;
    await deletePost(token, oldId);
    r = await httpJson('POST', `${BASE}/posts/`, body, token);
  }

  if (!r.ok || !r.json?.id) {
    throw new Error(`POST /posts HTTP ${r.status}: ${r.text.slice(0, 200)}`);
  }
  return r.json.id;
}

async function deletePost(token, postId) {
  const r = await httpJson('DELETE', `${BASE}/posts/${postId}`, undefined, token);
  if (r.ok || r.status === 204 || r.status === 404) return true;
  throw new Error(
    `DELETE /posts/${postId} HTTP ${r.status}: ${r.text.slice(0, 200)}`
  );
}

async function createResponse(responderToken, postId, selfiePhotoId) {
  const r = await httpJson(
    'POST',
    `${BASE}/posts/${postId}/responses`,
    { selfie_photo_id: selfiePhotoId },
    responderToken
  );
  if (!r.ok || !r.json?.id) {
    throw new Error(
      `POST /posts/${postId}/responses HTTP ${r.status}: ${r.text.slice(0, 200)}`
    );
  }
  return r.json.id;
}

async function approveResponse(ownerToken, responseId) {
  const r = await httpJson(
    'POST',
    `${BASE}/responses/${responseId}/approve`,
    undefined,
    ownerToken
  );
  if (!r.ok || !r.json?.chat_id) {
    throw new Error(
      `POST /responses/${responseId}/approve HTTP ${r.status}: ${r.text.slice(0, 200)}`
    );
  }
  return r.json.chat_id;
}

const wait = (ms) => new Promise((r) => setTimeout(r, ms));

// ---- STATE I/O ------------------------------------------------------------
function readState() {
  if (!fs.existsSync(STATE_PATH)) return null;
  try {
    return JSON.parse(fs.readFileSync(STATE_PATH, 'utf8'));
  } catch (e) {
    console.error(`⚠️  Could not parse ${STATE_PATH}: ${e}`);
    return null;
  }
}

function writeState(state) {
  if (fs.existsSync(STATE_PATH)) {
    fs.copyFileSync(STATE_PATH, STATE_PATH + '.bak');
  }
  fs.writeFileSync(STATE_PATH, JSON.stringify(state, null, 2) + '\n');
}

// ---- LOAD POOL ------------------------------------------------------------
if (!fs.existsSync(USERS_PATH)) {
  console.error(`❌ Not found: ${USERS_PATH}`);
  process.exit(1);
}
const usersData = JSON.parse(fs.readFileSync(USERS_PATH, 'utf8'));
const pool = Array.isArray(usersData.users) ? usersData.users : [];
if (pool.length === 0) {
  console.error('❌ users.json has no users[]');
  process.exit(1);
}

// ---- TEARDOWN -------------------------------------------------------------
async function runTeardown() {
  const state = readState();
  if (!state) {
    console.log('No demo-state.json found — nothing to tear down.');
    return;
  }

  console.log(`Tearing down demo data for target ${state.targetUser?.phone_number || '?'}...`);
  let removed = 0;
  let failed = 0;

  const allArtifacts = [
    ...(state.feedPosts || []).map((p) => ({ ...p, kind: 'feed' })),
    ...(state.chats || []).map((c) => ({
      post_id: c.post_id,
      creator: c.partner,
      kind: 'chat',
      chat_id: c.chat_id,
    })),
  ];

  for (const a of allArtifacts) {
    if (!a.post_id || !a.creator?.phone_number || !a.creator?.password) {
      console.log(`  skip (incomplete record): ${JSON.stringify(a).slice(0, 80)}`);
      continue;
    }
    try {
      const token = await signIn(a.creator.phone_number, a.creator.password);
      await deletePost(token, a.post_id);
      console.log(`  ✅ ${a.kind}: deleted post ${a.post_id} (by ${a.creator.phone_number})`);
      removed++;
    } catch (err) {
      console.log(`  ❌ ${a.kind}: ${a.post_id} → ${err.message}`);
      failed++;
    }
    await wait(PAUSE_MS);
  }

  // Move state aside so a follow-up seed starts clean. Keep a backup just in case.
  if (fs.existsSync(STATE_PATH)) {
    fs.renameSync(STATE_PATH, STATE_PATH + '.bak');
    console.log(`\n📦 Moved ${STATE_PATH} → ${STATE_PATH}.bak`);
  }

  console.log(`\n=== Teardown summary ===`);
  console.log(`Posts removed: ${removed}`);
  console.log(`Failed:        ${failed}`);
  console.log('(Chats themselves are not deleted via this API — only the underlying posts. ' +
              'Shimy expires inactive chats automatically.)');
}

// ---- SEED -----------------------------------------------------------------
async function runSeed() {
  const need = FEED_POSTS + CHAT_COUNT;
  if (pool.length < POOL_OFFSET + need) {
    console.error(
      `❌ Pool has ${pool.length} users, need at least ${POOL_OFFSET + need} ` +
        `(POOL_OFFSET=${POOL_OFFSET} + FEED_POSTS=${FEED_POSTS} + CHAT_COUNT=${CHAT_COUNT}).`
    );
    process.exit(1);
  }

  const feedSlice = pool.slice(POOL_OFFSET, POOL_OFFSET + FEED_POSTS);
  const chatSlice = pool.slice(POOL_OFFSET + FEED_POSTS, POOL_OFFSET + need);

  console.log(`Target user:  ${TARGET_PHONE}`);
  console.log(`Target coords: lat=${TARGET_LAT}, lon=${TARGET_LON}, jitter=±${JITTER_MILES}mi`);
  console.log(`Pool size:    ${pool.length}, offset=${POOL_OFFSET}`);
  console.log(`Plan: ${FEED_POSTS} feed posts (users #${feedSlice[0]?.id}…#${feedSlice[feedSlice.length-1]?.id}) ` +
              `+ ${CHAT_COUNT} chats (users #${chatSlice[0]?.id}…#${chatSlice[chatSlice.length-1]?.id})`);
  console.log(`Mode: ${DRY_RUN ? '--dry-run (no API calls)' : 'live'}\n`);

  if (DRY_RUN) {
    console.log('— DRY RUN: no API calls will be made —\n');
    console.log('Phase 1 — feed posts:');
    for (const u of feedSlice) {
      console.log(`  user #${u.id} (${u.phone_number}) → would create post at target coords`);
    }
    console.log('\nPhase 2 — chats (X = target):');
    for (const u of chatSlice) {
      console.log(`  user #${u.id} (${u.phone_number}) → post → X responds → user approves → chat`);
    }
    return;
  }

  const state = {
    createdAt: new Date().toISOString(),
    targetUser: {
      phone_number: TARGET_PHONE,
      lat: TARGET_LAT,
      lon: TARGET_LON,
    },
    feedPosts: [],
    chats: [],
  };

  // ---- Sign in X up-front (we'll need its token in Phase 2)
  console.log('Signing in target user X...');
  let xToken;
  try {
    xToken = await signIn(TARGET_PHONE, TARGET_PASSWORD);
    console.log('  ✅ X signed in.\n');
  } catch (err) {
    console.error(`❌ Could not sign in target X: ${err.message}`);
    process.exit(2);
  }

  // ---- Phase 1: 12 feed posts
  console.log('Phase 1 — creating feed posts:');
  for (let i = 0; i < feedSlice.length; i++) {
    const u = feedSlice[i];
    try {
      const tok = await signIn(u.phone_number, u.password);
      const postId = await createPostAtTarget(tok, selfieFor(i));
      state.feedPosts.push({
        post_id: postId,
        creator: { phone_number: u.phone_number, password: u.password },
        creator_id: u.id,
      });
      console.log(`  ✅ user #${u.id}: post ${postId}`);
    } catch (err) {
      console.log(`  ❌ user #${u.id}: ${err.message}`);
    }
    await wait(PAUSE_MS);
  }

  // ---- Phase 2: 12 chats (full match flow)
  console.log('\nPhase 2 — creating chats:');
  for (let i = 0; i < chatSlice.length; i++) {
    const u = chatSlice[i];
    try {
      const partnerTok = await signIn(u.phone_number, u.password);

      // 2.1 Partner creates a post at target coords.
      const postId = await createPostAtTarget(partnerTok, selfieFor(i));
      await wait(PAUSE_MS);

      // 2.2 X responds to that post.
      const responseId = await createResponse(xToken, postId, selfieFor(i + 1));
      await wait(PAUSE_MS);

      // 2.3 Partner approves the response → chat is created.
      const chatId = await approveResponse(partnerTok, responseId);

      state.chats.push({
        chat_id: chatId,
        post_id: postId,
        response_id: responseId,
        partner: { phone_number: u.phone_number, password: u.password },
        partner_id: u.id,
      });
      console.log(
        `  ✅ user #${u.id}: chat ${chatId} (post ${postId}, response ${responseId})`
      );
    } catch (err) {
      console.log(`  ❌ user #${u.id}: ${err.message}`);
    }
    await wait(PAUSE_MS);
  }

  // ---- Save state
  writeState(state);

  console.log(`\n=== Seed summary ===`);
  console.log(`Feed posts created: ${state.feedPosts.length} / ${FEED_POSTS}`);
  console.log(`Chats created:      ${state.chats.length} / ${CHAT_COUNT}`);
  console.log(`State written to:   ${STATE_PATH}`);
  if (
    state.feedPosts.length < FEED_POSTS ||
    state.chats.length < CHAT_COUNT
  ) {
    console.log('\n⚠️  Some artifacts failed — see ❌ lines above. ' +
                'You can re-run with POOL_OFFSET to use fresh pool users.');
    process.exit(2);
  }
}

// ---- DISPATCH -------------------------------------------------------------
(async () => {
  if (TEARDOWN) await runTeardown();
  else await runSeed();
})().catch((err) => {
  console.error(`\n💥 Unexpected error: ${err.message || err}`);
  if (err.stack) console.error(err.stack);
  process.exit(1);
});
