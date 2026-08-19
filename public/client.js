// client.js — Emoji Blaster multiplayer client (Vercel: fetch() + Pusher,
// no persistent socket). Every former socket.emit(...) is now a fetch()
// POST to /api/*; every former socket.on(...) is now a Pusher channel
// event binding. See lib/game-logic.js and the /api handlers for the
// server-side half of each of these.

const PLAYER_ID_KEY = "emoji-blaster-player-id";
function getPlayerId() {
  let id = sessionStorage.getItem(PLAYER_ID_KEY);
  if (!id) {
    id = crypto.randomUUID();
    sessionStorage.setItem(PLAYER_ID_KEY, id);
  }
  return id;
}
const playerId = getPlayerId();

async function api(path, body) {
  const res = await fetch(`/api/${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body || {}),
  });
  return res.json();
}

let pusher = null;
let channel = null;

async function connectPusher() {
  if (pusher) return pusher;
  const { pusherKey, pusherCluster } = await fetch("/api/config").then((r) => r.json());
  pusher = new Pusher(pusherKey, { cluster: pusherCluster });
  return pusher;
}

async function subscribeToRoom(code) {
  const p = await connectPusher();
  if (channel) p.unsubscribe(channel.name);
  channel = p.subscribe(`room-${code}`);
  bindChannelEvents(channel);
  return channel;
}

const screens = {
  landing: document.getElementById("screen-landing"),
  lobby: document.getElementById("screen-lobby"),
  game: document.getElementById("screen-game"),
  gameover: document.getElementById("screen-gameover"),
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

const MODE_LABELS = { sync: "Sync", double: "Double Sync" };

function formatModeLabel(mode, consensusLevel) {
  const modeLabel = MODE_LABELS[mode] || MODE_LABELS.sync;
  return `${modeLabel} — ${CONSENSUS_LABELS[consensusLevel] || CONSENSUS_LABELS[1]}`;
}

const SCOREBOARD_HINT = "(shared team score — beat the clock!)";

function showScreen(name) {
  Object.values(screens).forEach((s) => s.classList.add("hidden"));
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
let selectedMode = "sync";

modeButtons.forEach((btn) => {
  btn.addEventListener("click", () => {
    selectedMode = btn.dataset.mode;
    modeButtons.forEach((b) => b.classList.toggle("active", b === btn));
  });
});

createRoomBtn.addEventListener("click", async () => {
  const username = getUsername();
  if (!username) return;
  const data = await api("create-room", { username, mode: selectedMode, playerId });
  if (data.error) {
    landingError.textContent = data.error;
    landingError.classList.remove("hidden");
    return;
  }
  await subscribeToRoom(data.code);
  enterRoom(data.code, data.mode, data.consensusLevel);
  startHeartbeat(data.code);
  await resyncFromSnapshot(data.code);
});

joinRoomBtn.addEventListener("click", async () => {
  const username = getUsername();
  if (!username) return;
  const code = joinCodeInput.value.trim().toUpperCase();
  if (!code) {
    landingError.textContent = "Enter a room code.";
    landingError.classList.remove("hidden");
    return;
  }
  const data = await api("join-room", { code, username, playerId });
  if (data.error) {
    landingError.textContent = data.error;
    landingError.classList.remove("hidden");
    return;
  }
  await subscribeToRoom(data.code);
  enterRoom(data.code, data.mode, data.consensusLevel);
  startHeartbeat(data.code);
  await resyncFromSnapshot(data.code);
});

// ---- Heartbeat (replaces socket.io's connection/disconnect signal) ----
let heartbeatInterval = null;
function startHeartbeat(code) {
  clearInterval(heartbeatInterval);
  heartbeatInterval = setInterval(() => {
    api("heartbeat", { code, playerId });
  }, 5000);
}

// Fetches the current room snapshot right after subscribing, in case
// anything was published in the gap between the create/join response and
// the Pusher subscription completing.
async function resyncFromSnapshot(code) {
  try {
    const snap = await fetch(`/api/room-state?code=${encodeURIComponent(code)}`).then((r) => r.json());
    if (snap.error) return;
    applyLobbyUpdate(snap.lobby);
    applyScoreboard(snap.scoreboard);
  } catch (err) {
    // best-effort — live Pusher events will catch it up regardless
  }
}

// ---- Lobby ----
const roomCodeDisplay = document.getElementById("room-code-display");
const roomCodeSmall = document.getElementById("room-code-small");
const lobbyMode = document.getElementById("lobby-mode");
const modeSmall = document.getElementById("mode-small");
const playerList = document.getElementById("player-list");
const lobbyStatus = document.getElementById("lobby-status");
const readyBtn = document.getElementById("ready-btn");
const startNowBtn = document.getElementById("start-now-btn");
const consensusSelect = document.getElementById("consensus-select");
const consensusButtons = Array.from(document.querySelectorAll("#consensus-select .btn-mode"));
const consensusDescription = document.getElementById("consensus-description");

let currentRoomCode = null;
let currentMode = "sync";
let currentConsensusLevel = 1;
let iAmReady = false;

function enterRoom(code, mode, consensusLevel) {
  currentRoomCode = code;
  currentMode = mode || "sync";
  currentConsensusLevel = consensusLevel || 1;
  roomCodeDisplay.textContent = code;
  roomCodeSmall.textContent = code;
  const label = formatModeLabel(currentMode, currentConsensusLevel);
  lobbyMode.textContent = label;
  modeSmall.textContent = label;
  showScreen("lobby");
}

consensusButtons.forEach((btn) => {
  btn.addEventListener("click", () => {
    if (btn.disabled || !currentRoomCode) return;
    api("set-consensus-level", { code: currentRoomCode, level: Number(btn.dataset.consensus) });
  });
});

function applyLobbyUpdate({ players, mode, consensusLevel, gameInProgress, minPlayers }) {
  currentMode = mode || currentMode;
  currentConsensusLevel = consensusLevel || currentConsensusLevel;
  lobbyMode.textContent = formatModeLabel(currentMode, currentConsensusLevel);

  playerList.innerHTML = "";
  players.forEach((p) => {
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

  consensusDescription.textContent = CONSENSUS_DESCRIPTIONS[currentConsensusLevel] || "";
  consensusSelect.classList.remove("hidden");
  consensusDescription.classList.remove("hidden");
  consensusButtons.forEach((btn) => {
    const level = Number(btn.dataset.consensus);
    const required = CONSENSUS_REQUIRED[level];
    const unlocked = players.length >= required;
    btn.disabled = !unlocked || gameInProgress;
    btn.classList.toggle("active", level === currentConsensusLevel);
    btn.title = unlocked ? "" : `Needs ${required} players in the room to pick this level`;
  });

  const enoughToStart = players.length >= minPlayers;

  if (gameInProgress) {
    lobbyStatus.textContent = "A game is in progress — you'll be able to ready up once it ends.";
    readyBtn.disabled = true;
    startNowBtn.classList.add("hidden");
  } else if (!enoughToStart) {
    lobbyStatus.textContent = `Waiting for at least ${minPlayers} players to join…`;
    readyBtn.disabled = false;
    startNowBtn.classList.add("hidden");
  } else {
    lobbyStatus.textContent = "";
    readyBtn.disabled = false;
    // Once enough players are in the room, anyone can start the game even
    // if someone hasn't (or won't) hit Ready — one holdout shouldn't be
    // able to block everyone else indefinitely.
    startNowBtn.classList.remove("hidden");
  }
}

function applyScoreboard(entries) {
  scoreboardList.innerHTML = "";
  entries.forEach((p) => {
    const li = document.createElement("li");
    li.textContent = `${p.username} — ${p.score}`;
    scoreboardList.appendChild(li);
  });
}

readyBtn.addEventListener("click", () => {
  iAmReady = !iAmReady;
  readyBtn.textContent = iAmReady ? "Cancel Ready" : "Ready Up";
  api("toggle-ready", { code: currentRoomCode, playerId });
});

startNowBtn.addEventListener("click", () => {
  api("force-start", { code: currentRoomCode });
});

// ---- Game ----
const fallingEmojiEl = document.getElementById("falling-emoji");
const fallingEmoji2El = document.getElementById("falling-emoji-2");
const fallZone = document.getElementById("fall-zone");
const roundFeedback = document.getElementById("round-feedback");
const guessInput = document.getElementById("guess-input");
const scoreboardList = document.getElementById("scoreboard-list");
const scoreboardHint = document.getElementById("scoreboard-hint");
const timerSmall = document.getElementById("timer-small");

let countdownInterval = null;
let roundTimeoutHandle = null;
let gameTimeoutFired = false;

function stopCountdown() {
  clearInterval(countdownInterval);
  countdownInterval = null;
  timerSmall.textContent = "";
  timerSmall.classList.add("hidden");
}

function startCountdown(endsAt) {
  clearInterval(countdownInterval);
  gameTimeoutFired = false;
  timerSmall.classList.remove("hidden");

  function tick() {
    const remainingMs = Math.max(0, endsAt - Date.now());
    const totalSeconds = Math.ceil(remainingMs / 1000);
    const mm = String(Math.floor(totalSeconds / 60)).padStart(2, "0");
    const ss = String(totalSeconds % 60).padStart(2, "0");
    timerSmall.textContent = `⏱ ${mm}:${ss}`;
    if (remainingMs <= 0) {
      clearInterval(countdownInterval);
      if (!gameTimeoutFired) {
        gameTimeoutFired = true;
        api("game-timeout", { code: currentRoomCode });
      }
    }
  }

  tick();
  countdownInterval = setInterval(tick, 250);
}

function armRoundTimeout(fallDurationMs) {
  clearTimeout(roundTimeoutHandle);
  roundTimeoutHandle = setTimeout(() => {
    api("round-timeout", { code: currentRoomCode });
  }, fallDurationMs + 250); // small buffer past the visual fall duration
}

// Resets one falling-emoji element to the top and animates it down over
// fallDuration — shared by both slots so Double Sync's two emojis fall in
// lockstep with Sync's single one.
function dropEmoji(el, text, fallDuration) {
  el.textContent = text;
  el.style.transition = "none";
  el.style.top = "-80px";
  // Force reflow so the next transition actually animates from the top.
  void el.offsetHeight;
  el.style.transition = `top ${fallDuration}ms linear`;
  el.style.top = `${fallZone.clientHeight - 20}px`;
}

function bindChannelEvents(ch) {
  ch.bind("lobby-update", applyLobbyUpdate);
  ch.bind("scoreboard", applyScoreboard);

  ch.bind("room-reset", () => {
    iAmReady = false;
    readyBtn.textContent = "Ready Up";
    stopCountdown();
    clearTimeout(roundTimeoutHandle);
    showScreen("lobby");
  });

  ch.bind("game-started", ({ mode, consensusLevel, endsAt }) => {
    showScreen("game");
    guessInput.value = "";
    guessInput.focus();
    currentMode = mode || currentMode;
    currentConsensusLevel = consensusLevel || currentConsensusLevel;
    modeSmall.textContent = formatModeLabel(currentMode, currentConsensusLevel);
    scoreboardHint.textContent = SCOREBOARD_HINT;
    if (endsAt) {
      startCountdown(endsAt);
    } else {
      stopCountdown();
    }
  });

  ch.bind("emoji-spawn", ({ emoji, fallDuration }) => {
    roundFeedback.textContent = "";
    const emojis = Array.isArray(emoji) ? emoji : [emoji];

    dropEmoji(fallingEmojiEl, emojis[0], fallDuration);
    if (emojis.length > 1) {
      fallingEmojiEl.style.left = "30%";
      fallingEmoji2El.classList.remove("hidden");
      fallingEmoji2El.style.left = "70%";
      dropEmoji(fallingEmoji2El, emojis[1], fallDuration);
    } else {
      fallingEmojiEl.style.left = "50%";
      fallingEmoji2El.classList.add("hidden");
    }

    guessInput.value = "";
    guessInput.focus();
    armRoundTimeout(fallDuration);
  });

  ch.bind("emoji-correct", ({ username, guess }) => {
    clearTimeout(roundTimeoutHandle);
    roundFeedback.textContent = `${username} got it! ("${guess}")`;
  });

  ch.bind("emoji-miss", () => {
    clearTimeout(roundTimeoutHandle);
    roundFeedback.textContent = "Missed it — next one incoming…";
  });

  // Never reveals which word anyone typed — just how close the room is to
  // consensus (best overlap so far vs. how many are needed), so guessing
  // stays private until the room actually lands on a shared word.
  ch.bind("sync-progress", ({ bestCount, required }) => {
    roundFeedback.textContent = `Closest match: ${bestCount}/${required} players — keep typing words until enough match!`;
  });

  ch.bind("game-over", ({ teamScore, scoreboard }) => {
    clearTimeout(roundTimeoutHandle);
    stopCountdown();
    gameoverWinner.textContent = `Time's up! Your team synced ${teamScore} emoji together.`;
    gameoverScoreboardList.innerHTML = "";
    scoreboard.forEach((p) => {
      const li = document.createElement("li");
      li.textContent = `${p.username} — ${p.score}`;
      gameoverScoreboardList.appendChild(li);
    });
    showScreen("gameover");
    setTimeout(() => api("room-reset", { code: currentRoomCode }), 4000);
  });
}

// ---- Game over ----
const gameoverWinner = document.getElementById("gameover-winner");
const gameoverScoreboardList = document.getElementById("gameover-scoreboard-list");
const playAgainBtn = document.getElementById("play-again-btn");

playAgainBtn.addEventListener("click", () => {
  window.location.reload();
});

async function submitGuess() {
  const guess = guessInput.value.trim();
  if (!guess) return;
  guessInput.value = ""; // clear immediately so the next word can be typed right away — no "locking in"
  await api("submit-guess", { code: currentRoomCode, playerId, guess });
}

guessInput.addEventListener("keydown", (e) => {
  if (e.key === "Enter") submitGuess();
});
