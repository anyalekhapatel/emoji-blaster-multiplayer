// client.js — Emoji Blaster multiplayer client

const socket = io();

const screens = {
  landing: document.getElementById("screen-landing"),
  lobby: document.getElementById("screen-lobby"),
  game: document.getElementById("screen-game"),
};

function showScreen(name) {
  Object.values(screens).forEach(s => s.classList.add("hidden"));
  screens[name].classList.remove("hidden");
}

// ---- Landing ----
const usernameInput = document.getElementById("username-input");
const createRoomBtn = document.getElementById("create-room-btn");
const joinCodeInput = document.getElementById("join-code-input");
const joinRoomBtn = document.getElementById("join-room-btn");
const landingError = document.getElementById("landing-error");

function getUsername() {
  const name = usernameInput.value.trim();
  if (!name) {
    landingError.textContent = "Enter a name first.";
    landingError.classList.remove("hidden");
    return null;
  }
  landingError.classList.add("hidden");
  return name;
}

createRoomBtn.addEventListener("click", () => {
  const username = getUsername();
  if (!username) return;
  socket.emit("create-room", { username });
});

joinRoomBtn.addEventListener("click", () => {
  const username = getUsername();
  if (!username) return;
  const code = joinCodeInput.value.trim().toUpperCase();
  if (!code) {
    landingError.textContent = "Enter a room code.";
    landingError.classList.remove("hidden");
    return;
  }
  socket.emit("join-room", { code, username });
});

socket.on("join-error", ({ message }) => {
  landingError.textContent = message;
  landingError.classList.remove("hidden");
});

// ---- Lobby ----
const roomCodeDisplay = document.getElementById("room-code-display");
const roomCodeSmall = document.getElementById("room-code-small");
const playerList = document.getElementById("player-list");
const readyBtn = document.getElementById("ready-btn");

let currentRoomCode = null;
let iAmReady = false;

socket.on("room-created", ({ code }) => {
  currentRoomCode = code;
  roomCodeDisplay.textContent = code;
  roomCodeSmall.textContent = code;
  showScreen("lobby");
});

socket.on("room-joined", ({ code }) => {
  currentRoomCode = code;
  roomCodeDisplay.textContent = code;
  roomCodeSmall.textContent = code;
  showScreen("lobby");
});

socket.on("lobby-update", ({ players }) => {
  playerList.innerHTML = "";
  players.forEach(p => {
    const li = document.createElement("li");
    const name = document.createElement("span");
    name.textContent = p.username;
    const badge = document.createElement("span");
    badge.className = "ready-badge" + (p.ready ? " ready" : "");
    badge.textContent = p.ready ? "Ready" : "Not ready";
    li.appendChild(name);
    li.appendChild(badge);
    playerList.appendChild(li);
  });
});

readyBtn.addEventListener("click", () => {
  iAmReady = !iAmReady;
  readyBtn.textContent = iAmReady ? "Cancel Ready" : "Ready Up";
  socket.emit("toggle-ready");
});

// ---- Game ----
const fallingEmojiEl = document.getElementById("falling-emoji");
const fallZone = document.getElementById("fall-zone");
const roundFeedback = document.getElementById("round-feedback");
const guessInput = document.getElementById("guess-input");
const scoreboardList = document.getElementById("scoreboard-list");

socket.on("game-started", () => {
  showScreen("game");
  guessInput.value = "";
  guessInput.focus();
});

socket.on("emoji-spawn", ({ emoji, fallDuration }) => {
  roundFeedback.textContent = "";
  fallingEmojiEl.textContent = emoji;
  fallingEmojiEl.style.transition = "none";
  fallingEmojiEl.style.top = "-80px";
  // Force reflow so the next transition actually animates from the top.
  void fallingEmojiEl.offsetHeight;
  fallingEmojiEl.style.transition = `top ${fallDuration}ms linear`;
  fallingEmojiEl.style.top = `${fallZone.clientHeight - 20}px`;
  guessInput.value = "";
  guessInput.focus();
});

socket.on("emoji-correct", ({ username, guess }) => {
  roundFeedback.textContent = `${username} got it! ("${guess}")`;
});

socket.on("emoji-miss", () => {
  roundFeedback.textContent = "Missed it — next one incoming…";
});

socket.on("scoreboard", (entries) => {
  scoreboardList.innerHTML = "";
  entries.forEach(p => {
    const li = document.createElement("li");
    li.textContent = `${p.username} — ${p.score}`;
    scoreboardList.appendChild(li);
  });
});

function submitGuess() {
  const guess = guessInput.value.trim();
  if (!guess) return;
  socket.emit("submit-guess", { guess });
}

guessInput.addEventListener("keydown", (e) => {
  if (e.key === "Enter") submitGuess();
});
