require("dotenv").config();

const express = require("express");
const http = require("http");
const { Server } = require("socket.io");
const path = require("path");
const { EMOJI_DB, EMOJI_LIST, sharedKeywords } = require("./emojiDB");
const { connectDB } = require("./db");
const { GameSession } = require("./models");

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.static(path.join(__dirname, "public")));

const FALL_DURATION_MS = 8000; // how long an emoji is "live" before it's a miss
const RETRY_LIMIT = 25;        // Level 3: re-roll if a random pair shares no keyword
const LEVEL2_REQUIRED = 2;     // Level 2: distinct correct keywords needed per round
const WIN_SCORE = 10;          // classic mode: first player to reach this score ends the game
const SYNC_TIME_LIMIT_MS = 60000; // sync mode: the whole room races the clock, not each other
const MODES = ["classic", "sync"];
const MIN_PLAYERS = 2;         // a room needs at least this many ready players to start
const REMATCH_DELAY_MS = 4000; // pause on the Game Over screen before the room resets

let dbConnected = false;

// In-memory room store.
// rooms[code] = {
//   players: Map(socketId -> { username, score, ready }),
//   level: 1 | 2 | 3,
//   mode: "classic" | "sync",  // classic: first correct guess wins the round.
//                               // sync: round only clears once every player has
//                               // submitted the SAME valid keyword.
//   currentEmoji: string | [string, string],
//   targetKeywords: string[],
//   foundKeywords: string[],   // Level 2 progress this round
//   roundGuesses: Map(socketId -> Set<normalizedGuess>),  // sync mode: every valid
//     keyword each player has typed THIS round (accumulates — never wiped on a
//     non-match, only cleared when a new emoji spawns), so two players can land
//     on the same word minutes apart and still get credit.
//   answered: bool,
//   finished: bool,            // true once the room's game has ended (score or timer)
//   teamScore: number,         // sync mode: emoji successfully synced this game
//   gameEndsAt: number | null, // sync mode: epoch ms when the game timer runs out
//   gameTimer: Timeout | null, // sync mode: fires finishSyncGame when time's up
//   timer: Timeout | null,     // per-round "miss" timeout (both modes)
//   started: bool,
//   startedAt: number | null,
//   roundStartedAt: number | null,
//   sessionDoc: GameSession | null,   // Mongo document for this room's session
//   currentRound: {                    // in-progress round, flushed into sessionDoc.rounds when it ends
//     emoji, level, targetKeywords, guesses: [], startedAt
//   } | null,
// }
const rooms = {};

function generateRoomCode() {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; // no ambiguous chars (0/O, 1/I)
  let code;
  do {
    code = Array.from({ length: 5 }, () => chars[Math.floor(Math.random() * chars.length)]).join("");
  } while (rooms[code]);
  return code;
}

function getScoreboard(room) {
  return Array.from(room.players.values())
    .map((p) => ({ username: p.username, score: p.score }))
    .sort((a, b) => b.score - a.score);
}

function getPlayerList(room) {
  return Array.from(room.players.values()).map((p) => ({
    username: p.username,
    ready: p.ready,
  }));
}

function broadcastScoreboard(code) {
  const room = rooms[code];
  if (!room) return;
  io.to(code).emit("scoreboard", getScoreboard(room));
}

function broadcastLobby(code) {
  const room = rooms[code];
  if (!room) return;
  io.to(code).emit("lobby-update", {
    players: getPlayerList(room),
    level: room.level,
    mode: room.mode,
    minPlayers: MIN_PLAYERS,
    gameInProgress: room.started && !room.finished,
  });
}

function allPlayersReady(room) {
  const players = Array.from(room.players.values());
  return players.length >= MIN_PLAYERS && players.every((p) => p.ready);
}

function randChoice(arr) { return arr[Math.floor(Math.random() * arr.length)]; }

// Finalizes whatever round is currently open and appends it to the
// session document's rounds array. Safe to call even if Mongo isn't
// connected — it just won't be persisted (still logs to console).
function flushCurrentRound(room, completedBy, timeToCorrectMs) {
  if (!room.currentRound) return;

  const finished = {
    ...room.currentRound,
    completedBy: completedBy || null,
    timeToCorrectMs: timeToCorrectMs != null ? timeToCorrectMs : null,
    endedAt: new Date(),
  };

  console.log(`[analytics] round-complete`, {
    emoji: finished.emoji,
    level: finished.level,
    completedBy: finished.completedBy,
    timeToCorrectMs: finished.timeToCorrectMs,
    guessCount: finished.guesses.length,
  });

  if (room.sessionDoc) room.sessionDoc.rounds.push(finished);
  room.currentRound = null;
}

