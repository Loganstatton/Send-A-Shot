const { applyCors, checkAuth, sendJson } = require('./_util');

module.exports = async function handler(req, res) {
  applyCors(res);
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (!checkAuth(req, res)) return;

  const { value } = req.query;

  if (!value || value === 'now') {
    const d = new Date();
    return sendJson(res, 200, {
      unixSeconds: Math.floor(d.getTime() / 1000),
      unixMilliseconds: d.getTime(),
      iso: d.toISOString(),
    });
  }

  let d;
  if (/^-?\d+$/.test(value)) {
    const n = Number(value);
    d = new Date(value.length > 10 ? n : n * 1000);
  } else {
    d = new Date(value);
  }

  if (isNaN(d.getTime())) {
    return sendJson(res, 400, { error: 'Could not parse "value" as a Unix timestamp (seconds or ms) or an ISO/date string.' });
  }

  sendJson(res, 200, {
    unixSeconds: Math.floor(d.getTime() / 1000),
    unixMilliseconds: d.getTime(),
    iso: d.toISOString(),
  });
};
