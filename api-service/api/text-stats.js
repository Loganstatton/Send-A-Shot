const { applyCors, checkAuth, sendJson } = require('./_util');

module.exports = async function handler(req, res) {
  applyCors(res);
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (!checkAuth(req, res)) return;

  const text = req.method === 'POST'
    ? (req.body && req.body.text) || ''
    : (req.query.text || '');

  if (typeof text !== 'string' || text.length === 0) {
    return sendJson(res, 400, { error: 'Provide "text" (POST body field, or ?text= query param).' });
  }
  if (text.length > 50000) {
    return sendJson(res, 400, { error: 'Text too long (50,000 character max).' });
  }

  const words = text.trim().length ? text.trim().split(/\s+/) : [];
  const sentences = text.split(/[.!?]+/).filter((s) => s.trim().length);
  const paragraphs = text.split(/\n+/).filter((p) => p.trim().length);

  sendJson(res, 200, {
    words: words.length,
    characters: text.length,
    charactersNoSpaces: text.replace(/\s/g, '').length,
    sentences: sentences.length,
    paragraphs: paragraphs.length,
    readingTimeMinutes: Math.max(1, Math.ceil(words.length / 200)),
  });
};
