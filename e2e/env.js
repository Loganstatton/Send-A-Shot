// Shared settings for the browser suites.
const path = require('path');
module.exports = {
  ROOT: path.resolve(__dirname, '..'),
  // The local database from `npm run db:dev`; each suite uses its own fresh
  // schema in it (or, for main/guest, the database in E2E_DATABASE_URL).
  DEV_DB: process.env.E2E_DEV_DB || 'postgresql://postgres@127.0.0.1:54329/sas_dev',
};
