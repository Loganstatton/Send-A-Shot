const { applyCors, checkAuth, sendJson } = require('./_util');

const UNITS = {
  length: {
    meter: 1, kilometer: 1000, centimeter: 0.01, millimeter: 0.001,
    mile: 1609.344, yard: 0.9144, foot: 0.3048, inch: 0.0254,
  },
  weight: {
    kilogram: 1, gram: 0.001, milligram: 0.000001,
    pound: 0.45359237, ounce: 0.028349523125, stone: 6.35029318,
  },
};

function toCelsius(v, unit) {
  if (unit === 'celsius') return v;
  if (unit === 'fahrenheit') return (v - 32) * 5 / 9;
  if (unit === 'kelvin') return v - 273.15;
  return null;
}
function fromCelsius(c, unit) {
  if (unit === 'celsius') return c;
  if (unit === 'fahrenheit') return c * 9 / 5 + 32;
  if (unit === 'kelvin') return c + 273.15;
  return null;
}

module.exports = async function handler(req, res) {
  applyCors(res);
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (!checkAuth(req, res)) return;

  const { value, from, to, category } = req.query;
  const val = parseFloat(value);

  if (!category || !from || !to || isNaN(val)) {
    return sendJson(res, 400, {
      error: 'Required query params: category (length|weight|temperature), value, from, to.',
    });
  }

  let result;
  if (category === 'temperature') {
    const c = toCelsius(val, from);
    if (c === null) return sendJson(res, 400, { error: 'Unknown temperature unit: ' + from });
    result = fromCelsius(c, to);
    if (result === null) return sendJson(res, 400, { error: 'Unknown temperature unit: ' + to });
  } else if (UNITS[category]) {
    const table = UNITS[category];
    if (!table[from]) return sendJson(res, 400, { error: 'Unknown ' + category + ' unit: ' + from });
    if (!table[to]) return sendJson(res, 400, { error: 'Unknown ' + category + ' unit: ' + to });
    result = (val * table[from]) / table[to];
  } else {
    return sendJson(res, 400, { error: 'Unknown category. Use length, weight, or temperature.' });
  }

  sendJson(res, 200, {
    category, from, to,
    input: val,
    result: Math.round(result * 1e6) / 1e6,
  });
};
