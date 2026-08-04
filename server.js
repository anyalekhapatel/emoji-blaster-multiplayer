const express = require("express");
const http = require("http");
const { Server } = require("socket.io");
const path = require("path");
const { EMOJI_DB, EMOJI_LIST } = require("./emojiDB");

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.static(path.join(__dirname, "public")));

const FALL_DURATION_MS = 8000; // how long an emoji is "live" before it's a miss

// In-memory room store. Rooms are ephemeral — this is fine for a game like
// this (no persistence needed), and keeps the whole thing dependency-free.
// rooms[code] = {
//   players: Map(socketId -> { username, score }),
//   currentEmoji: string | null,
//   answered: bool,
//   timer: Timeout | null,
//   started: bool
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

function broadcastScoreboard(code) {
  const room = rooms[code];
  if (!room) return;
  io.to(code).emit("scoreboard", getScoreboard(room));
}

function spawnEmoji(code) {
  const room = rooms[code];
  if (!room || room.players.size === 0) return;

  const emoji = EMOJI_LIST[Math.floor(Math.random() * EMOJI_LIST.length)];
  room.currentEmoji = emoji;
  room.answered = false;

  io.to(code).emit("emoji-spawn", { emoji, fallDuration: FALL_DURATION_MS });

  clearTimeout(room.timer);
  room.timer = setTimeout(() => {
    if (!room.answered) {
      io.to(code).emit("emoji-miss", { emoji });
      spawnEmoji(code);
    }
  }, FALL_DURATION_MS);
}

io.on("connection", (socket) => {
  socket.on("create-room", ({ username }) => {
    const code = generateRoomCode();
    rooms[code] = {
      players: new Map(),
      currentEmoji: null,
      answered: false,
      timer: null,
      started: false,
    };
    rooms[code].players.set(socket.id, { username, score: 0 });
    socket.join(code);
    socket.data.roomCode = code;
    socket.emit("room-created", { code });
    broadcastScoreboard(code);
  });

  socket.on("join-room", ({ code, username }) => {
    code = (code || "").toUpperCase().trim();
    const room = rooms[code];
    if (!room) {
      socket.emit("join-error", { message: "Room not found." });
      return;
    }
    room.players.set(socket.id, { username, score: 0 });
    socket.join(code);
    socket.data.roomCode = code;
    socket.emit("room-joined", { code });
    broadcastScoreboard(code);

    // If a round is already in progress, catch this player up.
    if (room.started && room.currentEmoji) {
      socket.emit("emoji-spawn", { emoji: room.currentEmoji, fallDuration: FALL_DURATION_MS });
    }
  });

  socket.on("start-game", () => {
    const code = socket.data.roomCode;
    const room = rooms[code];
    if (!room || room.started) return;
    room.started = true;
    io.to(code).emit("game-started");
    spawnEmoji(code);
  });

  socket.on("submit-guess", ({ guess }) => {
    const code = socket.data.roomCode;
    const room = rooms[code];
    if (!room || !room.started || room.answered || !room.currentEmoji) return;

    const normalized = (guess || "").trim().toLowerCase();
    const validKeywords = EMOJI_DB[room.currentEmoji] || [];

    if (validKeywords.includes(normalized)) {
      room.answered = true;
      clearTimeout(room.timer);

      const player = room.players.get(socket.id);
      if (player) player.score += 1;

      io.to(code).emit("emoji-correct", {
        emoji: room.currentEmoji,
        username: player ? player.username : "?",
        guess: normalized,
      });

      broadcastScoreboard(code);
      setTimeout(() => spawnEmoji(code), 700); // brief pause before next round
    }
  });

  socket.on("disconnect", () => {
    const code = socket.data.roomCode;
    const room = rooms[code];
    if (!room) return;
    room.players.delete(socket.id);
    if (room.players.size === 0) {
      clearTimeout(room.timer);
      delete rooms[code];
    } else {
      broadcastScoreboard(code);
    }
  });
});

const PORT = process.env.PORT || 3001;
server.listen(PORT, () => console.log(`Emoji Blaster multiplayer server on :${PORT}`));
