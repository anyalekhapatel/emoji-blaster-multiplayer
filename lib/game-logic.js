// lib/game-logic.js — pure game rules, ported from the original server.js.
//
// These functions mutate the plain JSON room object passed in and return
// the Pusher event(s) that resulted, instead of mutating an in-memory
// object and calling io.to(code).emit(...) directly. The calling /api
// handler is responsible for persisting the mutated room to KV and
// publishing the returned events.
//
// A correct guess that completes a round used to spawn the next emoji after
// a 700ms pause (setTimeout) so players could read the "got it!" message.
// There's no persistent process to hold that timer anymore, so functions
// that complete a round return { immediateEvents, delayedEvent } — the
// caller publishes immediateEvents right away, awaits ~700ms, then
// publishes delayedEvent. The room mutation for the next round happens
// synchronously either way, so KV always reflects the true current state.

const { EMOJI_DB, EMOJI_LIST, sharedKeywords } = require("../emojiDB");

const FALL_DURATION_MS = 8000;
const RETRY_LIMIT = 25;
const LEVEL2_REQUIRED = 2;
const WIN_SCORE = 10;
const SYNC_TIME_LIMIT_MS = 60000;
const MODES = ["classic", "sync"];
const MIN_PLAYERS = 2;
const REMATCH_DELAY_MS = 4000;
const CONSENSUS_REQUIRED = { 1: 2, 2: 3, 3: 4 };
const DEFAULT_CONSENSUS_LEVEL = 1;

function randChoice(arr) {
  return arr[Math.floor(Math.random() * arr.length)];
}

function getMinPlayers(room) {
  return room.mode === "sync"
    ? CONSENSUS_REQUIRED[room.consensusLevel] || CONSENSUS_REQUIRED[DEFAULT_CONSENSUS_LEVEL]
    : MIN_PLAYERS;
}

function getScoreboard(room) {
  return Object.values(room.players)
    .map((p) => ({ username: p.username, score: p.score }))
    .sort((a, b) => b.score - a.score);
}

function getPlayerList(room) {
  return Object.values(room.players).map((p) => ({ username: p.username, ready: p.ready }));
}

function allPlayersReady(room) {
  const players = Object.values(room.players);
  return players.length >= getMinPlayers(room) && players.every((p) => p.ready);
}

function lobbyPayload(room) {
  return {
    players: getPlayerList(room),
    level: room.level,
    mode: room.mode,
    consensusLevel: room.consensusLevel,
    consensusRequired: CONSENSUS_REQUIRED[room.consensusLevel] || null,
    minPlayers: getMinPlayers(room),
    gameInProgress: room.started && !room.finished,
  };
}

function createRoomState(code, mode, level, consensusLevel) {
  return {
    code,
    players: {},
    level: [1, 2, 3].includes(level) ? level : 1,
    mode: MODES.includes(mode) ? mode : "classic",
    consensusLevel: CONSENSUS_REQUIRED[consensusLevel] ? consensusLevel : DEFAULT_CONSENSUS_LEVEL,
    currentEmoji: null,
    targetKeywords: [],
    foundKeywords: [],
    roundGuesses: {},
    answered: false,
    finished: false,
    teamScore: 0,
    started: false,
    startedAt: null,
    roundStartedAt: null,
    roundEndsAt: null,
    gameEndsAt: null,
    resetAt: null,
    version: 0,
  };
}

function addPlayer(room, playerId, username) {
  room.players[playerId] = { username, score: 0, ready: false, lastSeenAt: Date.now() };
}

function spawnEmoji(room) {
  room.answered = false;
  room.foundKeywords = [];
  room.roundGuesses = {};
  room.roundStartedAt = Date.now();
  room.roundEndsAt = room.roundStartedAt + FALL_DURATION_MS;

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
    targetKeywords = EMOJI_DB[emojiForRound];
  }

  room.currentEmoji = emojiForRound;
  room.targetKeywords = targetKeywords;

  console.log("[analytics] emoji-shown", { code: room.code, emoji: emojiForRound, level: room.level });

  return { name: "emoji-spawn", data: { emoji: emojiForRound, fallDuration: FALL_DURATION_MS, level: room.level } };
}

function startGame(room) {
  room.started = true;
  room.startedAt = Date.now();
  room.teamScore = 0;

  let endsAt = null;
  if (room.mode === "sync") {
    endsAt = room.startedAt + SYNC_TIME_LIMIT_MS;
    room.gameEndsAt = endsAt;
  }

  console.log("[analytics] session-start", {
    code: room.code, level: room.level, mode: room.mode, consensusLevel: room.consensusLevel, startedAt: room.startedAt,
  });

  const startedEvent = {
    name: "game-started",
    data: {
      level: room.level,
      mode: room.mode,
      consensusLevel: room.consensusLevel,
      consensusRequired: CONSENSUS_REQUIRED[room.consensusLevel],
      endsAt,
    },
  };

  return [startedEvent, spawnEmoji(room)];
}

