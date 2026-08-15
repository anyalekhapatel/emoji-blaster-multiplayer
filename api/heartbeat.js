// POST /api/heartbeat — sent every 5s by any client sitting on the lobby or
// game screen. Replaces socket.io's "disconnect" event: a player who stops
// heartbeating (tab closed, network drop) gets pruned by the next heartbeat
// or state-mutating call that touches this room, matching the old
// disconnect handler's behavior (remove player, delete empty room, restart
// the ready-check).

const { getRoom, saveRoom, pruneStalePlayers, deleteRoom } = require("../lib/room-store");
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

  const room = await getRoom(code);
  if (!room) {
    res.status(404).json({ error: "Room not found" });
    return;
  }

  if (room.players[playerId]) room.players[playerId].lastSeenAt = Date.now();

  const removed = pruneStalePlayers(room);
  if (removed.length === 0) {
    await saveRoom(code, room);
    res.status(200).json({ ok: true });
    return;
  }

  if (Object.keys(room.players).length === 0) {
    await deleteRoom(code);
    res.status(200).json({ ok: true });
    return;
  }

  const events = [
    { name: "lobby-update", data: lobbyPayload(room) },
    { name: "scoreboard", data: getScoreboard(room) },
  ];
  if (!room.started && allPlayersReady(room)) events.push(...startGame(room));

  await saveRoom(code, room);
  await publish(code, events);

  res.status(200).json({ ok: true });
};
