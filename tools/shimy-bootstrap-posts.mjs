// Bootstrap one active post per Shimy test user.
//
// Reads load-tests/shimy/.secrets/users.json, walks every user, and creates a
// post for any user that doesn't yet have a post_id. Updates users.json in
// place (with .bak backup).
//
// This is a one-shot setup script — it is NOT a load test. The point is to
// populate the dev DB with N posts so a manual device check or follow-up
// load test can see how the feed behaves with realistic content.
//
// Per Shimy server rule: a user can have only one active post at a time.
// - Creating a 2nd post returns HTTP 409 with `active_post_id` in the body.
//   We adopt that id (treat it as "the user already has a usable post").
// - --force first deletes the existing post via DELETE /posts/{id}, then
//   creates a fresh one.
//
// Usage:
//   node tools/shimy-bootstrap-posts.mjs                # only fill missing posts
//   node tools/shimy-bootstrap-posts.mjs --force        # recreate every post
//   node tools/shimy-bootstrap-posts.mjs --teardown     # DELETE all posts, no create
//   node tools/shimy-bootstrap-posts.mjs --dry-run      # plan only, no API calls
//
// Env knobs:
//   LAT, LON          — geo center (default: Vinnytsia 49.1951, 28.3679)
//   RADIUS_MILES      — post visibility radius (default 20)
//   JITTER_MILES      — randomization radius around the center (default 1.5)
//   USER_LIMIT        — only operate on the first N users from users.json
//                       (NB: --teardown intentionally ignores USER_LIMIT and
//                       wipes posts for the entire pool to guarantee a clean
//                       feed for repeat tests)
//   SHIMY_BASE        — override API base (default https://api.shimy.app/api/v1)

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

// ---- ARGS / CONFIG --------------------------------------------------------
const args = new Set(process.argv.slice(2));
const FORCE = args.has('--force') || args.has('-f');
const TEARDOWN = args.has('--teardown');
const DRY_RUN = args.has('--dry-run');

if ([FORCE, TEARDOWN].filter(Boolean).length > 1) {
  console.error('❌ --force and --teardown are mutually exclusive.');
  process.exit(1);
}

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
const JITTER_MILES = Number(process.env.JITTER_MILES) || 1.5;

// Two reusable selfie photo ids. Alternated per user so the dev DB doesn't
// have 100 posts pointing at the very same photo, which would be obvious in
// a manual UI check. Both ids work for any user — Shimy dev does not enforce
// photo ownership.
const SELFIE_PHOTO_IDS = [
  'ea5afe3b-3d5a-44a7-97f9-f715ae049b86',
  '3a463992-b677-4b67-93c5-930141b7fa6d',
];

// Small delay between users to be polite to the dev backend.
const USER_PAUSE_MS = 150;

