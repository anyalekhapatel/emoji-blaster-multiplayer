const { getRoom, saveRoom, pruneStalePlayers } = require("../lib/room-store");
const { addPlayer, lobbyPayload, getScoreboard, CONSENSUS_REQUIRED } = require("../lib/game-logic");
const { publish } = require("../lib/pusher");

module.exports = async (req, res) => {
  if (req.method !== "POST") {
    res.status(405).json({ error: "Method not allowed" });
    return;
  }

  const { code: rawCode, username, playerId } = req.body || {};
  const code = (rawCode || "").toUpperCase().trim();
  if (!code || !username || !playerId) {
    res.status(400).json({ error: "code, username, and playerId are required" });
    return;
  }

  const room = await getRoom(code);
  if (!room) {
    res.status(404).json({ error: "Room not found" });
    return;
  }

  pruneStalePlayers(room);
  addPlayer(room, playerId, username);
  await saveRoom(code, room);

  await publish(code, [
    { name: "lobby-update", data: lobbyPayload(room) },
    { name: "scoreboard", data: getScoreboard(room) },
  ]);

  res.status(200).json({
    code,
    level: room.level,
    mode: room.mode,
    consensusLevel: room.consensusLevel,
    consensusRequired: CONSENSUS_REQUIRED[room.consensusLevel],
  });
};
