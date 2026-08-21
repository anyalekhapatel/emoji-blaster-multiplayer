// POST /api/force-start — any player in the lobby can call this once enough
// players have joined (the room's consensus-level requirement), even if
// someone hasn't hit Ready — otherwise one holdout blocks the whole room
// with no way around it. No-ops if the game already started or there
// still aren't enough players.

const { updateRoom, pruneStalePlayers } = require("../lib/room-store");
const { forceStartGame, lobbyPayload, getScoreboard } = require("../lib/game-logic");
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

  const { room, result } = await updateRoom(code, async (r) => {
    const removed = pruneStalePlayers(r);
    const { ok, events } = await forceStartGame(r);
    return removed.length > 0
      ? { ok, events: [{ name: "lobby-update", data: lobbyPayload(r) }, { name: "scoreboard", data: getScoreboard(r) }, ...events] }
      : { ok, events };
  });

  if (!room) {
    res.status(404).json({ error: "Room not found" });
    return;
  }

  await publish(code, result.events);
  res.status(200).json({ ok: result.ok });
};
