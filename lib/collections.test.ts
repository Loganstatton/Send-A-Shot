import { describe, expect, it } from 'vitest';

const { createArtist, createUser, updateArtist } = await import('./db');
const {
  addCollectionItem, COLLECTION_MAX_ITEMS, createCollection, deleteCollection, getCollectionById, getCollectionBySlug, getCollections,
  removeCollectionItem, updateCollection, updateCollectionItem,
} = await import('./collections');
const { genreSlug, getGenreHub, getGenreHubs, hubForGenre } = await import('./genre-hubs');

let seq = 0;
async function staff() {
  seq++;
  return createUser({ name: `Editor ${seq}`, email: `editor-${seq}@example.com`, password_hash: 'x' });
}
async function artist(genre = 'Pop') {
  seq++;
  return createArtist({ name: `Coll Artist ${seq}`, genre, music_talent: 7, growth_velocity: 7, engagement_quality: 7, original_song_response: 7, brand_personality: 7, content_consistency: 7, commercial_potential: 7, professionalism: 7 });
}
async function newCollection(title = 'Bedroom Pop to Watch') {
  const r = await createCollection(title, '  Soft voices,   big hooks. ', (await staff()).id);
  if (!r.ok) throw new Error(r.error);
  return r.collection;
}

describe('collections', () => {
  it('creates an unpublished collection with a slug, and gives repeats their own slug', async () => {
    const a = await newCollection('Late Night R&B');
    expect(a).toMatchObject({ slug: 'late-night-randb', published: false, description: 'Soft voices, big hooks.' });
    const b = await newCollection('Late Night R&B');
    expect(b.slug).toBe('late-night-randb-2');
    expect((await createCollection('ab', '', (await staff()).id)).ok).toBe(false);
  });

  it("can't be published while empty; published ones are listed publicly", async () => {
    const c = await newCollection('Publish Test');
    expect(await updateCollection(c.id, { published: true })).toMatchObject({ ok: false, status: 400 });
    expect((await addCollectionItem(c.id, (await artist()).id, 'A voice you remember')).ok).toBe(true);
    expect((await updateCollection(c.id, { published: true })).ok).toBe(true);
    expect((await getCollections({ publishedOnly: true })).map((x) => x.id)).toContain(c.id);
  });

  it('keeps the slug when renamed, so shared links still work', async () => {
    const c = await newCollection('Original Title');
    await updateCollection(c.id, { title: 'A Better Title' });
    const again = await getCollectionBySlug(c.slug);
    expect(again?.title).toBe('A Better Title');
  });

  it('rejects duplicates, passed artists and going over the size cap', async () => {
    const c = await newCollection('Rules');
    const a = await artist();
    expect((await addCollectionItem(c.id, a.id, '')).ok).toBe(true);
    expect(await addCollectionItem(c.id, a.id, '')).toMatchObject({ ok: false, status: 409 });
    const passed = await artist();
    await updateArtist(passed.id, { stage: 'passed' } as any);
    expect(await addCollectionItem(c.id, passed.id, '')).toMatchObject({ ok: false, status: 400 });
    for (let i = 1; i < COLLECTION_MAX_ITEMS; i++) await addCollectionItem(c.id, (await artist()).id, '');
    expect(await addCollectionItem(c.id, (await artist()).id, '')).toMatchObject({ ok: false, status: 400 });
  });

  it('reorders, edits notes, and unpublishes when the last artist is removed', async () => {
    const c = await newCollection('Order');
    const [a, b, d] = [await artist(), await artist(), await artist()];
    for (const x of [a, b, d]) await addCollectionItem(c.id, x.id, '');
    await updateCollectionItem(c.id, d.id, { move: 'up' });
    await updateCollectionItem(c.id, a.id, { note: '  First in line  ' });
    let got = (await getCollectionById(c.id))!;
    expect(got.items.map((i) => i.artist_id)).toEqual([a.id, d.id, b.id]);
    expect(got.items[0].note).toBe('First in line');
    await updateCollection(c.id, { published: true });
    for (const x of [a, b, d]) await removeCollectionItem(c.id, x.id);
    got = (await getCollectionById(c.id))!;
    expect(got.published).toBe(false);
    expect(await deleteCollection(c.id)).toBe(true);
    expect(await getCollectionById(c.id)).toBeUndefined();
  });
});

describe('genre hubs', () => {
  it('makes readable slugs', () => {
    expect(genreSlug('R&B')).toBe('rnb');
    expect(genreSlug('Hip-Hop/Rap')).toBe('hip-hop-rap');
    expect(genreSlug('Rock/Alternative')).toBe('rock-alternative');
  });
  it('a genre page includes artists whose genre contains it, and an artist links to its hub', async () => {
    const a = await artist('Pop/R&B');
    const hub = await getGenreHub('rnb');
    expect(hub?.hub.label).toBe('R&B');
    expect(hub?.rows.map((r) => r.artist.id)).toContain(a.id);
    expect((await getGenreHubs()).find((h) => h.slug === 'rnb')!.count).toBeGreaterThanOrEqual(1);
    expect((await hubForGenre('Pop/R&B'))?.slug).toBe('pop');
    expect(await getGenreHub('not-a-genre')).toBeNull();
  });
});
