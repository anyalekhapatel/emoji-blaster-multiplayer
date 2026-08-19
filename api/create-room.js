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

  const { username, mode, playerId, code: requestedCode } = req.body || {};
  if (!username || !playerId) {
    res.status(400).json({ error: "username and playerId are required" });
    return;
  }

  // An explicit code (from the QMoji 2.0 homescreen's party room) lets every
  // player who launched Blaster from the same arcade party land in the same
  // room automatically, instead of the host having to share a second,
  // Blaster-specific code -- same contract as the room-reuse pattern the
  // sibling games (Moji Mojo, Emoji Muncher) already use. Falls back to a
  // fresh random code for a room created the normal, standalone way.
  let code;
  if (requestedCode) {
    const normalized = String(requestedCode).toUpperCase().trim();
    if (await getRoom(normalized)) {
      res.status(409).json({ error: "Room already exists" });
      return;
    }
    code = normalized;
  } else {
    code = await generateRoomCode();
  }
  const room = createRoomState(code, mode, 1);
  addPlayer(room, playerId, username);
  await saveRoom(code, room);

  await publish(code, [
    { name: "lobby-update", data: lobbyPayload(room) },
    { name: "scoreboard", data: getScoreboard(room) },
  ]);

  res.status(200).json({
    code,
    mode: room.mode,
    consensusLevel: room.consensusLevel,
    consensusRequired: CONSENSUS_REQUIRED[room.consensusLevel],
  });
};
