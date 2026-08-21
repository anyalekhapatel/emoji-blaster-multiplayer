// Server-side proxy for the QMoji Arcade API, used only by local dev
// (`vercel dev`). Browser calls to the real API from a localhost origin are
// blocked by its CORS allowlist (*.vercel.app / listed onrender.com origins
// only), so local dev forwards /arcade-api/v1/* itself -- a server-to-server
// request isn't subject to browser CORS at all. Production deploys talk to
// the real API directly (see public/arcade-client.js's isLocal() check) and
// never hit this route; the vercel.json rewrite that points /arcade-api/v1/*
// here is simply unused in prod, not disabled.
const ARCADE_API_ORIGIN = "https://qmoji-arcade-api.vercel.app";

module.exports = async (req, res) => {
  const segments = Array.isArray(req.query.path) ? req.query.path : [req.query.path].filter(Boolean);
  const targetPath = "/api/v1/" + segments.map(encodeURIComponent).join("/");

  const query = new URLSearchParams();
  Object.entries(req.query).forEach(([key, value]) => {
    if (key === "path") return;
    (Array.isArray(value) ? value : [value]).forEach((v) => query.append(key, v));
  });
  const qs = query.toString();

  const init = { method: req.method, headers: { "Content-Type": "application/json" } };
  if (req.method !== "GET" && req.method !== "HEAD") {
    init.body = JSON.stringify(req.body || {});
  }

  try {
    const upstream = await fetch(ARCADE_API_ORIGIN + targetPath + (qs ? "?" + qs : ""), init);
    const text = await upstream.text();
    res.status(upstream.status);
    res.setHeader("Content-Type", upstream.headers.get("content-type") || "application/json");
    res.send(text);
  } catch (err) {
    res.status(502).json({ error: "arcade_proxy_failed", message: err.message });
  }
};
