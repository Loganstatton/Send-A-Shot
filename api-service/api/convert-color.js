const { applyCors, checkAuth, sendJson } = require('./_util');

function clamp(n, min, max) { return Math.min(max, Math.max(min, n)); }

function hexToRgb(hex) {
  hex = hex.replace('#', '').trim();
  if (hex.length === 3) hex = hex.split('').map((c) => c + c).join('');
  if (!/^[0-9a-fA-F]{6}$/.test(hex)) return null;
  const num = parseInt(hex, 16);
  return { r: (num >> 16) & 255, g: (num >> 8) & 255, b: num & 255 };
}
function rgbToHex(r, g, b) {
  return '#' + [r, g, b].map((v) => clamp(Math.round(v), 0, 255).toString(16).padStart(2, '0')).join('');
}
function rgbToHsl(r, g, b) {
  r /= 255; g /= 255; b /= 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b);
  let h, s;
  const l = (max + min) / 2;
  if (max === min) { h = s = 0; }
  else {
    const d = max - min;
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    switch (max) {
      case r: h = (g - b) / d + (g < b ? 6 : 0); break;
      case g: h = (b - r) / d + 2; break;
      default: h = (r - g) / d + 4; break;
    }
    h /= 6;
  }
  return { h: Math.round(h * 360), s: Math.round(s * 100), l: Math.round(l * 100) };
}
function parseRgbString(str) {
  const m = String(str).match(/(-?\d+(\.\d+)?)/g);
  if (!m || m.length < 3) return null;
  return { r: clamp(parseFloat(m[0]), 0, 255), g: clamp(parseFloat(m[1]), 0, 255), b: clamp(parseFloat(m[2]), 0, 255) };
}

module.exports = async function handler(req, res) {
  applyCors(res);
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (!checkAuth(req, res)) return;

  const { value, format } = req.query;
  if (!value) {
    return sendJson(res, 400, { error: 'Required query param: value. Optional: format (hex|rgb) to hint parsing.' });
  }

  let rgb = null;
  if (format === 'rgb' || /rgb/i.test(value)) rgb = parseRgbString(value);
  else rgb = hexToRgb(value) || parseRgbString(value);

  if (!rgb) {
    return sendJson(res, 400, { error: 'Could not parse color. Accepts HEX (#4f46e5) or RGB (rgb(79,70,229) or "79,70,229").' });
  }

  const hex = rgbToHex(rgb.r, rgb.g, rgb.b);
  const hsl = rgbToHsl(rgb.r, rgb.g, rgb.b);

  sendJson(res, 200, {
    hex,
    rgb: { r: rgb.r, g: rgb.g, b: rgb.b, css: `rgb(${rgb.r}, ${rgb.g}, ${rgb.b})` },
    hsl: { h: hsl.h, s: hsl.s, l: hsl.l, css: `hsl(${hsl.h}, ${hsl.s}%, ${hsl.l}%)` },
  });
};
