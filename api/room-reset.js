// POST /api/room-reset — called by a client ~4s after receiving "game-over"
// (giving players time to read the final score), asking the room to reset
// to a fresh lobby. Idempotent: no-ops if the room isn't finished, or the
// resetAt deadline hasn't actually passed yet.

const { getRoom, saveRoom } = require("../lib/room-store");
const { resolveRoomReset } = require("../lib/game-logic");
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

  const events = resolveRoomReset(room);
  if (events) {
    await saveRoom(code, room);
    await publish(code, events);
  }

  res.status(200).json({ ok: true, resolved: !!events });
};
