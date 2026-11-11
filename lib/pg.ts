import { AsyncLocalStorage } from 'node:async_hooks';
import { Pool, PoolClient, types } from 'pg';
import { MIGRATIONS } from './db-schema';

// The one place this app talks to Postgres. lib/db.ts used to be written
// against better-sqlite3 (`db.prepare(sql).get/all/run(...)`, `?` and
// `@name` placeholders, `info.lastInsertRowid`); this module keeps that same
// call shape on top of node-postgres so the ~150 query functions in
// lib/db.ts read the way they always have. The one unavoidable difference:
// every call is async and must be awaited.

// BIGINT and NUMERIC arrive from Postgres as strings by default (they can
// exceed a JS number's safe range). Nothing this app stores comes close —
// ids, cents, follower/view counts — and COUNT(*)/SUM() return these types,
// so parse them into the plain numbers every caller expects.
types.setTypeParser(20, (v) => Number(v));
types.setTypeParser(1700, (v) => Number(v));

export type RunResult = { changes: number; lastInsertRowid: number };

type State = { pool: Pool; schema: string; ready: Promise<void> | null };
type TxStore = { client: PoolClient; savepoints: number };

const tx = new AsyncLocalStorage<TxStore>();

// Keyed by connection + schema rather than a single global: Next's dev
// server re-evaluates this module on every hot reload (a plain module-level
// pool would leak a new set of connections each time), and each test file
// points at its own schema.
const registry: Map<string, State> = ((globalThis as any).__sasPgRegistry ??= new Map<string, State>());

function state(): State {
  const url = process.env.DATABASE_URL;
  if (!url) {
    throw new Error(
      'DATABASE_URL is not set. This app needs a Postgres database — see docs/DEPLOYMENT.md. ' +
      '(For local development: `npm run db:dev` starts one and prints the URL to use.)'
    );
  }
  const schema = process.env.DATABASE_SCHEMA || 'public';
  if (!/^[a-z_][a-z0-9_]*$/.test(schema)) throw new Error(`DATABASE_SCHEMA must be a plain lowercase identifier, got "${schema}"`);

  const key = `${url}|${schema}`;
  let s = registry.get(key);
  if (!s) {
    const pool = new Pool({
      connectionString: url,
      // Render's internal network needs no TLS; its external hostname (and
      // most other hosted Postgres) requires it.
      ssl: process.env.DATABASE_SSL === '1' ? { rejectUnauthorized: false } : undefined,
      max: Number(process.env.DATABASE_POOL_MAX ?? 10),
      idleTimeoutMillis: 30_000,
      connectionTimeoutMillis: 10_000,
      // Every connection works inside one schema. Production uses `public`;
      // staging and each test file use their own, on the same server.
      options: `-c search_path=${schema}`,
    });
    // An idle pooled connection dropping (database restart, network blip)
    // emits 'error' on the pool; unhandled, that would crash the process.
    // The pool discards that connection by itself and opens a new one.
    pool.on('error', (err) => console.error('[db] idle connection error:', err.message));
    s = { pool, schema, ready: null };
    registry.set(key, s);
  }
  return s;
}

// Creates the schema if needed and applies any migration not yet recorded.
// Runs once per process, before the first query. The advisory lock makes two
// processes booting at the same moment (a deploy overlapping the old
// instance, parallel serverless cold starts) apply migrations one after the
// other instead of racing each other through the same CREATE TABLE.
async function migrate(s: State): Promise<void> {
  const client = await s.pool.connect();
  try {
    await client.query('SELECT pg_advisory_lock(hashtext($1))', [`sas-migrate:${s.schema}`]);
    try {
      await client.query(`CREATE SCHEMA IF NOT EXISTS "${s.schema}"`);
      await client.query('CREATE TABLE IF NOT EXISTS schema_migrations (id TEXT PRIMARY KEY, applied_at TEXT NOT NULL)');
      const applied = new Set((await client.query('SELECT id FROM schema_migrations')).rows.map((r) => r.id as string));
      for (const m of MIGRATIONS) {
        if (applied.has(m.id)) continue;
        await client.query('BEGIN');
        try {
          await client.query(m.sql);
          await client.query('INSERT INTO schema_migrations (id, applied_at) VALUES ($1, $2)', [m.id, new Date().toISOString()]);
          await client.query('COMMIT');
        } catch (err) {
          await client.query('ROLLBACK');
          throw err;
        }
      }
    } finally {
      await client.query('SELECT pg_advisory_unlock(hashtext($1))', [`sas-migrate:${s.schema}`]);
    }
  } finally {
    client.release();
  }
}

function ready(s: State): Promise<void> {
  // A failed attempt (database briefly unreachable at boot) is forgotten so
  // the next query retries instead of the process staying broken forever.
  return (s.ready ??= migrate(s).catch((err) => {
    s.ready = null;
    throw err;
  }));
}

async function query(text: string, values?: unknown[]) {
  const active = tx.getStore();
  if (active) return active.client.query(text, values as any[]);
  const s = state();
  await ready(s);
  return s.pool.query(text, values as any[]);
}

type Compiled = { text: string; names: string[] | null; isInsert: boolean };

