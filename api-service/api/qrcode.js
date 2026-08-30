const QRCode = require('qrcode');
const { applyCors, checkAuth, sendJson } = require('./_util');

module.exports = async function handler(req, res) {
  applyCors(res);
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (!checkAuth(req, res)) return;

  const text = req.query.text;
  const size = Math.min(1000, Math.max(64, parseInt(req.query.size, 10) || 300));
  const format = req.query.format === 'base64' ? 'base64' : 'png';

  if (!text) {
    return sendJson(res, 400, { error: 'Required query param: text (the content to encode).' });
  }
  if (text.length > 2000) {
    return sendJson(res, 400, { error: 'text too long (2000 character max for a QR code).' });
  }

  try {
    const buffer = await QRCode.toBuffer(text, { width: size, margin: 2 });
    if (format === 'base64') {
      return sendJson(res, 200, { dataUri: `data:image/png;base64,${buffer.toString('base64')}` });
    }
    res.setHeader('Content-Type', 'image/png');
    res.setHeader('Cache-Control', 'public, max-age=86400');
    res.status(200).send(buffer);
  } catch (e) {
    sendJson(res, 500, { error: 'Failed to generate QR code: ' + e.message });
  }
};
