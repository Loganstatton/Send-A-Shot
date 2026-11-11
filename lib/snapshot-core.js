// Logical snapshot export/restore for the app's Postgres database — shared
// by the running app (lib/db-backup.ts) and the standalone CLI scripts
// (scripts/backup-db.js, scripts/restore-db.js), which is why it is plain
// CommonJS taking any object with a pg-style `query(text, values)` method.
//
// A snapshot is one gzipped JSON document: every row of every app table,
// plus which schema migrations had been applied when it was taken. It is
// deliberately engine-neutral data rather than a pg_dump file, so it needs
// no Postgres client tools wherever it's taken or restored.
const zlib = require('zlib');

const FORMAT = 'sas-snapshot-v1';
// Never part of a snapshot: the snapshots themselves, the migration ledger
// (the restore target's own schema decides that, not old data), and
// app_settings (this installation's own session-signing key — it doesn't
// belong in a downloadable file, and restoring data shouldn't change it).
const EXCLUDED = new Set(['db_snapshots', 'schema_migrations', 'app_settings']);

async function listTables(q) {
  const { rows } = await q.query(
    "SELECT table_name FROM information_schema.tables WHERE table_schema = current_schema() AND table_type = 'BASE TABLE' ORDER BY table_name"
  );
  return rows.map((r) => r.table_name).filter((t) => !EXCLUDED.has(t));
}

// Call inside a REPEATABLE READ transaction so every table is read as of
// the same instant — otherwise a trade landing mid-export could appear in
// one table (the transaction row) and not another (the balance).
async function exportSnapshot(q) {
  const tables = {};
  let rowCount = 0;
  for (const table of await listTables(q)) {
    const { rows } = await q.query(`SELECT * FROM "${table}" ORDER BY id`);
    tables[table] = rows;
    rowCount += rows.length;
  }
  const migrations = (await q.query('SELECT id FROM schema_migrations ORDER BY id')).rows.map((r) => r.id);
  const json = JSON.stringify({ format: FORMAT, created_at: new Date().toISOString(), migrations, tables });
  return { data: zlib.gzipSync(Buffer.from(json, 'utf8')), rowCount };
}

function parseSnapshot(buffer) {
  let snapshot;
  try {
    snapshot = JSON.parse(zlib.gunzipSync(buffer).toString('utf8'));
  } catch (err) {
    throw new Error('Not a readable snapshot file (expected gzipped JSON).');
  }
  if (!snapshot || snapshot.format !== FORMAT || typeof snapshot.tables !== 'object') {
    throw new Error(`Not a ${FORMAT} snapshot.`);
  }
  return snapshot;
}

// Parents before children, so every row's foreign keys already exist when
// it is inserted.
async function insertOrder(q, tables) {
  const { rows } = await q.query(`
    SELECT c.relname AS child, p.relname AS parent
    FROM pg_constraint k
    JOIN pg_class c ON c.oid = k.conrelid
    JOIN pg_class p ON p.oid = k.confrelid
    JOIN pg_namespace n ON n.oid = k.connamespace
    WHERE k.contype = 'f' AND n.nspname = current_schema()
  `);
  const known = new Set(tables);
  const parentsOf = new Map(tables.map((t) => [t, new Set()]));
  for (const { child, parent } of rows) {
    if (child !== parent && known.has(child) && known.has(parent)) parentsOf.get(child).add(parent);
  }
  const ordered = [];
  const remaining = new Set(tables);
  while (remaining.size > 0) {
    const ready = [...remaining].filter((t) => [...parentsOf.get(t)].every((p) => !remaining.has(p))).sort();
    if (ready.length === 0) throw new Error(`Circular foreign keys among: ${[...remaining].join(', ')}`);
    for (const t of ready) {
      ordered.push(t);
      remaining.delete(t);
    }
  }
  return ordered;
}

// Replaces the contents of every app table with the snapshot's. MUST be
// called inside a transaction: on any error the caller rolls back and the
// database is exactly as it was. Columns are matched by name, so a snapshot
// taken before a later migration added a column still restores (the new
// column takes its default); a table or column the current schema no longer
// has is skipped and reported.
async function restoreSnapshot(q, buffer) {
  const snapshot = parseSnapshot(buffer);
  const tables = await listTables(q);
  const order = await insertOrder(q, tables);
  const skippedTables = Object.keys(snapshot.tables).filter((t) => !tables.includes(t) && !EXCLUDED.has(t));

  const emptyAll = `TRUNCATE ${tables.map((t) => `"${t}"`).join(', ')} RESTART IDENTITY CASCADE`;
  await q.query(emptyAll);

  let rowCount = 0;
  for (const table of order) {
    const rows = snapshot.tables[table] || [];
    if (rows.length === 0) continue;
    const { rows: columnRows } = await q.query(
      'SELECT column_name FROM information_schema.columns WHERE table_schema = current_schema() AND table_name = $1',
      [table]
    );
    const columns = columnRows.map((r) => r.column_name).filter((c) => Object.prototype.hasOwnProperty.call(rows[0], c));
    if (columns.length === 0) continue;
    // Postgres allows at most 65535 parameters per statement.
    const batchSize = Math.max(1, Math.floor(60000 / columns.length));
    for (let start = 0; start < rows.length; start += batchSize) {
      const batch = rows.slice(start, start + batchSize);
      const values = [];
      const tuples = batch.map((row) => {
        const placeholders = columns.map((c) => {
          values.push(row[c] === undefined ? null : row[c]);
          return `$${values.length}`;
        });
        return `(${placeholders.join(', ')})`;
      });
      await q.query(`INSERT INTO "${table}" (${columns.map((c) => `"${c}"`).join(', ')}) VALUES ${tuples.join(', ')}`, values);
    }
    rowCount += rows.length;
  }

  // Rows were inserted with their original ids; move each id sequence past
  // the highest one so the next new row doesn't collide.
  for (const table of tables) {
    await q.query(
      `SELECT setval(pg_get_serial_sequence($1, 'id'), COALESCE((SELECT MAX(id) FROM "${table}"), 0) + 1, false)`,
      [table]
    );
  }

  return { rowCount, tableCount: order.length, skippedTables, snapshotCreatedAt: snapshot.created_at };
}

module.exports = { FORMAT, exportSnapshot, restoreSnapshot, parseSnapshot };
