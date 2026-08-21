// lib/emoji-source.js — the live emoji set Blaster plays with, sourced from
// qmoji-2's admin panel (GET /api/emoji-rules, public/unauthenticated) with
// a cache in front of it and a hard fallback to the static emojiDB.js list.
//
// This runs inside spawnEmoji, which every /api handler calls on the hot
// path of starting a game or completing a round — so it must never block on
// a slow or dead qmoji-2 deployment. The cache lives in the same Upstash
// Redis room-store.js already uses (a module-level in-memory cache would
// only help while a specific serverless container stays warm; Redis is
// shared across every invocation).

const { Redis } = require("@upstash/redis");
const { EMOJI_DB: STATIC_EMOJI_DB, EMOJI_LIST: STATIC_EMOJI_LIST, SHARED_PAIRS: STATIC_SHARED_PAIRS } = require("../emojiDB");

const kv = new Redis({
  url: process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL,
  token: process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN,
});

const CACHE_KEY = "emoji-source:cache";
const FRESH_TTL_MS = 60 * 1000; // reuse cached data younger than this without refetching
const FALLBACK_TTL_MS = 15 * 1000; // retry sooner after falling back, so recovery is quick
const FETCH_TIMEOUT_MS = 3000;

// Same admin origin qmoji-2's own arcade-proxy.js pattern uses: one env var
// for where "the homescreen" lives, defaulting to local dev.
const QMOJI_ADMIN_BASE_URL = process.env.QMOJI_ADMIN_BASE_URL || "http://localhost:5500";

// Pairwise shared-keyword computation is O(n^2) — fine for the 20-emoji
// static list (190 pairs), not fine if an admin enables hundreds. Cap how
// many enabled emoji get pulled into Double Sync's pairing pool; the rest
// still play fine in Sync mode, they just can't be picked for Double Sync.
const MAX_EMOJI_FOR_PAIRS = 150;

const STATIC_SOURCE = { EMOJI_DB: STATIC_EMOJI_DB, EMOJI_LIST: STATIC_EMOJI_LIST, SHARED_PAIRS: STATIC_SHARED_PAIRS };

function sharedKeywords(emojiDB, a, b) {
  const setB = new Set((emojiDB[b] || []).map((k) => k.toLowerCase()));
  return (emojiDB[a] || []).filter((k) => setB.has(k.toLowerCase()));
}

function buildSharedPairs(emojiDB, emojiList) {
  const pool = emojiList.slice(0, MAX_EMOJI_FOR_PAIRS);
  const pairs = [];
  for (let i = 0; i < pool.length; i++) {
    for (let j = i + 1; j < pool.length; j++) {
      const a = pool[i];
      const b = pool[j];
      const shared = sharedKeywords(emojiDB, a, b);
      if (shared.length > 0) pairs.push({ a, b, shared });
    }
  }
  return pairs;
}

async function fetchFromAdmin() {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(`${QMOJI_ADMIN_BASE_URL}/api/emoji-rules`, { signal: controller.signal });
    if (!res.ok) return null;
    const data = await res.json();
    if (!data || !Array.isArray(data.emojis) || data.emojis.length === 0) return null;

    const emojiDB = {};
    data.emojis.forEach((e) => { emojiDB[e.emoji] = e.keywords || []; });
    const emojiList = Object.keys(emojiDB);

    return { EMOJI_DB: emojiDB, EMOJI_LIST: emojiList, SHARED_PAIRS: buildSharedPairs(emojiDB, emojiList) };
  } catch (err) {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

async function readCache() {
  try {
    return await kv.get(CACHE_KEY);
  } catch (err) {
    return null;
  }
}

async function writeCache(entry) {
  try {
    await kv.set(CACHE_KEY, entry);
  } catch (err) {
    // Cache is an optimization, not a correctness requirement -- a failed
    // write just means the next call refetches instead of reusing this one.
  }
}

// Returns { EMOJI_DB, EMOJI_LIST, SHARED_PAIRS } -- either the live
// admin-enabled set (fetched or freshly cached) or the static fallback.
// Never throws, never blocks longer than FETCH_TIMEOUT_MS.
async function getEmojiSource() {
  const cached = await readCache();
  const now = Date.now();
  if (cached && now - cached.fetchedAt < FRESH_TTL_MS) {
    return cached.source;
  }

  const fetched = await fetchFromAdmin();
  if (fetched) {
    await writeCache({ fetchedAt: now, source: fetched, isFallback: false });
    return fetched;
  }

  // Fetch failed or returned nothing usable. Reuse a still-recent cached
  // value (even one already past FRESH_TTL_MS) rather than falling all the
  // way back, since a still-live-but-slow admin source beats the static
  // list. Only fall back once there's nothing usable cached at all.
  if (cached) {
    await writeCache({ fetchedAt: now - FRESH_TTL_MS + FALLBACK_TTL_MS, source: cached.source, isFallback: cached.isFallback });
    return cached.source;
  }

  await writeCache({ fetchedAt: now - FRESH_TTL_MS + FALLBACK_TTL_MS, source: STATIC_SOURCE, isFallback: true });
  return STATIC_SOURCE;
}

module.exports = { getEmojiSource };