// Puts a room back into a fresh pre-game lobby state: scores and ready
// flags cleared, nobody spawned in. Lets both the just-finished players and
// anyone who joined mid-game (and was held in the lobby) ready up together
// for another round without needing a new room code.
function resetRoomForNextGame(code) {
  const room = rooms[code];
  if (!room) return;

  clearTimeout(room.timer);
  clearTimeout(room.gameTimer);
  room.started = false;
  room.finished = false;
  room.currentEmoji = null;
  room.targetKeywords = [];
  room.foundKeywords = [];
  room.roundGuesses = new Map();
  room.answered = false;
  room.startedAt = null;
  room.roundStartedAt = null;
  room.gameEndsAt = null;
  room.teamScore = 0;
  room.sessionDoc = null;
  room.currentRound = null;
  room.players.forEach((p) => { p.score = 0; p.ready = false; });

  io.to(code).emit("room-reset");
  broadcastLobby(code);
  broadcastScoreboard(code);
}

// Classic mode: ends the room's game once a player reaches WIN_SCORE.
// Returns true if the game just ended (caller should not schedule another
// round in that case).
function checkGameOver(code) {
  const room = rooms[code];
  if (!room || room.finished) return false;

  const winner = Array.from(room.players.values()).find((p) => p.score >= WIN_SCORE);
  if (!winner) return false;

  room.finished = true;
  clearTimeout(room.timer);
  io.to(code).emit("game-over", { mode: "classic", winner: winner.username, scoreboard: getScoreboard(room) });
  endGame(code, "score-limit");
  setTimeout(() => resetRoomForNextGame(code), REMATCH_DELAY_MS);
  return true;
}

// Sync mode: the room shares one clock instead of racing to a score. Called
// when the timer set in startGame() runs out.
function finishSyncGame(code) {
  const room = rooms[code];
  if (!room || room.finished) return;

  room.finished = true;
  clearTimeout(room.timer);
  clearTimeout(room.gameTimer);
  io.to(code).emit("game-over", { mode: "sync", teamScore: room.teamScore || 0, scoreboard: getScoreboard(room) });
  endGame(code, "time-up");
  setTimeout(() => resetRoomForNextGame(code), REMATCH_DELAY_MS);
}

function spawnEmoji(code) {
  const room = rooms[code];
  if (!room || room.players.size === 0 || room.finished) return;

  room.answered = false;
  room.foundKeywords = [];
  room.roundGuesses = new Map();
  room.roundStartedAt = Date.now();

  let emojiForRound, targetKeywords;

  if (room.level === 3) {
    let a, b, shared = [];
    for (let i = 0; i < RETRY_LIMIT && shared.length === 0; i++) {
      a = randChoice(EMOJI_LIST);
      b = randChoice(EMOJI_LIST);
      if (a === b) continue;
      shared = sharedKeywords(a, b);
    }
    if (shared.length === 0) {
      a = EMOJI_LIST[0]; b = EMOJI_LIST[1];
      shared = sharedKeywords(a, b);
    }
    emojiForRound = [a, b];
    targetKeywords = shared;
  } else {
    emojiForRound = randChoice(EMOJI_LIST);
    targetKeywords = EMOJI_DB[emojiForRound]; // Levels 1 & 2 both draw from the full list
  }

  room.currentEmoji = emojiForRound;
  room.targetKeywords = targetKeywords;
  room.currentRound = {
    emoji: emojiForRound,
    level: room.level,
    targetKeywords,
    guesses: [],
    startedAt: new Date(room.roundStartedAt),
  };

  io.to(code).emit("emoji-spawn", { emoji: emojiForRound, fallDuration: FALL_DURATION_MS, level: room.level });
  console.log(`[analytics] emoji-shown`, { code, emoji: emojiForRound, level: room.level });

  clearTimeout(room.timer);
  room.timer = setTimeout(() => {
    if (!room.answered) {
      flushCurrentRound(room, null, null); // missed — no one completed it
      io.to(code).emit("emoji-miss", { emoji: room.currentEmoji });
      spawnEmoji(code);
    }
  }, FALL_DURATION_MS);
}

