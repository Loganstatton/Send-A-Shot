import { afterAll } from 'vitest';

// Runs in each test file's own module registry, before the file's imports.
// Gives the file a private, empty schema in the test database, so files
// never see each other's rows and every run starts clean — the same
// isolation the old one-SQLite-file-per-test-file setup gave.
const schema = `t_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
process.env.DATABASE_URL = process.env.TEST_DATABASE_URL;
process.env.DATABASE_SCHEMA = schema;

afterAll(async () => {
  const { db, closeDb } = await import('./lib/pg');
  try {
    await db.exec(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
  } finally {
    await closeDb();
  }
});
