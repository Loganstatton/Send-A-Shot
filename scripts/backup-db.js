#!/usr/bin/env node
// Writes a snapshot of the database to a local file — the standalone
// equivalent of the admin Backups page's "Back up now" + "Download", for
// anywhere with direct database access (local dev, or a machine allowed to
// reach the production database).
//
// Usage:
//   DATABASE_URL=postgresql://... node scripts/backup-db.js [output-file]
//
// Optional: DATABASE_SCHEMA (default "public"), DATABASE_SSL=1 for a server
// that requires TLS (e.g. Render's external database URL).
const fs = require('fs');
const path = require('path');
const { Client, types } = require('pg');
const { exportSnapshot } = require('../lib/snapshot-core');

types.setTypeParser(20, (v) => Number(v));
types.setTypeParser(1700, (v) => Number(v));

async function main() {
  if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is not set.');
  const schema = process.env.DATABASE_SCHEMA || 'public';
  const outFile = process.argv[2] || path.join(process.cwd(), `snapshot-${new Date().toISOString().replace(/[:.]/g, '-')}.json.gz`);

  const client = new Client({
    connectionString: process.env.DATABASE_URL,
    ssl: process.env.DATABASE_SSL === '1' ? { rejectUnauthorized: false } : undefined,
    options: `-c search_path=${schema}`,
  });
  await client.connect();
  try {
    await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
    const { data, rowCount } = await exportSnapshot(client);
    await client.query('COMMIT');
    fs.writeFileSync(outFile, data);
    console.log(`[backup-db] wrote ${outFile} (${rowCount} rows, ${(data.length / 1024).toFixed(1)} KB)`);
  } finally {
    await client.end();
  }
}

main().catch((err) => {
  console.error(`[backup-db] ${err.message}`);
  process.exit(1);
});
