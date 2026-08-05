// models.js — Mongoose schemas for game analytics.

const mongoose = require("mongoose");

const guessSchema = new mongoose.Schema(
  {
    username: String,
    guess: String,
    correct: Boolean,
    elapsedMs: Number, // time since this round started, at the moment of this guess
    at: { type: Date, default: Date.now },
  },
  { _id: false }
);

const roundSchema = new mongoose.Schema(
  {
    // A single emoji for Levels 1 & 2, a pair [emojiA, emojiB] for Level 3.
    emoji: mongoose.Schema.Types.Mixed,
    level: Number,
    targetKeywords: [String],
    guesses: [guessSchema],
    completedBy: String, // username who cleared the round, or null if it was missed
    timeToCorrectMs: Number, // null if missed
    startedAt: Date,
    endedAt: Date,
  },
  { _id: false }
);

const gameSessionSchema = new mongoose.Schema({
  roomCode: { type: String, index: true },
  level: Number,
  usernames: [String],
  startedAt: Date,
  endedAt: Date,
  durationMs: Number,
  rounds: [roundSchema],
});

const GameSession = mongoose.models.GameSession || mongoose.model("GameSession", gameSessionSchema);

module.exports = { GameSession };
