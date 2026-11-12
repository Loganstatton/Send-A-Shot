// Runs every browser suite against a production build and the local dev
// Postgres. Usage (from the repo root):
//   npm run db:dev        # once — starts the local database
//   npm run build
//   npm run test:e2e
// main and guest need an empty database each, so one is created per run.
const { execFileSync, spawnSync } = require('child_process');
const path = require('path');
const { DEV_DB } = require('./env');

const SUITES = ['main', 'guest', 'leagues', 'onboarding', 'challenges', 'discovery', 'artist-requests', 'analytics', 'security', 'social', 'keyboard-check'];
const stamp = Date.now();
const fresh = (name) => {
  const db = `e2e_${name}_${stamp}`;
  execFileSync('psql', [DEV_DB, '-c', `CREATE DATABASE ${db}`], { stdio: 'ignore' });
  return DEV_DB.replace(/\/[^/]*$/, `/${db}`);
};

let failed = 0;
for (const suite of process.argv.length > 2 ? process.argv.slice(2) : SUITES) {
  const env = { ...process.env };
  if (suite === 'main' || suite === 'guest') env.E2E_DATABASE_URL = fresh(suite);
  console.log(`\n=== ${suite} ===`);
  const r = spawnSync('node', [path.join(__dirname, `${suite}.js`)], { env, stdio: 'inherit', timeout: 10 * 60_000 });
  if (r.status !== 0) failed++;
}
console.log(failed === 0 ? '\nAll browser suites passed.' : `\n${failed} suite(s) failed.`);
process.exit(failed === 0 ? 0 : 1);
