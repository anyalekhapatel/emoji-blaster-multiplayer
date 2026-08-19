const { updateRoom, pruneStalePlayers } = require("../lib/room-store");
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

  const { room, result: events } = await updateRoom(code, (r) => {
    pruneStalePlayers(r);
    addPlayer(r, playerId, username);
    return [
      { name: "lobby-update", data: lobbyPayload(r) },
      { name: "scoreboard", data: getScoreboard(r) },
    ];
  });

  if (!room) {
    res.status(404).json({ error: "Room not found" });
    return;
  }

  await publish(code, events);

  res.status(200).json({
    code,
    mode: room.mode,
    consensusLevel: room.consensusLevel,
    consensusRequired: CONSENSUS_REQUIRED[room.consensusLevel],
  });
  // Note: joiners always land in the lobby, even if a round is currently
  // live in this room — they wait there (see gameInProgress in
  // lobby-update) until the room resets for the next game.
};
