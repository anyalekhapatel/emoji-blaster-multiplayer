const { getRoom, saveRoom, pruneStalePlayers } = require("../lib/room-store");
const { setConsensusLevel, lobbyPayload, getScoreboard } = require("../lib/game-logic");
const { publish } = require("../lib/pusher");

module.exports = async (req, res) => {
  if (req.method !== "POST") {
    res.status(405).json({ error: "Method not allowed" });
    return;
  }

  const { code: rawCode, level } = req.body || {};
  const code = (rawCode || "").toUpperCase().trim();
  if (!code || !level) {
    res.status(400).json({ error: "code and level are required" });
    return;
  }

  const room = await getRoom(code);
  if (!room) {
    res.status(404).json({ error: "Room not found" });
    return;
  }

  const removed = pruneStalePlayers(room);
  const { ok, events } = setConsensusLevel(room, Number(level));
  await saveRoom(code, room);

  const toPublish = removed.length > 0
    ? [{ name: "lobby-update", data: lobbyPayload(room) }, { name: "scoreboard", data: getScoreboard(room) }, ...events]
    : events;
  await publish(code, toPublish);

  res.status(200).json({ ok });
};
