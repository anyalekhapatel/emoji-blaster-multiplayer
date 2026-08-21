const { updateRoom, pruneStalePlayers } = require("../lib/room-store");
const { toggleReady, lobbyPayload, getScoreboard } = require("../lib/game-logic");
const { publish } = require("../lib/pusher");

module.exports = async (req, res) => {
  if (req.method !== "POST") {
    res.status(405).json({ error: "Method not allowed" });
    return;
  }

  const { code: rawCode, playerId } = req.body || {};
  const code = (rawCode || "").toUpperCase().trim();
  if (!code || !playerId) {
    res.status(400).json({ error: "code and playerId are required" });
    return;
  }

  const { room, result: events } = await updateRoom(code, async (r) => {
    const removed = pruneStalePlayers(r);
    const readyEvents = await toggleReady(r, playerId);
    return removed.length > 0
      ? [{ name: "lobby-update", data: lobbyPayload(r) }, { name: "scoreboard", data: getScoreboard(r) }, ...readyEvents]
      : readyEvents;
  });

  if (!room) {
    res.status(404).json({ error: "Room not found" });
    return;
  }

  await publish(code, events);
  res.status(200).json({ ok: true });
};
