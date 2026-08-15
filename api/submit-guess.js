const { getRoom, saveRoomCAS } = require("../lib/room-store");
const { handleSubmitGuess } = require("../lib/game-logic");
const { publish } = require("../lib/pusher");

const MAX_CAS_ATTEMPTS = 3;

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isAcceptingGuesses(room) {
  return room && room.started && !room.answered && room.currentEmoji && !room.finished;
}

module.exports = async (req, res) => {
  if (req.method !== "POST") {
    res.status(405).json({ error: "Method not allowed" });
    return;
  }

  const { code: rawCode, playerId, guess } = req.body || {};
  const code = (rawCode || "").toUpperCase().trim();
  if (!code || !playerId || guess === undefined) {
    res.status(400).json({ error: "code, playerId, and guess are required" });
    return;
  }

  let room = await getRoom(code);
  if (!isAcceptingGuesses(room)) {
    res.status(200).json({ ok: false, reason: "not-accepting-guesses" });
    return;
  }

  let result = null;
  for (let attempt = 0; attempt < MAX_CAS_ATTEMPTS; attempt++) {
    const expectedVersion = room.version;
    const candidate = handleSubmitGuess(room, playerId, guess);
    const saved = await saveRoomCAS(code, room, expectedVersion);

    if (saved) {
      result = candidate;
      break;
    }

    // Another guess landed first — reread the true current state and retry
    // against it (not just reapply the same delta).
    room = await getRoom(code);
    if (!isAcceptingGuesses(room)) {
      res.status(200).json({ ok: false, reason: "not-accepting-guesses" });
      return;
    }
  }

  if (!result) {
    res.status(503).json({ ok: false, reason: "conflict" });
    return;
  }

  const { immediateEvents, delayedEvent, response } = result;
  await publish(code, immediateEvents);
  if (delayedEvent) {
    await sleep(700); // matches the original round-complete pacing pause
    await publish(code, [delayedEvent]);
  }

  res.status(200).json(response);
};
