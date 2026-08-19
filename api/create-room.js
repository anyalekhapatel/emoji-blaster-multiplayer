const { getRoom, saveRoom } = require("../lib/room-store");
const { createRoomState, addPlayer, lobbyPayload, getScoreboard, CONSENSUS_REQUIRED } = require("../lib/game-logic");
const { publish } = require("../lib/pusher");

const CODE_CHARS = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; // no ambiguous chars (0/O, 1/I)

async function generateRoomCode() {
  for (let attempt = 0; attempt < 10; attempt++) {
    const code = Array.from({ length: 5 }, () => CODE_CHARS[Math.floor(Math.random() * CODE_CHARS.length)]).join("");
    if (!(await getRoom(code))) return code;
  }
  throw new Error("Could not generate a unique room code");
}

module.exports = async (req, res) => {
  if (req.method !== "POST") {
    res.status(405).json({ error: "Method not allowed" });
    return;
  }

  const { username, playerId } = req.body || {};
  if (!username || !playerId) {
    res.status(400).json({ error: "username and playerId are required" });
    return;
  }

  const code = await generateRoomCode();
  const room = createRoomState(code, 1);
  addPlayer(room, playerId, username);
  await saveRoom(code, room);

  await publish(code, [
    { name: "lobby-update", data: lobbyPayload(room) },
    { name: "scoreboard", data: getScoreboard(room) },
  ]);

  res.status(200).json({
    code,
    consensusLevel: room.consensusLevel,
    consensusRequired: CONSENSUS_REQUIRED[room.consensusLevel],
  });
};
