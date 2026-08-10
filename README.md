# Emoji Blaster

A typing-defense game: type the keyword before the emoji lands. Play solo
across three difficulty levels, or create/join a room for real-time
multiplayer. Everything — landing page, solo game, and multiplayer server —
runs from a single Node.js + Express + Socket.io Web Service.

## What's in here

```
server.js          ← Express + Socket.io server (room logic, spawn, scoring)
db.js               ← MongoDB connection helper (optional analytics persistence)
models.js           ← Mongoose schema for saved game sessions
emojiDB.js          ← emoji → keyword list used by the multiplayer server (PLACEHOLDER — see note below)
package.json
public/
  index.html         ← landing page (Solo / Multiplayer mode select)
  game.html           ← solo game (vanilla JS + canvas, no external engine)
  game.js
  data.js             ← real, verified emoji → keyword dataset used by the solo game
  media/               ← solo game sound effects
  multiplayer.html    ← username entry, room create/join, game + scoreboard
  client.js            ← multiplayer.html's socket client
  style.css            ← shared styling for multiplayer.html
```

## ⚠️ `emojiDB.js` still has placeholder keyword data

`emojiDB.js` (used by the multiplayer server) was reconstructed from memory
and is NOT guaranteed to match the real dataset. The real, verified data
already lives in this repo at `public/data.js` (used by the solo game) — it
just hasn't been ported into `emojiDB.js`'s `{ "emoji": [...] }` shape yet.
Note also that `emojiDB.js` doesn't currently export a `sharedKeywords`
function, which `server.js` calls for Level 3 rooms.

## Running locally

```bash
npm install
npm start
```

Then open `http://localhost:3001`.

## Deploying on Render

This needs a **Web Service**, not a Static Site — Socket.io requires a
server process that stays running.

1. Connect this repo on Render.
2. **Build Command:** `npm install`
3. **Start Command:** `npm start`
4. (Optional) set `MONGODB_URI` under the service's Environment tab to
   persist game session analytics to MongoDB — without it, sessions just
   log to the console.

## Multiplayer modes

Chosen by the room creator when they create a room (joiners inherit it):

- **Race** — first player to land a correct keyword wins the point.
- **Sync** — the round only clears once every player in the room has
  submitted the *same* valid keyword. A mismatch resets everyone's guess
  for that round so players can re-sync. Points are awarded to everyone
  when the round clears.

Either mode ends the game as soon as a player reaches 10 points, showing a
"Game Over" screen with the winner and final scoreboard.

## Known limitations (current version)

- Both multiplayer modes only recreate Level 1's mechanic (single falling
  emoji, one keyword per round) — Levels 2 and 3's mechanics aren't ported
  to multiplayer yet, and Level 3 rooms will error given the missing
  `sharedKeywords` export noted above.
- Room data is in-memory only — if the server restarts, all active rooms
  and scores are lost.
- No reconnect/rejoin-with-same-score handling if a player's connection
  drops mid-game (in Sync mode, a disconnect mid-round can leave the
  remaining player's guess stuck waiting until they submit again).
- The solo game's sound effects are in `public/media/`, but `game.js`
  loads them from a `sounds/` path — audio silently fails to play.
