// lib/room-store.js — Redis (Upstash, via Vercel's Marketplace integration)
// read/write helpers for room state.
//
// Every /api handler is a stateless function invocation, so room state that
// used to live in server.js's in-memory `rooms` object now lives in Redis,
// keyed by room code. @upstash/redis JSON-serializes plain objects for us.
//
// Env var names depend on how the Redis integration was connected in the
// Vercel dashboard (Upstash's own naming vs. the legacy Vercel KV naming
// some integrations still emit for compatibility) — support both so setup
// doesn't hinge on which one shows up.

const { Redis } = require("@upstash/redis");

const kv = new Redis({
  url: process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL,
  token: process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN,
});

const ROOM_TTL_SECONDS = 4 * 60 * 60; // abandoned rooms expire after 4h
const STALE_PLAYER_MS = 15000;        // no heartbeat in this window = gone
const HEARTBEAT_INTERVAL_MS = 5000;   // how often clients ping (for reference)

function roomKey(code) {
  return `room:${code}`;
}

async function getRoom(code) {
  return (await kv.get(roomKey(code))) || null;
}

async function saveRoom(code, room) {
  room.version = (room.version || 0) + 1;
  await kv.set(roomKey(code), room, { ex: ROOM_TTL_SECONDS });
  return room;
}

// Only writes if the stored version still matches expectedVersion — used by
// the one high-contention handler (submit-guess) to avoid a lost update when
// two players guess at nearly the same moment. Returns the saved room on
// success, or null on conflict (caller should reread and retry).
async function saveRoomCAS(code, room, expectedVersion) {
  const current = await kv.get(roomKey(code));
  if (!current || current.version !== expectedVersion) return null;
  room.version = expectedVersion + 1;
  await kv.set(roomKey(code), room, { ex: ROOM_TTL_SECONDS });
  return room;
}

async function deleteRoom(code) {
  await kv.del(roomKey(code));
}

// Removes players whose last heartbeat is stale (replaces the old
// socket "disconnect" handler). Mutates room.players in place and reports
// what changed so the caller can decide whether to re-check readiness etc.
function pruneStalePlayers(room) {
  const removedPlayerIds = [];
  const now = Date.now();
  const nextPlayers = {};
  for (const [pid, p] of Object.entries(room.players)) {
    if (now - (p.lastSeenAt || 0) > STALE_PLAYER_MS) {
      removedPlayerIds.push(pid);
    } else {
      nextPlayers[pid] = p;
    }
  }
  room.players = nextPlayers;
  return removedPlayerIds;
}

module.exports = {
  getRoom,
  saveRoom,
  saveRoomCAS,
  deleteRoom,
  pruneStalePlayers,
  ROOM_TTL_SECONDS,
  STALE_PLAYER_MS,
  HEARTBEAT_INTERVAL_MS,
};
