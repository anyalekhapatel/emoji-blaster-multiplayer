// POST /api/round-timeout — called by a client's local fall-duration timer
// when a round appears to have expired. Idempotent: re-checks the stored
// round deadline before doing anything, so it's harmless if it fires after
// the round was already resolved by a guess or by another client's call.
// Every connected client calls this independently on its own timer, so this
// goes through updateRoom's CAS retry rather than a plain read-modify-write
// — otherwise it can race a concurrent heartbeat and silently revert that
// player's lastSeenAt bump.

const { updateRoom } = require("../lib/room-store");
const { resolveRoundTimeout } = require("../lib/game-logic");
const { publish } = require("../lib/pusher");

module.exports = async (req, res) => {
  if (req.method !== "POST") {
    res.status(405).json({ error: "Method not allowed" });
    return;
  }

  const { code: rawCode } = req.body || {};
  const code = (rawCode || "").toUpperCase().trim();
  if (!code) {
    res.status(400).json({ error: "code is required" });
    return;
  }

  const { room, result: events } = await updateRoom(code, (r) => resolveRoundTimeout(r));

  if (!room) {
    res.status(404).json({ error: "Room not found" });
    return;
  }

  if (events) await publish(code, events);
  res.status(200).json({ ok: true, resolved: !!events });
};
