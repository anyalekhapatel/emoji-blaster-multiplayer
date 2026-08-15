const { getRoom, saveRoom, pruneStalePlayers } = require("../lib/room-store");
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

  const room = await getRoom(code);
  if (!room) {
    res.status(404).json({ error: "Room not found" });
    return;
  }

  const removed = pruneStalePlayers(room);
  const events = toggleReady(room, playerId);
  await saveRoom(code, room);

  if (removed.length > 0) events.unshift({ name: "lobby-update", data: lobbyPayload(room) }, { name: "scoreboard", data: getScoreboard(room) });
  await publish(code, events);

  res.status(200).json({ ok: true });
};
