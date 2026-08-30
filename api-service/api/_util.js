function applyCors(res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-RapidAPI-Proxy-Secret');
}

// When RAPIDAPI_PROXY_SECRET is set in the deployment's env vars, only
// requests carrying that header (added by RapidAPI's proxy) are served —
// this is what makes the RapidAPI listing the only paid path in instead of
// a free bypass. Unset (the default until a marketplace is wired up), the
// API is open so it can be built and tested.
function checkAuth(req, res) {
  const required = process.env.RAPIDAPI_PROXY_SECRET;
  if (!required) return true;
  const provided = req.headers['x-rapidapi-proxy-secret'];
  if (provided === required) return true;
  res.status(401).json({ error: 'Missing or invalid API credentials.' });
  return false;
}

function sendJson(res, status, body) {
  res.status(status).json(body);
}

module.exports = { applyCors, checkAuth, sendJson };
