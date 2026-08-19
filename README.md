# Emoji Blaster

A typing party game: type the keyword before the emoji lands, in sync with
your team. Everyone types freely — an emoji clears once enough distinct
players have independently typed the same word — and the room races a 60s
clock together, not each other. Runs entirely on Vercel: a static
single-page frontend plus a set of serverless functions backed by Redis
(room state) and Pusher Channels (realtime broadcast).

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
emojiDB.js          ← emoji → keyword list used by the game (PLACEHOLDER — see note below)
lib/
  room-store.js      ← Redis read/write/prune helpers for room state, atomic
                         compare-and-swap via a Lua script (see note below)
  game-logic.js       ← pure game rules — spawning, consensus matching, scoring
  pusher.js            ← shared Pusher server SDK instance + publish helper
api/
  config.js          ← GET: public Pusher key/cluster for the client
  create-room.js      ← POST: create a room
  join-room.js         ← POST: join a room
  toggle-ready.js       ← POST: ready up / cancel ready
  force-start.js         ← POST: start the game once enough players are in,
                             even if not everyone's readied up
  set-consensus-level.js  ← POST: change a room's consensus level
  submit-guess.js           ← POST: submit a keyword guess
  round-timeout.js           ← POST: client-nudged "the falling emoji timed out" tick
  game-timeout.js              ← POST: client-nudged "the 60s clock ran out" tick
  room-reset.js                  ← POST: client-nudged "return to lobby after Game Over" tick
  heartbeat.js                     ← POST: keep-alive ping (replaces socket disconnect detection)
  room-state.js                      ← GET: room snapshot, used to resync right after joining
public/
  index.html         ← the whole app: username entry, room create/join, lobby, game, scoreboard
  client.js            ← fetch() calls + Pusher subscription behind index.html
  style.css             ← retro pixel-arcade theme
```

## ⚠️ `emojiDB.js` still has placeholder keyword data

`emojiDB.js` was reconstructed from memory and is NOT guaranteed to match a
verified dataset — swap it out if you have the real keyword lists.

## Deploying on Vercel

1. **Connect this repo** as a Vercel project (framework preset: Other — no
   build step needed; `vercel.json` pins this explicitly since the project
   was previously configured for a traditional Node server and Vercel's
   dashboard setting doesn't always update itself when the code changes).
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

## How a room works

Players type keywords freely — nothing ever "locks in." Each player
accumulates a running list of every valid keyword they've typed during the
current round, and as soon as enough distinct players have independently
typed the same word, the emoji clears. Nobody ever sees what anyone else
typed until that happens — only a private "wrong" nudge to whoever
mistyped, and a headcount of how close the room is to a match.

The game is timer-based (60s), not score-based: the shared team score is
however many emoji the room synced together before time ran out.

**Consensus levels**, picked in the lobby (not before anyone's joined,
since it needs to know how many players are actually in the room): Level 1
needs 2 players to agree, Level 2 needs 3, Level 3 needs 4. The room can
hold more players than the threshold — a 6-person room on Level 1 just
needs any 2 of those 6 to land on the same word. Each level stays locked
until enough players have joined to reach it.

A room auto-starts once everyone's clicked Ready, matching the current
consensus level's minimum. There's also a **Start Now** button that appears
once enough players have joined, regardless of ready state — so one player
sitting idle (or refusing to ready up) can't block the rest of the group
indefinitely.

A player who joins mid-game is held in the lobby — not dropped into the
live round — until the game ends and the room resets for a rematch.

## Known limitations (current version)

- Timers (the per-round fall duration, the 60s game clock, and the
  post-Game-Over pause before a room resets) are driven by each connected
  client's local countdown calling a dedicated `/api/*-timeout` endpoint
  when it elapses, since there's no persistent server process to hold a
  `setTimeout` — those endpoints are idempotent, so it's safe if multiple
  clients' timers fire around the same moment.
- Player presence is heartbeat-based (a ping every 5s, pruned after 20s of
  silence) rather than an instant disconnect signal, so a closed tab takes
  up to ~20s to be reflected for other players in the room.
- No MongoDB/analytics persistence — dropped in the Vercel migration (it
  was already best-effort). Key game events still log via `console.log`
  inside each `/api` handler, visible in Vercel's function logs.