function startGame(code) {
  const room = rooms[code];
  if (!room || room.started) return;
  room.started = true;
  room.startedAt = Date.now();
  room.teamScore = 0;

  room.sessionDoc = new GameSession({
    roomCode: code,
    level: room.level,
    usernames: Array.from(room.players.values()).map((p) => p.username),
    startedAt: new Date(room.startedAt),
    rounds: [],
  });

  let endsAt = null;
  if (room.mode === "sync") {
    endsAt = room.startedAt + SYNC_TIME_LIMIT_MS;
    room.gameEndsAt = endsAt;
    clearTimeout(room.gameTimer);
    room.gameTimer = setTimeout(() => finishSyncGame(code), SYNC_TIME_LIMIT_MS);
  }

  io.to(code).emit("game-started", { level: room.level, mode: room.mode, endsAt });
  console.log(`[analytics] session-start`, { code, level: room.level, mode: room.mode, startedAt: room.startedAt });
  spawnEmoji(code);
}

function endGame(code, reason) {
  const room = rooms[code];
  if (!room) return;
  clearTimeout(room.timer);
  clearTimeout(room.gameTimer);

  if (room.currentRound) flushCurrentRound(room, null, null);

  if (room.startedAt) {
    const endedAt = Date.now();
    const durationMs = endedAt - room.startedAt;
    console.log(`[analytics] session-end`, { code, endedAt, durationMs, reason });

    if (room.sessionDoc && dbConnected) {
      room.sessionDoc.endedAt = new Date(endedAt);
      room.sessionDoc.durationMs = durationMs;
      room.sessionDoc.save().catch((err) => console.error("[db] failed to save session:", err.message));
    }
  }
}

// Classic mode: first player to land any unclaimed valid keyword wins the
// point (Level 2 still requires LEVEL2_REQUIRED distinct keywords total).
function handleClassicGuess(code, room, socket, player, normalized, elapsedMs) {
  const isValidUnclaimed = room.targetKeywords.some(
    k => k.toLowerCase() === normalized && !room.foundKeywords.includes(k)
  );

  if (room.currentRound) {
    room.currentRound.guesses.push({
      username: player ? player.username : "?",
      guess: normalized,
      correct: isValidUnclaimed,
      elapsedMs,
    });
  }
  console.log(`[analytics] guess-attempt`, {
    code, username: player ? player.username : "?", guess: normalized,
    correct: isValidUnclaimed, level: room.level, mode: room.mode, elapsedMs,
  });

  if (!isValidUnclaimed) {
    socket.emit("guess-wrong");
    return;
  }

  const matchedKeyword = room.targetKeywords.find(
    k => k.toLowerCase() === normalized && !room.foundKeywords.includes(k)
  );
  room.foundKeywords.push(matchedKeyword);

  const requiredCount = room.level === 2 ? LEVEL2_REQUIRED : 1;
  const roundComplete = room.foundKeywords.length >= requiredCount;

  if (player) player.score += 1;
  broadcastScoreboard(code);

  if (roundComplete) {
    room.answered = true;
    clearTimeout(room.timer);

    flushCurrentRound(room, player ? player.username : "?", elapsedMs);

    io.to(code).emit("emoji-correct", {
      emoji: room.currentEmoji,
      username: player ? player.username : "?",
      guess: normalized,
    });

    if (!checkGameOver(code)) {
      setTimeout(() => spawnEmoji(code), 700); // brief pause before next round
    }
  } else {
    io.to(code).emit("keyword-found", {
      username: player ? player.username : "?",
      guess: normalized,
      remaining: requiredCount - room.foundKeywords.length,
    });
  }
}

