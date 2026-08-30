const crypto = require('crypto');
const { applyCors, checkAuth, sendJson } = require('./_util');

const SETS = {
  lower: 'abcdefghijklmnopqrstuvwxyz',
  upper: 'ABCDEFGHIJKLMNOPQRSTUVWXYZ',
  digits: '0123456789',
  symbols: '!@#$%^&*()-_=+[]{};:,.<>?',
};
const AMBIGUOUS = 'l1IO0';

function generateOne(length, pool) {
  const bytes = crypto.randomBytes(length);
  let pw = '';
  for (let i = 0; i < length; i++) {
    pw += pool[bytes[i] % pool.length];
  }
  return pw;
}

function rate(pw, poolSize) {
  const entropyBits = Math.round(Math.log2(poolSize) * pw.length);
  let strength;
  if (entropyBits < 40) strength = 'weak';
  else if (entropyBits < 70) strength = 'moderate';
  else if (entropyBits < 100) strength = 'strong';
  else strength = 'very strong';
  return { entropyBits, strength };
}

module.exports = async function handler(req, res) {
  applyCors(res);
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (!checkAuth(req, res)) return;

  const q = req.query;
  const length = Math.min(128, Math.max(4, parseInt(q.length, 10) || 16));
  const count = Math.min(50, Math.max(1, parseInt(q.count, 10) || 1));
  const useLower = q.lowercase !== 'false';
  const useUpper = q.uppercase !== 'false';
  const useDigits = q.numbers !== 'false';
  const useSymbols = q.symbols === 'true';
  const excludeAmbiguous = q.exclude_ambiguous === 'true';

  let pool = '';
  if (useLower) pool += SETS.lower;
  if (useUpper) pool += SETS.upper;
  if (useDigits) pool += SETS.digits;
  if (useSymbols) pool += SETS.symbols;
  if (excludeAmbiguous) {
    pool = pool.split('').filter((c) => AMBIGUOUS.indexOf(c) === -1).join('');
  }
  if (!pool) {
    return sendJson(res, 400, { error: 'At least one character set must be enabled.' });
  }

  const passwords = Array.from({ length: count }, () => generateOne(length, pool));
  const { entropyBits, strength } = rate(passwords[0], pool.length);

  sendJson(res, 200, {
    passwords,
    length,
    entropyBits,
    strength,
  });
};
