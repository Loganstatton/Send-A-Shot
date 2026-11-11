import { Client } from 'pg';

// Runs once before the whole test run. Tests need a real Postgres (the same
// engine and driver production uses, so SQL and type behavior match):
// either the one TEST_DATABASE_URL points at, or a throwaway local server
// started from whatever Postgres is installed on this machine (see
// scripts/dev-db.js). Every test file then works in its own schema inside
// that database — see vitest.setup.ts.
export default async function setup() {
  if (!process.env.TEST_DATABASE_URL) {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { ensureLocalPostgres } = require('./scripts/dev-db.js');
    process.env.TEST_DATABASE_URL = ensureLocalPostgres('sas_test');
  }

  // Schemas left behind by an earlier run that was killed before its own
  // cleanup could run.
  const client = new Client({ connectionString: process.env.TEST_DATABASE_URL });
  await client.connect();
  try {
    const { rows } = await client.query("SELECT nspname FROM pg_namespace WHERE nspname LIKE 't\\_%'");
    for (const { nspname } of rows) await client.query(`DROP SCHEMA IF EXISTS "${nspname}" CASCADE`);
  } finally {
    await client.end();
  }
}
