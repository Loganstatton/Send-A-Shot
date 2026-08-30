const crypto = require('crypto');
const { applyCors, checkAuth, sendJson } = require('./_util');

const FIRST_NAMES = ['James','Mary','Robert','Patricia','John','Jennifer','Michael','Linda','David','Elizabeth',
  'William','Barbara','Richard','Susan','Joseph','Jessica','Thomas','Sarah','Charles','Karen',
  'Ava','Noah','Emma','Liam','Olivia','Ethan','Sophia','Mason','Isabella','Lucas'];
const LAST_NAMES = ['Smith','Johnson','Williams','Brown','Jones','Garcia','Miller','Davis','Rodriguez','Martinez',
  'Hernandez','Lopez','Gonzalez','Wilson','Anderson','Thomas','Taylor','Moore','Jackson','Martin'];
const STREETS = ['Maple St','Oak Ave','Cedar Rd','Elm St','Pine Ln','Washington Ave','Sunset Blvd','Lake Dr','Hill St','River Rd'];
const CITIES = ['Springfield','Franklin','Greenville','Bristol','Clinton','Salem','Fairview','Georgetown','Madison','Arlington'];
const STATES = ['CA','TX','NY','FL','IL','PA','OH','GA','NC','MI'];
const DOMAINS = ['example.com', 'mailinator.com', 'testmail.dev'];

function pick(arr) {
  return arr[crypto.randomInt(0, arr.length)];
}

function makePerson() {
  const first = pick(FIRST_NAMES);
  const last = pick(LAST_NAMES);
  const streetNum = crypto.randomInt(100, 9999);
  return {
    firstName: first,
    lastName: last,
    fullName: `${first} ${last}`,
    email: `${first.toLowerCase()}.${last.toLowerCase()}${crypto.randomInt(1, 999)}@${pick(DOMAINS)}`,
    phone: `+1-${crypto.randomInt(200, 999)}-${crypto.randomInt(200, 999)}-${String(crypto.randomInt(0, 9999)).padStart(4, '0')}`,
    address: {
      street: `${streetNum} ${pick(STREETS)}`,
      city: pick(CITIES),
      state: pick(STATES),
      zip: String(crypto.randomInt(10000, 99999)),
    },
  };
}

module.exports = async function handler(req, res) {
  applyCors(res);
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (!checkAuth(req, res)) return;

  const count = Math.min(100, Math.max(1, parseInt(req.query.count, 10) || 1));
  const people = Array.from({ length: count }, makePerson);

  sendJson(res, 200, {
    note: 'Synthetic test data. Names, addresses, and contact details are randomly generated and do not correspond to real people.',
    count: people.length,
    people,
  });
};
