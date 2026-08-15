const { updateRoom, pruneStalePlayers } = require("../lib/room-store");
const { setConsensusLevel, lobbyPayload, getScoreboard } = require("../lib/game-logic");
const { publish } = require("../lib/pusher");

module.exports = async (req, res) => {
  if (req.method !== "POST") {
    res.status(405).json({ error: "Method not allowed" });
    return;
  }

  const { code: rawCode, level } = req.body || {};
  const code = (rawCode || "").toUpperCase().trim();
  if (!code || !level) {
    res.status(400).json({ error: "code and level are required" });
    return;
  }

  const { room, result } = await updateRoom(code, (r) => {
    const removed = pruneStalePlayers(r);
    const { ok, events } = setConsensusLevel(r, Number(level));
    const toPublish = removed.length > 0
      ? [{ name: "lobby-update", data: lobbyPayload(r) }, { name: "scoreboard", data: getScoreboard(r) }, ...events]
      : events;
    return { ok, events: toPublish };
  });

  if (!room) {
    res.status(404).json({ error: "Room not found" });
    return;
  }

  await publish(code, result.events);
  res.status(200).json({ ok: result.ok });
};
