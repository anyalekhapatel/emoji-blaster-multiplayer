// POST /api/heartbeat — sent every 5s by any client sitting on the lobby or
// game screen. Replaces socket.io's "disconnect" event: a player who stops
// heartbeating (tab closed, network drop) gets pruned by the next heartbeat
// or state-mutating call that touches this room, matching the old
// disconnect handler's behavior (remove player, delete empty room, restart
// the ready-check).

const { updateRoom, pruneStalePlayers, deleteRoom } = require("../lib/room-store");
const { lobbyPayload, getScoreboard, allPlayersReady, startGame } = require("../lib/game-logic");
const { publish } = require("../lib/pusher");

module.exports = async (req, res) => {
  if (req.method !== "POST") {
    res.status(405).json({ error: "Method not allowed" });
    return;
  }

  const { code: rawCode, playerId } = req.body || {};
  const code = (rawCode || "").toUpperCase().trim();
  if (!code || !playerId) {
    res.status(400).json({ error: "code and playerId are required" });
    return;
  }

  const { room, result } = await updateRoom(code, async (r) => {
    if (r.players[playerId]) r.players[playerId].lastSeenAt = Date.now();

    const removed = pruneStalePlayers(r);
    if (removed.length === 0) return { events: [] };
    if (Object.keys(r.players).length === 0) return { empty: true, events: [] };

    const events = [
      { name: "lobby-update", data: lobbyPayload(r) },
      { name: "scoreboard", data: getScoreboard(r) },
    ];
    if (!r.started && allPlayersReady(r)) events.push(...(await startGame(r)));
    return { events };
  });

  if (!room) {
    res.status(404).json({ error: "Room not found" });
    return;
  }

  if (result.empty) {
    await deleteRoom(code);
  } else if (result.events.length > 0) {
    await publish(code, result.events);
  }

  res.status(200).json({ ok: true });
};
