# Emoji Blaster — Multiplayer Server

A small Node.js + Socket.io server that adds real-time multiplayer to Emoji
Blaster: room codes, a synced falling emoji, and a live per-room scoreboard.

## What's in here

```
server.js         ← Express + Socket.io server (room logic, spawn, scoring)
emojiDB.js         ← emoji → keyword list (PLACEHOLDER — see note below)
package.json
public/
  index.html       ← landing page (Solo / Multiplayer choice)
  game.html         ← put your Construct 3 export's index.html here, renamed
  multiplayer.html  ← username entry, room create/join, game + scoreboard
```

## ⚠️ Replace the placeholder keyword data

`emojiDB.js` was reconstructed from memory of screenshots earlier in the
build process — it is NOT guaranteed to exactly match your real Construct 3
`EmojiDB` dictionary. Your Construct export includes a `data.json` file that
almost certainly has your real, verified keyword lists. Once you have that
file, either:

- Paste its contents into `emojiDB.js` in the same `{ "emoji": [...] }`
  shape, or
- Share it and it can be converted for you.

## Running locally

```bash
npm install
npm start
```

Then open `http://localhost:3001`.

## Deploying on Render

Unlike your existing static site, **this needs a Web Service**, not a
Static Site — Socket.io requires a server process that stays running (a
static site can only serve files, it can't hold open connections).

1. Push this folder to a new GitHub repo (or a new folder in your existing
   one — see note below).
2. On Render: **New +** → **Web Service** (not Static Site).
3. Connect the repo.
4. **Build Command:** `npm install`
5. **Start Command:** `npm start`
6. Deploy. Render will give you a URL like
   `https://emoji-blaster-multiplayer.onrender.com`.

### Important — this is a separate deployment from your current site

Your current `emoji-blaster.onrender.com` (Static Site) can't run this
server code. You have two options:

- **Simplest:** deploy this as a second, separate Render service
  (e.g. `emoji-blaster-multiplayer.onrender.com`), and have your existing
  landing page's Multiplayer button link out to that URL instead of a local
  page.
- **Cleaner long-term:** replace your static site entirely with this repo
  (it already serves the landing page and can serve `game.html` too), so
  everything — solo, multiplayer, and the landing page — runs from one
  Render Web Service instead of two separate deployments.

## Known limitations (current version)

- Only recreates Level 1's mechanic (single falling emoji, first correct
  keyword wins the point) — Levels 2 and 3's mechanics aren't ported to
  multiplayer yet.
- Room data is in-memory only — if the server restarts, all active rooms
  and scores are lost. Fine for casual play, not for anything needing
  persistence.
- No reconnect/rejoin-with-same-score handling if a player's connection
  drops mid-game.
