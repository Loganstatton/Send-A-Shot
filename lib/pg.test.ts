import { describe, expect, it } from 'vitest';

const { compileSql, db, isUniqueViolation } = await import('./pg');
const { MIGRATIONS } = await import('./db-schema');

describe('compileSql — placeholder translation', () => {
  it('numbers positional ? placeholders in order', () => {
    expect(compileSql('SELECT * FROM t WHERE a = ? AND b = ?').text).toBe('SELECT * FROM t WHERE a = $1 AND b = $2');
  });

  it('maps @named placeholders, reusing the number when a name repeats', () => {
    const c = compileSql('UPDATE t SET a = @a, b = @b WHERE id = @id OR parent = @id');
    expect(c.text).toBe('UPDATE t SET a = $1, b = $2 WHERE id = $3 OR parent = $3');
    expect(c.names).toEqual(['a', 'b', 'id']);
  });

  it('leaves ? and @ alone inside string literals, quoted identifiers and comments', () => {
    const sql = `SELECT '?' AS q, 'a@b.com' AS e, "odd?col" -- really? @nope\n FROM t /* ? @x */ WHERE a = ?`;
    const c = compileSql(sql);
    expect(c.text).toBe(`SELECT '?' AS q, 'a@b.com' AS e, "odd?col" -- really? @nope\n FROM t /* ? @x */ WHERE a = $1`);
    expect(c.names).toBeNull();
  });

  it("handles an escaped quote ('') inside a string", () => {
    expect(compileSql("SELECT 'it''s ?' , ?").text).toBe("SELECT 'it''s ?' , $1");
  });

  it('adds RETURNING id to an INSERT, but not when one is already there or for other statements', () => {
    expect(compileSql('INSERT INTO t (a) VALUES (?)').text).toBe('INSERT INTO t (a) VALUES ($1) RETURNING id');
    expect(compileSql('INSERT INTO t (a) VALUES (?) RETURNING a').text).toBe('INSERT INTO t (a) VALUES ($1) RETURNING a');
    expect(compileSql('UPDATE t SET a = ?').text).toBe('UPDATE t SET a = $1');
  });

  it('refuses a statement mixing both placeholder styles', () => {
    expect(() => compileSql('SELECT ? , @a')).toThrow(/cannot mix/);
  });
});

describe('Statement — get / all / run against a real table', () => {
  it('run() reports the new id and affected-row count; get()/all() read rows back with real number types', async () => {
    const first = await db.prepare("INSERT INTO sync_runs (started_at, status, source) VALUES (?, 'running', ?)").run('2026-01-01T00:00:00.000Z', 'pg-test');
    const second = await db.prepare("INSERT INTO sync_runs (started_at, status, source) VALUES (@at, 'running', @source)").run({ at: '2026-01-02T00:00:00.000Z', source: 'pg-test' });
    expect(first.changes).toBe(1);
    expect(second.lastInsertRowid).toBeGreaterThan(first.lastInsertRowid);

    const row = (await db.prepare('SELECT * FROM sync_runs WHERE id = ?').get(first.lastInsertRowid)) as { id: number; checked_count: number };
    expect(row.id).toBe(first.lastInsertRowid);
    expect(typeof row.id).toBe('number'); // BIGINT comes back as a number, not a string
    expect(row.checked_count).toBe(0);

    const count = (await db.prepare('SELECT COUNT(*) AS c FROM sync_runs WHERE source = ?').get('pg-test')) as { c: number };
    expect(count.c).toBe(2); // COUNT(*) too

    expect(await db.prepare('SELECT * FROM sync_runs WHERE id = ?').get(-1)).toBeUndefined();
    expect(await db.prepare('SELECT id FROM sync_runs WHERE source = ? ORDER BY id').all('pg-test')).toHaveLength(2);

    const updated = await db.prepare('UPDATE sync_runs SET status = ? WHERE source = ?').run('completed', 'pg-test');
    expect(updated.changes).toBe(2);
  });

  it('undefined parameters are stored as NULL and booleans as 0/1', async () => {
    const info = await db.prepare('INSERT INTO sync_runs (started_at, status, source, error, checked_count) VALUES (?, ?, ?, ?, ?)')
      .run('2026-01-03T00:00:00.000Z', 'running', 'pg-test-null', undefined, true);
    const row = (await db.prepare('SELECT error, checked_count FROM sync_runs WHERE id = ?').get(info.lastInsertRowid)) as { error: string | null; checked_count: number };
    expect(row.error).toBeNull();
    expect(row.checked_count).toBe(1);
  });

  it('a duplicate key is recognizable as a unique violation', async () => {
    const insert = db.prepare("INSERT INTO users (created_at, name, email, password_hash) VALUES ('2026-01-01', 'Dup', ?, 'h')");
    await insert.run('pg-dup@example.com');
    const err = await insert.run('pg-dup@example.com').catch((e) => e);
    expect(isUniqueViolation(err)).toBe(true);
    expect(isUniqueViolation(new Error('something else'))).toBe(false);
  });
});

