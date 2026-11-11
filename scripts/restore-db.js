#!/usr/bin/env node
// Restores a snapshot FILE (downloaded from the admin Backups page, or
// written by backup-db.js) into a database — replacing everything in it.
// This is the disaster-recovery path: it works against a brand-new, empty
// database with nobody able to sign in yet. (To roll the live app back to a
// snapshot it still holds, the admin Backups page's Restore does the same
// thing without needing direct database access.)
//
// Usage:
//   DATABASE_URL=postgresql://... node scripts/restore-db.js <snapshot.json.gz> --yes
//
// Optional: DATABASE_SCHEMA (default "public"), DATABASE_SSL=1.
//
// The target's tables must already exist — start the app against it once
// (it creates its own schema on first query) before restoring. The whole
// restore is one transaction: if anything fails, the target is untouched.
const fs = require('fs');
const { Client, types } = require('pg');
const { restoreSnapshot } = require('../lib/snapshot-core');

types.setTypeParser(20, (v) => Number(v));
types.setTypeParser(1700, (v) => Number(v));

async function main() {
  const file = process.argv[2];
  const confirmed = process.argv.includes('--yes');
  if (!file) throw new Error('Usage: node scripts/restore-db.js <snapshot.json.gz> --yes');
  if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is not set.');
  if (!fs.existsSync(file)) throw new Error(`No such file: ${file}`);
  if (!confirmed) {
    throw new Error('This REPLACES every table in the target database with the snapshot. Re-run with --yes to proceed.');
  }
  const schema = process.env.DATABASE_SCHEMA || 'public';

  const client = new Client({
    connectionString: process.env.DATABASE_URL,
    ssl: process.env.DATABASE_SSL === '1' ? { rejectUnauthorized: false } : undefined,
    options: `-c search_path=${schema}`,
  });
  await client.connect();
  try {
    await client.query('BEGIN');
    try {
      const result = await restoreSnapshot(client, fs.readFileSync(file));
      await client.query('COMMIT');
      console.log(`[restore-db] restored ${result.rowCount} rows into ${result.tableCount} tables (snapshot taken ${result.snapshotCreatedAt}).`);
      if (result.skippedTables.length) console.log(`[restore-db] skipped tables not in the current schema: ${result.skippedTables.join(', ')}`);
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    }
  } finally {
    await client.end();
  }
}

main().catch((err) => {
  console.error(`[restore-db] ${err.message}`);
  process.exit(1);
});
