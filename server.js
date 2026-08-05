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

let dbConnected = false;

// In-memory room store.
// rooms[code] = {
//   players: Map(socketId -> { username, score, ready }),
//   level: 1 | 2 | 3,
//   currentEmoji: string | [string, string],
//   targetKeywords: string[],
//   foundKeywords: string[],   // Level 2 progress this round
//   answered: bool,
//   timer: Timeout | null,
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
  io.to(code).emit("lobby-update", { players: getPlayerList(room), level: room.level });
}

function allPlayersReady(room) {
  const players = Array.from(room.players.values());
  return players.length > 0 && players.every((p) => p.ready);
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

function spawnEmoji(code) {
  const room = rooms[code];
  if (!room || room.players.size === 0) return;

  room.answered = false;
  room.foundKeywords = [];
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

  room.sessionDoc = new GameSession({
    roomCode: code,
    level: room.level,
    usernames: Array.from(room.players.values()).map((p) => p.username),
    startedAt: new Date(room.startedAt),
    rounds: [],
  });

  io.to(code).emit("game-started", { level: room.level });
  console.log(`[analytics] session-start`, { code, level: room.level, startedAt: room.startedAt });
  spawnEmoji(code);
}

function endGame(code, reason) {
  const room = rooms[code];
  if (!room) return;
  clearTimeout(room.timer);

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

io.on("connection", (socket) => {
  socket.on("create-room", ({ username, level }) => {
    const code = generateRoomCode();
    rooms[code] = {
      players: new Map(),
      level: [1, 2, 3].includes(level) ? level : 1,
      currentEmoji: null,
      targetKeywords: [],
      foundKeywords: [],
      answered: false,
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
    socket.emit("room-created", { code, level: rooms[code].level });
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
    socket.emit("room-joined", { code, level: room.level });
    broadcastLobby(code);
    broadcastScoreboard(code);

    if (room.started && room.currentEmoji) {
      socket.emit("game-started", { level: room.level });
      socket.emit("emoji-spawn", { emoji: room.currentEmoji, fallDuration: FALL_DURATION_MS, level: room.level });
    }
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
    if (!room || !room.started || room.answered || !room.currentEmoji) return;

    const normalized = (guess || "").trim().toLowerCase();
    const player = room.players.get(socket.id);
    const elapsedMs = room.roundStartedAt ? Date.now() - room.roundStartedAt : null;

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
      correct: isValidUnclaimed, level: room.level, elapsedMs,
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

      setTimeout(() => spawnEmoji(code), 700); // brief pause before next round
    } else {
      io.to(code).emit("keyword-found", {
        username: player ? player.username : "?",
        guess: normalized,
        remaining: requiredCount - room.foundKeywords.length,
      });
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
