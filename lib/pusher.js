// lib/pusher.js — shared Pusher server SDK instance + small trigger helper.
//
// Every /api handler that mutates room state calls publish() afterward to
// broadcast the resulting event(s) to everyone subscribed to that room's
// Pusher channel. This replaces socket.io's io.to(code).emit(...).

const Pusher = require("pusher");

let pusher = null;

function getPusher() {
  if (!pusher) {
    pusher = new Pusher({
      appId: process.env.PUSHER_APP_ID,
      key: process.env.PUSHER_KEY,
      secret: process.env.PUSHER_SECRET,
      cluster: process.env.PUSHER_CLUSTER,
      useTLS: true,
    });
  }
  return pusher;
}

function roomChannel(code) {
  return `room-${code}`;
}

// events: array of { name, data } to publish, in order. Pusher's batch
// trigger sends them as one HTTP call to Pusher's API instead of one per
// event.
async function publish(code, events) {
  if (!events || events.length === 0) return;
  const batch = events.map(({ name, data }) => ({
    channel: roomChannel(code),
    name,
    data,
  }));
  await getPusher().triggerBatch(batch);
}

module.exports = { getPusher, roomChannel, publish };
