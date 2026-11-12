import { db, isUniqueViolation } from './pg';

// Editorial collections — see migration 007. Staff (internal/admin) curate;
// everyone can read a published one. Editorial only: there is no way to
// pay for a place in a collection, and nothing here is labelled sponsored.

export const COLLECTION_TITLE_MIN = 3;
export const COLLECTION_TITLE_MAX = 60;
export const COLLECTION_DESCRIPTION_MAX = 300;
export const COLLECTION_NOTE_MAX = 200;
export const COLLECTION_MAX_ITEMS = 24;

export type Collection = {
  id: number; slug: string; title: string; description: string | null; published: boolean; created_at: string; updated_at: string;
};
export type CollectionItem = { artist_id: number; position: number; note: string | null };
export type CollectionWithItems = Collection & { items: CollectionItem[] };

type Result<T = {}> = ({ ok: true } & T) | { ok: false; status: 400 | 404 | 409; error: string };

function slugify(title: string): string {
  return title.toLowerCase().replace(/&/g, 'and').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 50) || 'collection';
}

function toCollection(row: any): Collection {
  return { ...row, published: row.published === 1, description: row.description ?? null };
}

function cleanText(raw: unknown, max: number): string | null {
  if (typeof raw !== 'string') return null;
  const t = raw.trim().replace(/\s+/g, ' ');
  return t ? t.slice(0, max) : null;
}

function validateTitle(raw: unknown): { ok: true; title: string } | { ok: false; error: string } {
  const title = typeof raw === 'string' ? raw.trim().replace(/\s+/g, ' ') : '';
  if (title.length < COLLECTION_TITLE_MIN || title.length > COLLECTION_TITLE_MAX) {
    return { ok: false, error: `Title must be ${COLLECTION_TITLE_MIN}–${COLLECTION_TITLE_MAX} characters.` };
  }
  return { ok: true, title };
}

const COLS = 'id, slug, title, description, published, created_at, updated_at';

export async function getCollections(opts: { publishedOnly?: boolean } = {}): Promise<(Collection & { itemCount: number })[]> {
  const rows = (await db.prepare(`
    SELECT ${COLS}, (SELECT COUNT(*) FROM next_collection_items i WHERE i.collection_id = c.id) AS item_count
    FROM next_collections c
    ${opts.publishedOnly ? 'WHERE published = 1' : ''}
    ORDER BY updated_at DESC, id DESC
  `).all()) as any[];
  return rows.map((r) => ({ ...toCollection(r), itemCount: r.item_count }));
}

async function withItems(c: any): Promise<CollectionWithItems | undefined> {
  if (!c) return undefined;
  const items = (await db.prepare('SELECT artist_id, position, note FROM next_collection_items WHERE collection_id = ? ORDER BY position ASC, id ASC').all(c.id)) as CollectionItem[];
  return { ...toCollection(c), items };
}

export async function getCollectionById(id: number) {
  return withItems(await db.prepare(`SELECT ${COLS} FROM next_collections WHERE id = ?`).get(id));
}

export async function getCollectionBySlug(slug: string) {
  return withItems(await db.prepare(`SELECT ${COLS} FROM next_collections WHERE slug = ?`).get(slug));
}

export async function createCollection(rawTitle: unknown, rawDescription: unknown, actorId: number): Promise<Result<{ collection: Collection }>> {
  const v = validateTitle(rawTitle);
  if (!v.ok) return { ok: false, status: 400, error: v.error };
  const description = cleanText(rawDescription, COLLECTION_DESCRIPTION_MAX);
  const now = new Date().toISOString();
  const base = slugify(v.title);
  for (let n = 1; n <= 20; n++) {
    const slug = n === 1 ? base : `${base}-${n}`;
    try {
      const info = await db.prepare('INSERT INTO next_collections (slug, title, description, published, created_by, created_at, updated_at) VALUES (?, ?, ?, 0, ?, ?, ?)')
        .run(slug, v.title, description, actorId, now, now);
      return { ok: true, collection: (await getCollectionById(info.lastInsertRowid))! };
    } catch (err) {
      if (!isUniqueViolation(err)) throw err;
    }
  }
  return { ok: false, status: 409, error: 'Could not find a free address for this title — try a different one.' };
}