// Sync mode: players type valid keywords freely, one after another — nothing
// ever "locks in". Each player accumulates a running set of every valid
// keyword they've typed THIS round, and as soon as one word appears in every
// player's set (however far apart in time they typed it), the round clears.
// No guess text is ever broadcast to other players before that point — only
// a private guess-wrong nudge to the person who typed it, and a headcount of
// how many players have contributed so far.
function handleSyncGuess(code, room, socket, player, normalized, elapsedMs) {
  const matchedKeyword = room.targetKeywords.find(k => k.toLowerCase() === normalized);

  if (room.currentRound) {
    room.currentRound.guesses.push({
      username: player ? player.username : "?",
      guess: normalized,
      correct: !!matchedKeyword,
      elapsedMs,
    });
  }
  console.log(`[analytics] guess-attempt`, {
    code, username: player ? player.username : "?", guess: normalized,
    correct: !!matchedKeyword, level: room.level, mode: room.mode, elapsedMs,
  });

  if (!matchedKeyword) {
    socket.emit("guess-wrong");
    return;
  }

  if (!room.roundGuesses.has(socket.id)) room.roundGuesses.set(socket.id, new Set());
  room.roundGuesses.get(socket.id).add(normalized);

  const playerIds = Array.from(room.players.keys());
  const guessSets = playerIds.map(id => room.roundGuesses.get(id));
  const everyoneHasGuessed = guessSets.every(s => s && s.size > 0);

  if (!everyoneHasGuessed) {
    io.to(code).emit("sync-progress", {
      guessedCount: guessSets.filter(s => s && s.size > 0).length,
      totalCount: playerIds.length,
    });
    return;
  }

  const sharedWord = Array.from(guessSets[0]).find(word => guessSets.every(s => s.has(word)));

  if (!sharedWord) {
    // Everyone's contributed at least one guess, but nothing overlaps yet —
    // keep the accumulated sets and just wait for the next guess from anyone.
    io.to(code).emit("sync-progress", { guessedCount: playerIds.length, totalCount: playerIds.length });
    return;
  }

  room.players.forEach(p => { p.score += 1; });
  room.teamScore = (room.teamScore || 0) + 1;
  broadcastScoreboard(code);

  room.answered = true;
  clearTimeout(room.timer);

  flushCurrentRound(room, "everyone", elapsedMs);

  io.to(code).emit("emoji-correct", {
    emoji: room.currentEmoji,
    username: "Everyone",
    guess: sharedWord,
  });

  // Sync mode never ends on score — only the room-level timer ends it.
  setTimeout(() => spawnEmoji(code), 700);
}

io.on("connection", (socket) => {
  socket.on("create-room", ({ username, level, mode }) => {
    const code = generateRoomCode();
    rooms[code] = {
      players: new Map(),
      level: [1, 2, 3].includes(level) ? level : 1,
      mode: MODES.includes(mode) ? mode : "classic",
      currentEmoji: null,
      targetKeywords: [],
      foundKeywords: [],
      roundGuesses: new Map(),
      answered: false,
      finished: false,
      teamScore: 0,
      gameEndsAt: null,
      gameTimer: null,
      timer: null,
      started: false,
      startedAt: null,
      roundStartedAt: null,
      sessionDoc: null,
      currentRound: null,
    };
    rooms[code].players.set(socket.id, { username, score: 0, ready: false });
    socket.join(code);
    socket.data.roomCode = code;
    socket.emit("room-created", { code, level: rooms[code].level, mode: rooms[code].mode });
    broadcastLobby(code);
    broadcastScoreboard(code);
  });

  socket.on("join-room", ({ code, username }) => {
    code = (code || "").toUpperCase().trim();
    const room = rooms[code];
    if (!room) {
      socket.emit("join-error", { message: "Room not found." });
      return;
    }
    room.players.set(socket.id, { username, score: 0, ready: false });
    socket.join(code);
    socket.data.roomCode = code;
    socket.emit("room-joined", { code, level: room.level, mode: room.mode });
    broadcastLobby(code);
    broadcastScoreboard(code);
    // Note: joiners always land in the lobby, even if a round is currently
    // live in this room — they wait there (see gameInProgress in
    // lobby-update) until the room resets for the next game.
  });

  socket.on("toggle-ready", () => {
    const code = socket.data.roomCode;
    const room = rooms[code];
    if (!room || room.started) return;

    const player = room.players.get(socket.id);
    if (!player) return;
    player.ready = !player.ready;
    broadcastLobby(code);

    if (allPlayersReady(room)) {
      startGame(code);
    }
  });

  socket.on("submit-guess", ({ guess }) => {
    const code = socket.data.roomCode;
    const room = rooms[code];
    if (!room || !room.started || room.answered || !room.currentEmoji || room.finished) return;

    const normalized = (guess || "").trim().toLowerCase();
    const player = room.players.get(socket.id);
    const elapsedMs = room.roundStartedAt ? Date.now() - room.roundStartedAt : null;

    if (room.mode === "sync") {
      handleSyncGuess(code, room, socket, player, normalized, elapsedMs);
    } else {
      handleClassicGuess(code, room, socket, player, normalized, elapsedMs);
    }
  });

  socket.on("disconnect", () => {
    const code = socket.data.roomCode;
    const room = rooms[code];
    if (!room) return;
    room.players.delete(socket.id);
    if (room.players.size === 0) {
      endGame(code, "empty");
      delete rooms[code];
    } else {
      broadcastLobby(code);
      broadcastScoreboard(code);
      if (!room.started && allPlayersReady(room)) {
        startGame(code);
      }
    }
  });
});

const PORT = process.env.PORT || 3001;

connectDB().then((connected) => {
  dbConnected = connected;
  server.listen(PORT, () => console.log(`Emoji Blaster multiplayer server on :${PORT}`));
});