function resetRoomForNextGame(room) {
  room.started = false;
  room.finished = false;
  room.currentEmoji = null;
  room.targetKeywords = [];
  room.foundKeywords = [];
  room.roundGuesses = {};
  room.answered = false;
  room.startedAt = null;
  room.roundStartedAt = null;
  room.roundEndsAt = null;
  room.gameEndsAt = null;
  room.resetAt = null;
  room.teamScore = 0;
  Object.values(room.players).forEach((p) => { p.score = 0; p.ready = false; });

  return [
    { name: "room-reset", data: {} },
    { name: "lobby-update", data: lobbyPayload(room) },
    { name: "scoreboard", data: getScoreboard(room) },
  ];
}

// Classic mode: ends the game once a player reaches WIN_SCORE.
function checkGameOver(room) {
  if (room.finished) return null;
  const winner = Object.values(room.players).find((p) => p.score >= WIN_SCORE);
  if (!winner) return null;

  room.finished = true;
  room.resetAt = Date.now() + REMATCH_DELAY_MS;
  console.log("[analytics] session-end", { code: room.code, reason: "score-limit" });
  return { name: "game-over", data: { mode: "classic", winner: winner.username, scoreboard: getScoreboard(room) } };
}

// Sync mode: ends the game when the room-level timer runs out.
function finishSyncGame(room) {
  if (room.finished) return null;
  room.finished = true;
  room.resetAt = Date.now() + REMATCH_DELAY_MS;
  console.log("[analytics] session-end", { code: room.code, reason: "time-up" });
  return { name: "game-over", data: { mode: "sync", teamScore: room.teamScore || 0, scoreboard: getScoreboard(room) } };
}

function toggleReady(room, playerId) {
  const player = room.players[playerId];
  if (!player || room.started) return [];

  player.ready = !player.ready;
  const events = [{ name: "lobby-update", data: lobbyPayload(room) }];
  if (allPlayersReady(room)) events.push(...startGame(room));
  return events;
}

function setConsensusLevel(room, level) {
  if (room.started || room.mode !== "sync") return { ok: false, events: [] };
  const required = CONSENSUS_REQUIRED[level];
  if (!required || Object.keys(room.players).length < required) return { ok: false, events: [] };

  room.consensusLevel = level;
  return { ok: true, events: [{ name: "lobby-update", data: lobbyPayload(room) }] };
}

// Given the room's accumulated per-player guess lists, returns the highest
// number of distinct players currently sharing any one word, plus that word
// once it clears the room's consensus threshold (null until then).
function analyzeConsensus(room) {
  const counts = new Map();
  for (const words of Object.values(room.roundGuesses)) {
    for (const word of words) counts.set(word, (counts.get(word) || 0) + 1);
  }

  const required = CONSENSUS_REQUIRED[room.consensusLevel] || CONSENSUS_REQUIRED[DEFAULT_CONSENSUS_LEVEL];
  let bestCount = 0;
  let winningWord = null;
  for (const [word, count] of counts.entries()) {
    if (count > bestCount) bestCount = count;
    if (count >= required && !winningWord) winningWord = word;
  }
  return { bestCount, winningWord, required };
}

// Classic mode: first player to land any unclaimed valid keyword wins the
// point (Level 2 still requires LEVEL2_REQUIRED distinct keywords total).
function handleClassicGuess(room, playerId, normalized) {
  const player = room.players[playerId];
  const elapsedMs = room.roundStartedAt ? Date.now() - room.roundStartedAt : null;

  const isValidUnclaimed = room.targetKeywords.some(
    (k) => k.toLowerCase() === normalized && !room.foundKeywords.includes(k)
  );

  console.log("[analytics] guess-attempt", {
    code: room.code, username: player ? player.username : "?", guess: normalized,
    correct: isValidUnclaimed, level: room.level, mode: room.mode, elapsedMs,
  });

  if (!isValidUnclaimed) {
    return { immediateEvents: [], delayedEvent: null, response: { ok: false, reason: "wrong" } };
  }

  const matchedKeyword = room.targetKeywords.find(
    (k) => k.toLowerCase() === normalized && !room.foundKeywords.includes(k)
  );
  room.foundKeywords.push(matchedKeyword);

  const requiredCount = room.level === 2 ? LEVEL2_REQUIRED : 1;
  const roundComplete = room.foundKeywords.length >= requiredCount;

  if (player) player.score += 1;

  const immediateEvents = [{ name: "scoreboard", data: getScoreboard(room) }];
  let delayedEvent = null;

  if (roundComplete) {
    room.answered = true;
    immediateEvents.push({
      name: "emoji-correct",
      data: { emoji: room.currentEmoji, username: player ? player.username : "?", guess: normalized },
    });

    const gameOverEvent = checkGameOver(room);
    if (gameOverEvent) {
      immediateEvents.push(gameOverEvent);
    } else {
      delayedEvent = spawnEmoji(room); // 700ms pause before this publishes — see module header
    }
  } else {
    immediateEvents.push({
      name: "keyword-found",
      data: { username: player ? player.username : "?", guess: normalized, remaining: requiredCount - room.foundKeywords.length },
    });
  }

  return { immediateEvents, delayedEvent, response: { ok: true } };
}

