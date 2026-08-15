# Emoji Blaster

A typing-defense game: type the keyword before the emoji lands. Play solo
across three difficulty levels, or create/join a room for real-time
multiplayer. Everything runs on Vercel: the landing page and solo game are
static files, and multiplayer is a set of serverless functions backed by
Redis (room state) and Pusher Channels (realtime broadcast).

## Why serverless + Redis + Pusher, not a Socket.io server

The original multiplayer server was a single long-running Express +
Socket.io process holding all room state in memory. That works on a
platform like Render (one persistent process), but not on Vercel, whose
functions are stateless and short-lived — no shared memory between
requests, no long-lived WebSocket. Room state now lives in Redis (shared
across every function invocation) and realtime updates go out over Pusher
Channels instead of a socket connection.

## What's in here

```
emojiDB.js          ← emoji → keyword list used by multiplayer (PLACEHOLDER — see note below)
lib/
  room-store.js      ← Redis read/write/prune helpers for room state
  game-logic.js       ← pure game rules (ported from the old server.js) — spawning,
                         scoring, classic/sync guess handling, consensus matching
  pusher.js            ← shared Pusher server SDK instance + publish helper
api/
  config.js          ← GET: public Pusher key/cluster for the client
  create-room.js      ← POST: create a room
  join-room.js         ← POST: join a room
  toggle-ready.js       ← POST: ready up / cancel ready
  set-consensus-level.js ← POST: change a Sync-mode room's consensus level
  submit-guess.js        ← POST: submit a keyword guess (classic or sync)
  round-timeout.js        ← POST: client-nudged "the falling emoji timed out" tick
  game-timeout.js          ← POST: client-nudged "sync mode's 60s clock ran out" tick
  room-reset.js             ← POST: client-nudged "return to lobby after Game Over" tick
  heartbeat.js               ← POST: keep-alive ping (replaces socket disconnect detection)
  room-state.js                ← GET: room snapshot, used to resync right after joining
public/
  index.html         ← landing page (Solo / Multiplayer mode select)
  game.html           ← solo game (vanilla JS + canvas, no external engine)
  game.js
  data.js             ← real, verified emoji → keyword dataset used by the solo game
  media/               ← solo game sound effects
  multiplayer.html    ← username entry, room create/join, game + scoreboard
  client.js            ← multiplayer.html's client — fetch() calls + Pusher subscription
  style.css            ← shared styling for multiplayer.html
```

## ⚠️ `emojiDB.js` still has placeholder keyword data

`emojiDB.js` (used by multiplayer) was reconstructed from memory and is NOT
guaranteed to match the real dataset. The real, verified data already lives
in this repo at `public/data.js` (used by the solo game) — it just hasn't
been ported into `emojiDB.js`'s `{ "emoji": [...] }` shape yet. Note also
that `emojiDB.js` doesn't export a `sharedKeywords` function, which
`lib/game-logic.js` calls for Level 3 rooms — this was already broken before
the Vercel migration and is out of scope here; multiplayer's `level` is
always 1 in practice since the client never exposes a way to change it.

## Deploying on Vercel

1. **Connect this repo** as a Vercel project (framework preset: Other — no
   build step needed).
2. **Add a Redis database**: in the Vercel dashboard, go to your project →
   Storage → Marketplace, and install an **Upstash for Redis** integration
   (Vercel's own "Vercel KV" product is deprecated — Upstash is the current
   path, and it's a generous free tier). Connecting it auto-injects the
   right env vars (`KV_REST_API_URL`/`KV_REST_API_TOKEN` or
   `UPSTASH_REDIS_REST_URL`/`UPSTASH_REDIS_REST_TOKEN` depending on how the
   integration names them — `lib/room-store.js` checks both).
3. **Create a Pusher account** at pusher.com → new **Channels** app → note
   the App ID, Key, Secret, and Cluster from its dashboard.
4. **Add environment variables** in Vercel project → Settings →
   Environment Variables:
   - `PUSHER_APP_ID`
   - `PUSHER_KEY`
   - `PUSHER_SECRET`
   - `PUSHER_CLUSTER`
5. **Redeploy.**

## Running locally

```bash
npm install
vercel env pull        # after steps 2-4 above, pulls the real env vars down
vercel dev
```

Then open the URL `vercel dev` prints (defaults to `http://localhost:3000`).

## Multiplayer modes

Chosen by the room creator when they create a room (joiners inherit it):

- **Race** — first player to land a correct keyword wins the point. Ends
  the game as soon as a player reaches 10 points.
- **Sync** — the room works together, not against each other. Players type
  keywords freely (no "locking in" — guesses accumulate across the round);
  an emoji clears once enough distinct players have independently typed the
  same word. Nobody ever sees what anyone else typed until that happens —
  only a private "wrong" nudge to whoever mistyped, and a headcount of how
  close the room is. Sync mode is timer-based (60s), not score-based: the
  shared team score is however many emoji the room synced before time ran
  out.

  **Consensus levels** (Sync mode only, picked in the lobby — not before
  anyone's joined, since it needs to know how many players are actually in
  the room): Level 1 needs 2 players to agree, Level 2 needs 3, Level 3
  needs 4. The room can hold more players than the threshold — a 6-person
  room on Level 1 just needs any 2 of those 6 to land on the same word.
  Each level is locked until enough players have joined to reach it.

Both modes require at least 2 ready players before a game starts (Sync
mode's minimum scales with its consensus level), and a player who joins
mid-game is held in the lobby — not dropped into the live round — until the
game ends and the room resets for a rematch.

## Known limitations (current version)

- Both multiplayer modes only recreate Level 1's mechanic (single falling
  emoji, one keyword per round) — Levels 2 and 3's difficulty mechanics
  aren't wired into multiplayer, and Level 3 rooms would error given the
  missing `sharedKeywords` export noted above (pre-existing, not new here).
- No MongoDB analytics persistence anymore (dropped in the Vercel
  migration — it was already best-effort). Key game events still log via
  `console.log` inside each `/api` handler, visible in Vercel's function
  logs.
- Timers (the per-round fall duration, Sync mode's 60s clock, and the
  post-Game-Over pause before a room resets) are driven by each connected
  client's local countdown calling a dedicated `/api/*-timeout` endpoint
  when it elapses, since there's no persistent server process to hold a
  `setTimeout` — those endpoints are idempotent, so it's safe if multiple
  clients' timers fire around the same moment.
- Player presence is heartbeat-based (a ping every 5s, pruned after 15s of
  silence) rather than an instant disconnect signal, so a closed tab takes
  up to ~15s to be reflected for other players in the room.
- The solo game's sound effects are in `public/media/`, but `game.js` loads
  them from a `sounds/` path — audio silently fails to play.
