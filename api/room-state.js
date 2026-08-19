// GET /api/room-state?code=ABCDE — snapshot fetch so a client that just
// subscribed to its Pusher channel (or reconnected) can render current
// state immediately instead of waiting for the next broadcast event.

const { getRoom } = require("../lib/room-store");
const { lobbyPayload, getScoreboard, CONSENSUS_REQUIRED } = require("../lib/game-logic");

module.exports = async (req, res) => {
  if (req.method !== "GET") {
    res.status(405).json({ error: "Method not allowed" });
    return;
  }

  const code = (req.query.code || "").toString().toUpperCase().trim();
  if (!code) {
    res.status(400).json({ error: "code is required" });
    return;
  }

  const room = await getRoom(code);
  if (!room) {
    res.status(404).json({ error: "Room not found" });
    return;
  }

  res.status(200).json({
    code: room.code,
    consensusLevel: room.consensusLevel,
    consensusRequired: CONSENSUS_REQUIRED[room.consensusLevel],
    started: room.started,
    finished: room.finished,
    currentEmoji: room.currentEmoji,
    roundStartedAt: room.roundStartedAt,
    roundEndsAt: room.roundEndsAt,
    gameEndsAt: room.gameEndsAt,
    lobby: lobbyPayload(room),
    scoreboard: getScoreboard(room),
  });
};
