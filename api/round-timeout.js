// POST /api/round-timeout — called by a client's local fall-duration timer
// when a round appears to have expired. Idempotent: re-checks the stored
// round deadline before doing anything, so it's harmless if it fires after
// the round was already resolved by a guess or by another client's call.

const { getRoom, saveRoom } = require("../lib/room-store");
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

  const room = await getRoom(code);
  if (!room) {
    res.status(404).json({ error: "Room not found" });
    return;
  }

  const events = resolveRoundTimeout(room);
  if (events) {
    await saveRoom(code, room);
    await publish(code, events);
  }

  res.status(200).json({ ok: true, resolved: !!events });
};
