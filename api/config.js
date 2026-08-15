// GET /api/config — public Pusher key/cluster the client needs to subscribe.
// PUSHER_KEY and PUSHER_CLUSTER are not secret (they identify the app to
// subscribe, same as any Pusher client-side integration); PUSHER_SECRET
// never leaves the server.

module.exports = async (req, res) => {
  if (req.method !== "GET") {
    res.status(405).json({ error: "Method not allowed" });
    return;
  }

  res.status(200).json({
    pusherKey: process.env.PUSHER_KEY || null,
    pusherCluster: process.env.PUSHER_CLUSTER || null,
  });
};