describe('db.transaction', () => {
  const countRuns = async (source: string) =>
    ((await db.prepare('SELECT COUNT(*) AS c FROM sync_runs WHERE source = ?').get(source)) as { c: number }).c;
  const insertRun = (source: string) =>
    db.prepare("INSERT INTO sync_runs (started_at, status, source) VALUES ('2026-02-01T00:00:00.000Z', 'running', ?)").run(source);

  it('commits everything when the callback returns', async () => {
    const result = await db.transaction(async () => {
      await insertRun('tx-commit');
      await insertRun('tx-commit');
      return 'done';
    });
    expect(result).toBe('done');
    expect(await countRuns('tx-commit')).toBe(2);
  });

  it('rolls everything back when the callback throws', async () => {
    await expect(db.transaction(async () => {
      await insertRun('tx-rollback');
      throw new Error('boom');
    })).rejects.toThrow('boom');
    expect(await countRuns('tx-rollback')).toBe(0);
  });

  it('queries made by other functions called inside the callback join the same transaction', async () => {
    async function helper() {
      await insertRun('tx-join');
    }
    await expect(db.transaction(async () => {
      await helper();
      expect(db.inTransaction()).toBe(true);
      // Visible to itself before commit...
      expect(await countRuns('tx-join')).toBe(1);
      throw new Error('undo');
    })).rejects.toThrow('undo');
    // ...and gone after the rollback, proving helper() wrote inside it.
    expect(await countRuns('tx-join')).toBe(0);
    expect(db.inTransaction()).toBe(false);
  });

  it('a nested transaction that fails rolls back only itself when the outer code catches the error', async () => {
    await db.transaction(async () => {
      await insertRun('tx-nested-outer');
      await db.transaction(async () => {
        await insertRun('tx-nested-inner');
        throw new Error('inner failed');
      }).catch(() => {});
      await insertRun('tx-nested-outer');
    });
    expect(await countRuns('tx-nested-outer')).toBe(2);
    expect(await countRuns('tx-nested-inner')).toBe(0);
  });

  it('many transactions at once each see a consistent world (a counter incremented 25 times in parallel ends at 25)', async () => {
    const { lastInsertRowid: id } = await db.prepare("INSERT INTO sync_runs (started_at, status, source, checked_count) VALUES ('2026-03-01', 'running', 'tx-counter', 0)").run();
    await Promise.all(Array.from({ length: 25 }, () => db.transaction(async () => {
      const row = (await db.prepare('SELECT checked_count FROM sync_runs WHERE id = ? FOR UPDATE').get(id)) as { checked_count: number };
      await db.prepare('UPDATE sync_runs SET checked_count = ? WHERE id = ?').run(row.checked_count + 1, id);
    })));
    const row = (await db.prepare('SELECT checked_count FROM sync_runs WHERE id = ?').get(id)) as { checked_count: number };
    expect(row.checked_count).toBe(25);
  });
});

describe('Schema migrations', () => {
  it('every migration is recorded exactly once, in order', async () => {
    const { rows } = await db.query('SELECT id FROM schema_migrations ORDER BY id');
    expect(rows.map((r) => r.id)).toEqual(MIGRATIONS.map((m) => m.id));
  });

  it('migration ids are unique and sort in the order they are listed', () => {
    const ids = MIGRATIONS.map((m) => m.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect([...ids].sort()).toEqual(ids);
  });

  it('re-running every migration against an already-migrated schema is a harmless no-op', async () => {
    for (const m of MIGRATIONS) await db.exec(m.sql);
    const { rows } = await db.query("SELECT COUNT(*) AS c FROM information_schema.tables WHERE table_schema = current_schema()");
    expect(rows[0].c).toBeGreaterThanOrEqual(30);
  });
});
