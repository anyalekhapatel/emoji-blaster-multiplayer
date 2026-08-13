// client.js — Emoji Blaster multiplayer client

const socket = io();

const screens = {
  landing: document.getElementById("screen-landing"),
  lobby: document.getElementById("screen-lobby"),
  game: document.getElementById("screen-game"),
  gameover: document.getElementById("screen-gameover"),
};

const MODE_LABELS = {
  classic: "Race — first correct guess wins",
};

const CONSENSUS_REQUIRED = { 1: 2, 2: 3, 3: 4 };

const CONSENSUS_LABELS = {
  1: "Level 1 — Two-Player Match",
  2: "Level 2 — Three-Player Match",
  3: "Level 3 — Four-Player Match",
};

const CONSENSUS_DESCRIPTIONS = {
  1: "An emoji clears once at least 2 players enter the same keyword. The room can hold more than 2 — only 2 need to match.",
  2: "An emoji clears once at least 3 players independently enter the same keyword. The room can hold more than 3 — only 3 need to match.",
  3: "An emoji clears once at least 4 players enter the same keyword. The room can hold more than 4 — only 4 need to match.",
};

function formatModeLabel(mode, consensusLevel) {
  if (mode === "sync") {
    return `Sync — ${CONSENSUS_LABELS[consensusLevel] || CONSENSUS_LABELS[1]}`;
  }
  return MODE_LABELS[mode] || mode;
}

