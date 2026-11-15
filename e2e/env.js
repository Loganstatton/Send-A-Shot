// Shared settings for the browser suites.
const path = require('path');
// The new-account trading limit (lib/db.ts marketLimits) is off for suites that create accounts and trade at
// once; e2e/market-maker.js turns it back on to test it.
if (process.env.NEXT_NEW_ACCOUNT_DAYS == null) process.env.NEXT_NEW_ACCOUNT_DAYS = '0';
module.exports = {
  ROOT: path.resolve(__dirname, '..'),
  // The local database from `npm run db:dev`; each suite uses its own fresh
  // schema in it (or, for main/guest, the database in E2E_DATABASE_URL).
  DEV_DB: process.env.E2E_DEV_DB || 'postgresql://postgres@127.0.0.1:54329/sas_dev',
};