// Rewrites better-sqlite3 placeholders to Postgres's $1, $2, ...: either
// positional `?` (in order) or named `@name` (the same name may repeat and
// maps to the same parameter). Quoted strings, quoted identifiers and
// comments are copied through untouched, so a literal '?' or an email
// address inside a string is never mistaken for a placeholder.
export function compileSql(sql: string): Compiled {
  let out = '';
  let positional = 0;
  const names: string[] = [];
  let i = 0;
  while (i < sql.length) {
    const ch = sql[i];
    const next = sql[i + 1];
    if (ch === "'" || ch === '"') {
      let j = i + 1;
      while (j < sql.length) {
        if (sql[j] === ch) {
          if (sql[j + 1] === ch) { j += 2; continue; }
          break;
        }
        j++;
      }
      out += sql.slice(i, j + 1);
      i = j + 1;
    } else if (ch === '-' && next === '-') {
      const end = sql.indexOf('\n', i);
      const j = end === -1 ? sql.length : end;
      out += sql.slice(i, j);
      i = j;
    } else if (ch === '/' && next === '*') {
      const end = sql.indexOf('*/', i + 2);
      const j = end === -1 ? sql.length : end + 2;
      out += sql.slice(i, j);
      i = j;
    } else if (ch === '?') {
      out += `$${++positional}`;
      i++;
    } else if (ch === '@' && /[A-Za-z_]/.test(next ?? '')) {
      let j = i + 1;
      while (j < sql.length && /\w/.test(sql[j])) j++;
      const name = sql.slice(i + 1, j);
      let index = names.indexOf(name);
      if (index === -1) index = names.push(name) - 1;
      out += `$${index + 1}`;
      i = j;
    } else {
      out += ch;
      i++;
    }
  }
  if (positional > 0 && names.length > 0) throw new Error('A statement cannot mix ? and @name placeholders');
  const isInsert = /^\s*INSERT\b/i.test(sql);
  // better-sqlite3 hands back the new row's id as info.lastInsertRowid;
  // Postgres only tells you if you ask. Every table here has an `id` key.
  if (isInsert && !/\bRETURNING\b/i.test(sql)) out = `${out.replace(/;\s*$/, '')} RETURNING id`;
  return { text: out, names: names.length > 0 ? names : null, isInsert };
}

function toValue(v: unknown): unknown {
  if (v === undefined) return null;
  if (typeof v === 'boolean') return v ? 1 : 0;
  return v;
}

export class Statement {
  private compiled: Compiled | undefined;

  constructor(private readonly sql: string) {}

  private async execute(params: unknown[]) {
    const c = (this.compiled ??= compileSql(this.sql));
    let values: unknown[];
    if (c.names) {
      const bag = params[0];
      if (params.length !== 1 || bag == null || typeof bag !== 'object') {
        throw new Error('A statement with @name placeholders takes exactly one object of values');
      }
      values = c.names.map((name) => toValue((bag as Record<string, unknown>)[name]));
    } else {
      values = params.map(toValue);
    }
    return { compiled: c, result: await query(c.text, values) };
  }

  /** First row, or undefined when nothing matched. */
  async get(...params: unknown[]): Promise<unknown> {
    return (await this.execute(params)).result.rows[0];
  }

  async all(...params: unknown[]): Promise<unknown[]> {
    return (await this.execute(params)).result.rows;
  }

  async run(...params: unknown[]): Promise<RunResult> {
    const { compiled, result } = await this.execute(params);
    return {
      changes: result.rowCount ?? 0,
      lastInsertRowid: compiled.isInsert ? Number(result.rows[0]?.id ?? 0) : 0,
    };
  }
}

// Runs `fn` inside one database transaction: everything it does through
// `db` (including through any other function it calls — the transaction's
// connection follows the async call chain) commits together, or, if `fn`
// throws, none of it happens. Nested calls become savepoints, so an inner
// failure that the outer code catches rolls back only the inner part.
async function transaction<T>(fn: () => Promise<T>): Promise<T> {
  const active = tx.getStore();
  if (active) {
    const name = `sp_${++active.savepoints}`;
    await active.client.query(`SAVEPOINT ${name}`);
    try {
      const result = await fn();
      await active.client.query(`RELEASE SAVEPOINT ${name}`);
      return result;
    } catch (err) {
      await active.client.query(`ROLLBACK TO SAVEPOINT ${name}`);
      throw err;
    }
  }

  const s = state();
  await ready(s);
  const client = await s.pool.connect();
  try {
    await client.query('BEGIN');
    const result = await tx.run({ client, savepoints: 0 }, fn);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    try {
      await client.query('ROLLBACK');
    } catch {
      // The connection itself is gone; releasing it below discards it.
    }
    throw err;
  } finally {
    client.release();
  }
}

export const db = {
  prepare(sql: string): Statement {
    return new Statement(sql);
  },
  /** Runs one or more statements with no parameters. */
  async exec(sql: string): Promise<void> {
    await query(sql);
  },
  transaction,
  /** Raw passthrough using Postgres's own $1, $2 placeholders; joins the current db.transaction() if there is one. */
  async query(text: string, values?: unknown[]) {
    return query(text, values);
  },
  /** True while the calling code is running inside db.transaction(). */
  inTransaction(): boolean {
    return tx.getStore() != null;
  },
};

/** Postgres's unique-violation error (a duplicate key on a UNIQUE index). */
export function isUniqueViolation(err: unknown): boolean {
  return (err as { code?: string } | null)?.code === '23505';
}

/** Closes every pool this process opened — for scripts and test teardown. */
export async function closeDb(): Promise<void> {
  const all = [...registry.values()];
  registry.clear();
  await Promise.all(all.map((s) => s.pool.end()));
}