const SCOREBOARD_HINTS = {
  classic: "(first to 10 wins)",
  sync: "(shared team score — beat the clock!)",
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

// ---- Mode select (only matters for room creation; joiners inherit the room's mode) ----
const modeButtons = Array.from(document.querySelectorAll("#mode-select .btn-mode"));
let selectedMode = "classic";

modeButtons.forEach(btn => {
  btn.addEventListener("click", () => {
    selectedMode = btn.dataset.mode;
    modeButtons.forEach(b => b.classList.toggle("active", b === btn));
  });
});

createRoomBtn.addEventListener("click", () => {
  const username = getUsername();
  if (!username) return;
  socket.emit("create-room", { username, mode: selectedMode });
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
const lobbyMode = document.getElementById("lobby-mode");
const modeSmall = document.getElementById("mode-small");
const playerList = document.getElementById("player-list");
const lobbyStatus = document.getElementById("lobby-status");
const readyBtn = document.getElementById("ready-btn");
const consensusSelect = document.getElementById("consensus-select");
const consensusButtons = Array.from(document.querySelectorAll("#consensus-select .btn-mode"));
const consensusDescription = document.getElementById("consensus-description");

let currentRoomCode = null;
let currentMode = "classic";
let currentConsensusLevel = 1;
let iAmReady = false;

function enterRoom(code, mode, consensusLevel) {
  currentRoomCode = code;
  currentMode = mode || "classic";
  currentConsensusLevel = consensusLevel || 1;
  roomCodeDisplay.textContent = code;
  roomCodeSmall.textContent = code;
  const label = formatModeLabel(currentMode, currentConsensusLevel);
  lobbyMode.textContent = label;
  modeSmall.textContent = label;
  showScreen("lobby");
}

socket.on("room-created", ({ code, mode, consensusLevel }) => enterRoom(code, mode, consensusLevel));

socket.on("room-joined", ({ code, mode, consensusLevel }) => enterRoom(code, mode, consensusLevel));

consensusButtons.forEach(btn => {
  btn.addEventListener("click", () => {
    if (btn.disabled) return;
    socket.emit("set-consensus-level", { level: Number(btn.dataset.consensus) });
  });
});

socket.on("lobby-update", ({ players, mode, consensusLevel, gameInProgress, minPlayers }) => {
  currentMode = mode || currentMode;
  currentConsensusLevel = consensusLevel || currentConsensusLevel;
  lobbyMode.textContent = formatModeLabel(currentMode, currentConsensusLevel);

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

  const isSync = currentMode === "sync";
  consensusSelect.classList.toggle("hidden", !isSync);
  consensusDescription.classList.toggle("hidden", !isSync);
  if (isSync) {
    consensusDescription.textContent = CONSENSUS_DESCRIPTIONS[currentConsensusLevel] || "";
    consensusButtons.forEach(btn => {
      const level = Number(btn.dataset.consensus);
      const required = CONSENSUS_REQUIRED[level];
      const unlocked = players.length >= required;
      btn.disabled = !unlocked || gameInProgress;
      btn.classList.toggle("active", level === currentConsensusLevel);
      btn.title = unlocked ? "" : `Needs ${required} players in the room to pick this level`;
    });
  }

  if (gameInProgress) {
    lobbyStatus.textContent = "A game is in progress — you'll be able to ready up once it ends.";
    readyBtn.disabled = true;
  } else if (players.length < minPlayers) {
    lobbyStatus.textContent = `Waiting for at least ${minPlayers} players to join…`;
    readyBtn.disabled = false;
  } else {
    lobbyStatus.textContent = "";
    readyBtn.disabled = false;
  }
});

socket.on("room-reset", () => {
  iAmReady = false;
  readyBtn.textContent = "Ready Up";
  stopCountdown();
  showScreen("lobby");
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
const scoreboardHint = document.getElementById("scoreboard-hint");
const timerSmall = document.getElementById("timer-small");

let countdownInterval = null;

function stopCountdown() {
  clearInterval(countdownInterval);
  countdownInterval = null;
  timerSmall.textContent = "";
  timerSmall.classList.add("hidden");
}

function startCountdown(endsAt) {
  clearInterval(countdownInterval);
  timerSmall.classList.remove("hidden");

  function tick() {
    const remainingMs = Math.max(0, endsAt - Date.now());
    const totalSeconds = Math.ceil(remainingMs / 1000);
    const mm = String(Math.floor(totalSeconds / 60)).padStart(2, "0");
    const ss = String(totalSeconds % 60).padStart(2, "0");
    timerSmall.textContent = `⏱ ${mm}:${ss}`;
    if (remainingMs <= 0) clearInterval(countdownInterval);
  }

  tick();
  countdownInterval = setInterval(tick, 250);
}

socket.on("game-started", ({ mode, consensusLevel, endsAt }) => {
  showScreen("game");
  guessInput.value = "";
  guessInput.focus();
  currentMode = mode || currentMode;
  currentConsensusLevel = consensusLevel || currentConsensusLevel;
  modeSmall.textContent = formatModeLabel(currentMode, currentConsensusLevel);
  scoreboardHint.textContent = SCOREBOARD_HINTS[mode] || "";
  if (mode === "sync" && endsAt) {
    startCountdown(endsAt);
  } else {
    stopCountdown();
  }
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

// Never reveals which word anyone typed — just how close the room is to
// consensus (best overlap so far vs. how many are needed), so guessing
// stays private until the room actually lands on a shared word.
socket.on("sync-progress", ({ bestCount, required }) => {
  roundFeedback.textContent = `Closest match: ${bestCount}/${required} players — keep typing words until enough match!`;
});

socket.on("scoreboard", (entries) => {
  scoreboardList.innerHTML = "";
  entries.forEach(p => {
    const li = document.createElement("li");
    li.textContent = `${p.username} — ${p.score}`;
    scoreboardList.appendChild(li);
  });
});

// ---- Game over ----
const gameoverWinner = document.getElementById("gameover-winner");
const gameoverScoreboardList = document.getElementById("gameover-scoreboard-list");
const playAgainBtn = document.getElementById("play-again-btn");

socket.on("game-over", ({ mode, winner, teamScore, scoreboard }) => {
  stopCountdown();
  if (mode === "sync") {
    gameoverWinner.textContent = `Time's up! Your team synced ${teamScore} emoji together.`;
  } else {
    gameoverWinner.textContent = winner ? `${winner} wins with ${scoreboard[0].score} points!` : "Game over.";
  }
  gameoverScoreboardList.innerHTML = "";
  scoreboard.forEach(p => {
    const li = document.createElement("li");
    li.textContent = `${p.username} — ${p.score}`;
    gameoverScoreboardList.appendChild(li);
  });
  showScreen("gameover");
});

playAgainBtn.addEventListener("click", () => {
  window.location.reload();
});

function submitGuess() {
  const guess = guessInput.value.trim();
  if (!guess) return;
  socket.emit("submit-guess", { guess });
  guessInput.value = ""; // clear immediately so the next word can be typed right away — no "locking in"
}

guessInput.addEventListener("keydown", (e) => {
  if (e.key === "Enter") submitGuess();
});
