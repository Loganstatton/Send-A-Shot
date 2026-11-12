#!/usr/bin/env node
// Starts (or stops) a local Postgres server for development and tests, using
// whatever Postgres is already installed on this machine — no Docker, no
// cloud account. Used two ways:
//
//   npm run db:dev        start it, create the dev database, print DATABASE_URL
//   npm run db:dev stop   stop it
//
// and by vitest.global-setup.ts, which calls ensureLocalPostgres() so
// `npm test` works without any setup beyond having Postgres installed.
//
// Data lives in ./data/pg (git-ignored). Port 54329, loopback only, no
// password — this is a throwaway local server, never a production one.
const { execFileSync, spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const PORT = Number(process.env.DEV_PG_PORT || 54329);
const IS_ROOT = typeof process.getuid === 'function' && process.getuid() === 0;
// Postgres refuses to run as root, so in a root-only container the server
// runs as the `postgres` system user, whose home is the one place that user
// can always write.
const DATA_DIR = process.env.DEV_PG_DIR || (IS_ROOT ? '/var/lib/postgresql/sas-dev' : path.join(__dirname, '..', 'data', 'pg'));

function findBinDir() {
  const candidates = [];
  try {
    candidates.push(execFileSync('pg_config', ['--bindir'], { encoding: 'utf8' }).trim());
  } catch {}
  for (const root of ['/usr/lib/postgresql', '/opt/homebrew/opt', '/usr/local/opt']) {
    if (!fs.existsSync(root)) continue;
    for (const entry of fs.readdirSync(root).sort().reverse()) {
      candidates.push(path.join(root, entry, 'bin'));
    }
  }
  for (const dir of (process.env.PATH || '').split(path.delimiter)) candidates.push(dir);
  const found = candidates.find((dir) => dir && fs.existsSync(path.join(dir, 'initdb')) && fs.existsSync(path.join(dir, 'pg_ctl')));
  if (!found) {
    throw new Error(
      'Could not find a local Postgres install (initdb/pg_ctl). Install Postgres 14+ ' +
      '(macOS: `brew install postgresql@16`, Debian/Ubuntu: `apt install postgresql`), ' +
      'or set DATABASE_URL / TEST_DATABASE_URL to a Postgres server you already have.'
    );
  }
  return found;
}

function run(bin, args, { allowFail = false } = {}) {
  const result = IS_ROOT
    ? spawnSync('su', ['postgres', '-c', [bin, ...args].map((a) => `'${String(a).replace(/'/g, `'\\''`)}'`).join(' ')], { encoding: 'utf8' })
    : spawnSync(bin, args, { encoding: 'utf8' });
  if (result.status !== 0 && !allowFail) {
    throw new Error(`${path.basename(bin)} failed: ${(result.stderr || result.stdout || '').trim()}`);
  }
  return result;
}

function urlFor(database) {
  return `postgresql://postgres@127.0.0.1:${PORT}/${database}`;
}

// Idempotent: initializes the data directory on first use, starts the
// server if it isn't already accepting connections, and makes sure
// `database` exists. Returns its connection URL.
function ensureLocalPostgres(database = 'sas_dev') {
  const bin = findBinDir();
  const isReady = () => run(path.join(bin, 'pg_isready'), ['-h', '127.0.0.1', '-p', String(PORT)], { allowFail: true }).status === 0;

  if (!isReady()) {
    if (!fs.existsSync(path.join(DATA_DIR, 'PG_VERSION'))) {
      fs.mkdirSync(DATA_DIR, { recursive: true });
      if (IS_ROOT) spawnSync('chown', ['postgres', DATA_DIR]);
      run(path.join(bin, 'initdb'), ['-D', DATA_DIR, '-A', 'trust', '-U', 'postgres', '--encoding=UTF8']);
    }
    run(path.join(bin, 'pg_ctl'), [
      '-D', DATA_DIR, '-w', '-l', path.join(DATA_DIR, 'server.log'),
      '-o', `-p ${PORT} -c listen_addresses=127.0.0.1 -c max_connections=200`,
      'start',
    ]);
  }

  const psql = path.join(bin, 'psql');
  const exists = spawnSync(psql, ['-h', '127.0.0.1', '-p', String(PORT), '-U', 'postgres', '-d', 'postgres', '-Atc', `SELECT 1 FROM pg_database WHERE datname = '${database}'`], { encoding: 'utf8' });
  if (exists.status !== 0) throw new Error(`psql failed: ${exists.stderr.trim()}`);
  if (exists.stdout.trim() !== '1') {
    const created = spawnSync(psql, ['-h', '127.0.0.1', '-p', String(PORT), '-U', 'postgres', '-d', 'postgres', '-c', `CREATE DATABASE ${database}`], { encoding: 'utf8' });
    if (created.status !== 0) throw new Error(`could not create database ${database}: ${created.stderr.trim()}`);
  }
  return urlFor(database);
}

function stopLocalPostgres() {
  const bin = findBinDir();
  run(path.join(bin, 'pg_ctl'), ['-D', DATA_DIR, '-m', 'fast', 'stop'], { allowFail: true });
}

module.exports = { ensureLocalPostgres, stopLocalPostgres };

if (require.main === module) {
  try {
    if (process.argv[2] === 'stop') {
      stopLocalPostgres();
      console.log('Local Postgres stopped.');
    } else {
      const url = ensureLocalPostgres('sas_dev');
      console.log('Local Postgres is running. Put this in .env.local:\n');
      console.log(`DATABASE_URL=${url}\n`);
    }
  } catch (err) {
    console.error(err.message);
    process.exit(1);
  }
}