// ---- GEO ------------------------------------------------------------------
// Convert miles to degree offsets. 1° lat ≈ 69 miles. 1° lon at lat L ≈
// cos(L) × 69 miles. We compute lon offset using the actual base latitude.
function jitterCoords(centerLat, centerLon, jitterMiles) {
  const latDegPerMile = 1 / 69;
  const lonDegPerMile = 1 / (69 * Math.cos((centerLat * Math.PI) / 180));
  // Uniform-ish in a square; close enough for "all 100 posts within ~1.5mi".
  const dLat = (Math.random() * 2 - 1) * jitterMiles * latDegPerMile;
  const dLon = (Math.random() * 2 - 1) * jitterMiles * lonDegPerMile;
  return {
    latitude: centerLat + dLat,
    longitude: centerLon + dLon,
  };
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

// Create a post. Returns { postId, adopted } where:
//   adopted=false → we created a fresh post
//   adopted=true  → server reported 409, we picked up the existing post_id
async function createPost(token, selfiePhotoId) {
  const { latitude, longitude } = jitterCoords(LAT, LON, JITTER_MILES);
  const body = {
    longitude,
    latitude,
    radius_miles: RADIUS_MILES,
    visible_to: { Woman: true, Man: true, 'Non-Binary': true },
    age_range_min: 18,
    age_range_max: 99,
    selfie_photo_id: selfiePhotoId,
  };
  const r = await httpJson('POST', `${BASE}/posts/`, body, token);

  if (r.ok && r.json?.id) {
    return { postId: r.json.id, adopted: false };
  }

  // Shimy: 409 Conflict { detail: { message, active_post_id } }
  if (r.status === 409 && r.json?.detail?.active_post_id) {
    return { postId: r.json.detail.active_post_id, adopted: true };
  }

  throw new Error(`POST /posts HTTP ${r.status}: ${r.text.slice(0, 200)}`);
}

// Delete a post. Tolerates 404 (already gone). Returns true if the post is
// gone after the call (either we deleted it or it didn't exist).
async function deletePost(token, postId) {
  const r = await httpJson('DELETE', `${BASE}/posts/${postId}`, undefined, token);
  if (r.ok || r.status === 204 || r.status === 404) return true;
  throw new Error(`DELETE /posts/${postId} HTTP ${r.status}: ${r.text.slice(0, 200)}`);
}

// ---- LOAD STATE -----------------------------------------------------------
if (!fs.existsSync(SECRETS_PATH)) {
  console.error(`❌ Not found: ${SECRETS_PATH}`);
  console.error(
    'Copy load-tests/shimy/.secrets/users.example.json to users.json and fill it in.'
  );
  process.exit(1);
}

const data = JSON.parse(fs.readFileSync(SECRETS_PATH, 'utf8'));
if (!Array.isArray(data.users) || data.users.length === 0) {
  console.error('❌ users.json has no users[]');
  process.exit(1);
}

// USER_LIMIT: only operate on the first N users.
// NB: ignored in --teardown mode — teardown intentionally wipes posts for the
// WHOLE pool so a follow-up feed test starts with an empty feed.
const USER_LIMIT_RAW = process.env.USER_LIMIT
  ? Number(process.env.USER_LIMIT)
  : null;
const USER_LIMIT = TEARDOWN ? null : USER_LIMIT_RAW;
const activeUsers =
  USER_LIMIT && USER_LIMIT > 0 ? data.users.slice(0, USER_LIMIT) : data.users;

const MODE_NAME = DRY_RUN
  ? '--dry-run'
  : TEARDOWN
  ? '--teardown (DELETE all, no create)'
  : FORCE
  ? '--force (recreate every post)'
  : 'idempotent (fill missing only)';

console.log(`Pool: ${data.users.length} users.`);
console.log(
  `Existing post_id entries: ${data.users.filter((u) => u.post_id && !String(u.post_id).startsWith('REPLACE')).length}`
);
if (TEARDOWN && USER_LIMIT_RAW) {
  console.log(
    `⚠️  USER_LIMIT=${USER_LIMIT_RAW} is IGNORED in --teardown mode — wiping posts for the entire pool (${data.users.length}).`
  );
} else if (USER_LIMIT) {
  console.log(
    `USER_LIMIT=${USER_LIMIT} → operating on first ${activeUsers.length}/${data.users.length} users.`
  );
}
console.log(`Mode: ${MODE_NAME}`);
if (!TEARDOWN) {
  console.log(
    `Geo center: lat=${LAT}, lon=${LON}, jitter=±${JITTER_MILES}mi, radius_miles=${RADIUS_MILES}`
  );
}
if (DRY_RUN) console.log('ℹ️  --dry-run: no API calls, no file writes.');
console.log('');

// ---- MAIN -----------------------------------------------------------------
const created = [];
const adopted = [];
const deleted = [];
const skipped = [];
const failed = [];

function userHasPost(u) {
  return u.post_id && !String(u.post_id).startsWith('REPLACE');
}

function describeUser(u) {
  return `user #${u.id} (${u.phone_number})`;
}

(async () => {
  // In teardown mode we walk the whole pool (USER_LIMIT was forced to null
  // above). In other modes we walk only activeUsers (slice).
  const walk = TEARDOWN ? data.users : activeUsers;

  for (let i = 0; i < walk.length; i++) {
    const user = walk[i];
    const tag = describeUser(user);

    // Validate creds.
    if (!user.phone_number || !user.password || user.password === 'REPLACE_ME') {
      failed.push({ id: user.id, error: 'placeholder/missing credentials' });
      console.log(`${tag}: ❌ placeholder credentials`);
      continue;
    }

    // ---- TEARDOWN branch ------------------------------------------------
    if (TEARDOWN) {
      if (!userHasPost(user)) {
        skipped.push({ id: user.id, reason: 'no post_id to delete' });
        console.log(`${tag}: ⏭  no post_id to delete`);
        continue;
      }
      if (DRY_RUN) {
        console.log(`${tag}: would DELETE post_id=${user.post_id}`);
        continue;
      }
      try {
        const token = await signIn(user.phone_number, user.password);
        await deletePost(token, user.post_id);
        deleted.push({ id: user.id, post_id: user.post_id });
        console.log(`${tag}: 🗑  deleted ${user.post_id}`);
        delete user.post_id;
      } catch (err) {
        failed.push({ id: user.id, error: String(err.message || err) });
        console.log(`${tag}: ❌ ${err.message || err}`);
      }
      if (i < walk.length - 1) {
        await new Promise((r) => setTimeout(r, USER_PAUSE_MS));
      }
      continue;
    }

    // ---- CREATE / FORCE branch ------------------------------------------
    if (!FORCE && userHasPost(user)) {
      skipped.push({ id: user.id, post_id: user.post_id });
      console.log(`${tag}: ⏭  post_id=${user.post_id} — skip`);
      continue;
    }

    if (DRY_RUN) {
      const action = userHasPost(user) ? 'recreate (force)' : 'create';
      console.log(`${tag}: would ${action}`);
      continue;
    }

    try {
      const token = await signIn(user.phone_number, user.password);

      if (FORCE && userHasPost(user)) {
        await deletePost(token, user.post_id);
        console.log(`${tag}: 🗑  deleted old post ${user.post_id}`);
      }

      const selfie = SELFIE_PHOTO_IDS[i % SELFIE_PHOTO_IDS.length];

      const { postId, adopted: didAdopt } = await createPost(token, selfie);
      user.post_id = postId;
      if (didAdopt) {
        adopted.push({ id: user.id, post_id: postId });
        console.log(`${tag}: ♻️  adopted existing post_id=${postId}`);
      } else {
        created.push({ id: user.id, post_id: postId });
        console.log(`${tag}: ✅ post_id=${postId}`);
      }
    } catch (err) {
      failed.push({ id: user.id, error: String(err.message || err) });
      console.log(`${tag}: ❌ ${err.message || err}`);
    }

    if (i < walk.length - 1) {
      await new Promise((r) => setTimeout(r, USER_PAUSE_MS));
    }
  }

  // ---- WRITE BACK ---------------------------------------------------------
  const hasChanges = created.length + adopted.length + deleted.length > 0;
  if (DRY_RUN) {
    console.log('\n--dry-run complete: no file changes written.');
  } else if (!hasChanges) {
    console.log('\nNo changes to write — everything already up to date.');
  } else {
    fs.copyFileSync(SECRETS_PATH, BACKUP_PATH);
    fs.writeFileSync(SECRETS_PATH, JSON.stringify(data, null, 2) + '\n');
    console.log(`\n💾 Wrote ${SECRETS_PATH}`);
    console.log(`📦 Backup: ${BACKUP_PATH}`);
  }

  console.log(`\n=== Summary ===`);
  if (TEARDOWN) {
    console.log(`Deleted: ${deleted.length}`);
    console.log(`Skipped (no post_id): ${skipped.length}`);
  } else {
    console.log(`Created: ${created.length}`);
    console.log(`Adopted (server already had one): ${adopted.length}`);
    console.log(`Skipped (already in users.json):  ${skipped.length}`);
  }
  console.log(`Failed:  ${failed.length}`);
  if (failed.length) {
    console.log('\nFailures:');
    for (const f of failed) console.log(`  user #${f.id}: ${f.error}`);
    process.exit(2);
  }
})();