// Sync mode: players type valid keywords freely — nothing "locks in". Each
// player accumulates a running list of every valid keyword they've typed
// THIS round, and as soon as the room's consensus threshold of players has
// independently typed the same word, the round clears. No guess text is
// ever broadcast before that point — only a private guess-wrong response to
// the person who typed it, and a headcount of how close the room is.
function handleSyncGuess(room, playerId, normalized) {
  const player = room.players[playerId];
  const elapsedMs = room.roundStartedAt ? Date.now() - room.roundStartedAt : null;
  const matchedKeyword = room.targetKeywords.find((k) => k.toLowerCase() === normalized);

  console.log("[analytics] guess-attempt", {
    code: room.code, username: player ? player.username : "?", guess: normalized,
    correct: !!matchedKeyword, level: room.level, mode: room.mode, elapsedMs,
  });

  if (!matchedKeyword) {
    return { immediateEvents: [], delayedEvent: null, response: { ok: false, reason: "wrong" } };
  }

  if (!room.roundGuesses[playerId]) room.roundGuesses[playerId] = [];
  if (!room.roundGuesses[playerId].includes(normalized)) room.roundGuesses[playerId].push(normalized);

  const { bestCount, winningWord, required } = analyzeConsensus(room);

  if (!winningWord) {
    return {
      immediateEvents: [{ name: "sync-progress", data: { bestCount, required, totalPlayers: Object.keys(room.players).length } }],
      delayedEvent: null,
      response: { ok: true },
    };
  }

  Object.values(room.players).forEach((p) => { p.score += 1; });
  room.teamScore = (room.teamScore || 0) + 1;
  room.answered = true;

  const immediateEvents = [
    { name: "scoreboard", data: getScoreboard(room) },
    { name: "emoji-correct", data: { emoji: room.currentEmoji, username: "Everyone", guess: winningWord } },
  ];

  // Sync mode never ends on score — only /api/game-timeout ends it.
  const delayedEvent = spawnEmoji(room);

  return { immediateEvents, delayedEvent, response: { ok: true } };
}

function handleSubmitGuess(room, playerId, guess) {
  const normalized = (guess || "").trim().toLowerCase();
  return room.mode === "sync"
    ? handleSyncGuess(room, playerId, normalized)
    : handleClassicGuess(room, playerId, normalized);
}

// The following resolve* functions are called by the client-nudged timeout
// endpoints. Each is idempotent: it re-checks the actual stored state before
// doing anything, so it's safe if multiple clients' local timers fire this
// around the same moment, or if it fires after the round/game/room was
// already resolved another way.

function resolveRoundTimeout(room) {
  if (!room.started || room.finished || room.answered) return null;
  if (!room.roundEndsAt || Date.now() < room.roundEndsAt) return null;

  console.log("[analytics] round-complete", { code: room.code, emoji: room.currentEmoji, completedBy: null });
  const missEvent = { name: "emoji-miss", data: { emoji: room.currentEmoji } };
  return [missEvent, spawnEmoji(room)];
}

function resolveGameTimeout(room) {
  if (room.mode !== "sync" || room.finished || !room.started) return null;
  if (!room.gameEndsAt || Date.now() < room.gameEndsAt) return null;

  const event = finishSyncGame(room);
  return event ? [event] : null;
}

function resolveRoomReset(room) {
  if (!room.finished) return null;
  if (room.resetAt && Date.now() < room.resetAt) return null;
  return resetRoomForNextGame(room);
}

module.exports = {
  FALL_DURATION_MS,
  SYNC_TIME_LIMIT_MS,
  REMATCH_DELAY_MS,
  MIN_PLAYERS,
  MODES,
  CONSENSUS_REQUIRED,
  DEFAULT_CONSENSUS_LEVEL,
  getMinPlayers,
  getScoreboard,
  getPlayerList,
  allPlayersReady,
  lobbyPayload,
  createRoomState,
  addPlayer,
  spawnEmoji,
  startGame,
  resetRoomForNextGame,
  checkGameOver,
  finishSyncGame,
  toggleReady,
  setConsensusLevel,
  handleSubmitGuess,
  resolveRoundTimeout,
  resolveGameTimeout,
  resolveRoomReset,
};