// Title/description/published. The slug never changes once created, so
// links already shared keep working after a rename.
export async function updateCollection(id: number, input: { title?: unknown; description?: unknown; published?: unknown }): Promise<Result> {
  const existing = await getCollectionById(id);
  if (!existing) return { ok: false, status: 404, error: 'Collection not found.' };
  const title = input.title !== undefined ? validateTitle(input.title) : { ok: true as const, title: existing.title };
  if (!title.ok) return { ok: false, status: 400, error: title.error };
  const description = input.description !== undefined ? cleanText(input.description, COLLECTION_DESCRIPTION_MAX) : existing.description;
  const published = input.published !== undefined ? input.published === true : existing.published;
  if (published && existing.items.length === 0) return { ok: false, status: 400, error: 'Add at least one artist before publishing.' };
  await db.prepare('UPDATE next_collections SET title = ?, description = ?, published = ?, updated_at = ? WHERE id = ?')
    .run(title.title, description, published ? 1 : 0, new Date().toISOString(), id);
  return { ok: true };
}

export async function deleteCollection(id: number): Promise<boolean> {
  return (await db.prepare('DELETE FROM next_collections WHERE id = ?').run(id)).changes > 0;
}

export async function addCollectionItem(collectionId: number, artistId: number, rawNote: unknown): Promise<Result> {
  return await db.transaction(async (): Promise<Result> => {
    const c = await db.prepare('SELECT id FROM next_collections WHERE id = ? FOR UPDATE').get(collectionId);
    if (!c) return { ok: false, status: 404, error: 'Collection not found.' };
    const artist = (await db.prepare('SELECT id, stage FROM artists WHERE id = ?').get(artistId)) as { id: number; stage: string } | undefined;
    if (!artist || artist.stage === 'passed') return { ok: false, status: 400, error: 'That artist is not on NEXT.' };
    const count = ((await db.prepare('SELECT COUNT(*) AS c, COALESCE(MAX(position), 0) AS maxpos FROM next_collection_items WHERE collection_id = ?').get(collectionId)) as { c: number; maxpos: number });
    if (count.c >= COLLECTION_MAX_ITEMS) return { ok: false, status: 400, error: `A collection holds at most ${COLLECTION_MAX_ITEMS} artists.` };
    const info = await db.prepare('INSERT INTO next_collection_items (collection_id, artist_id, position, note) VALUES (?, ?, ?, ?) ON CONFLICT DO NOTHING')
      .run(collectionId, artistId, count.maxpos + 1, cleanText(rawNote, COLLECTION_NOTE_MAX));
    if (info.changes === 0) return { ok: false, status: 409, error: 'That artist is already in this collection.' };
    await db.prepare('UPDATE next_collections SET updated_at = ? WHERE id = ?').run(new Date().toISOString(), collectionId);
    return { ok: true };
  });
}

export async function removeCollectionItem(collectionId: number, artistId: number): Promise<Result> {
  const info = await db.prepare('DELETE FROM next_collection_items WHERE collection_id = ? AND artist_id = ?').run(collectionId, artistId);
  if (info.changes === 0) return { ok: false, status: 404, error: 'Not in this collection.' };
  // An empty collection can't stay published.
  const left = (await db.prepare('SELECT COUNT(*) AS c FROM next_collection_items WHERE collection_id = ?').get(collectionId)) as { c: number };
  await db.prepare(`UPDATE next_collections SET updated_at = ?${left.c === 0 ? ', published = 0' : ''} WHERE id = ?`).run(new Date().toISOString(), collectionId);
  return { ok: true };
}

export async function updateCollectionItem(collectionId: number, artistId: number, input: { note?: unknown; move?: unknown }): Promise<Result> {
  return await db.transaction(async (): Promise<Result> => {
    const items = (await db.prepare('SELECT id, artist_id, position FROM next_collection_items WHERE collection_id = ? ORDER BY position ASC, id ASC FOR UPDATE').all(collectionId)) as { id: number; artist_id: number; position: number }[];
    const idx = items.findIndex((i) => i.artist_id === artistId);
    if (idx === -1) return { ok: false, status: 404, error: 'Not in this collection.' };
    if (input.note !== undefined) {
      await db.prepare('UPDATE next_collection_items SET note = ? WHERE id = ?').run(cleanText(input.note, COLLECTION_NOTE_MAX), items[idx].id);
    }
    if (input.move === 'up' || input.move === 'down') {
      const swap = input.move === 'up' ? idx - 1 : idx + 1;
      if (swap >= 0 && swap < items.length) {
        // Renumber everything 1..n with the two swapped, so positions stay tidy.
        const order = items.map((i) => i.id);
        [order[idx], order[swap]] = [order[swap], order[idx]];
        for (let n = 0; n < order.length; n++) await db.prepare('UPDATE next_collection_items SET position = ? WHERE id = ?').run(n + 1, order[n]);
      }
    }
    await db.prepare('UPDATE next_collections SET updated_at = ? WHERE id = ?').run(new Date().toISOString(), collectionId);
    return { ok: true };
  });
}
