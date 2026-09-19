import Database from 'better-sqlite3';
import path from 'path';
import fs from 'fs';
import { DATA_DIR } from '../data-dir';
import {
  Artwork, ArtworkCategory, ArtworkFull, ArtworkImage, ArtworkInput, Availability,
  CollectorEmail, ImageKind, Inquiry, InquiryInput, ProvenanceEntry, ProvenanceKind,
  Story, Submission, SubmissionInput, SymbolismHotspot,
} from './types';

// A fully separate SQLite file from Scout/NEXT's data/app.db — the gallery
// site is a different product sharing this repo and deploy, not an
// extension of Scout's schema. Same DATA_DIR convention (persistent disk in
// prod, /tmp on Vercel) so it gets the same durability characteristics.
const dbFile = path.join(DATA_DIR, 'gallery.db');
const dir = path.dirname(dbFile);
if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

export const galleryDb = new Database(dbFile);
galleryDb.pragma('journal_mode = WAL');
galleryDb.pragma('foreign_keys = ON');

galleryDb.exec(`
CREATE TABLE IF NOT EXISTS gallery_artworks (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  slug TEXT NOT NULL UNIQUE,
  title TEXT NOT NULL,
  year INTEGER NOT NULL,
  medium TEXT NOT NULL DEFAULT '',
  dimensions TEXT NOT NULL DEFAULT '',
  short_description TEXT NOT NULL DEFAULT '',
  story TEXT NOT NULL DEFAULT '',
  categories TEXT NOT NULL DEFAULT '[]',
  availability TEXT NOT NULL DEFAULT 'available',
  is_original INTEGER NOT NULL DEFAULT 1,
  signed INTEGER NOT NULL DEFAULT 1,
  price_cents INTEGER,
  price_display_mode TEXT NOT NULL DEFAULT 'upon_request',
  edition_total INTEGER,
  edition_remaining INTEGER,
  edition_closed INTEGER NOT NULL DEFAULT 0,
  artwork_code TEXT NOT NULL DEFAULT '',
  certificate_number TEXT,
  hero_image_url TEXT,
  silhouette_image_url TEXT,
  release_at TEXT,
  is_published INTEGER NOT NULL DEFAULT 1,
  sort_order INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS gallery_artwork_images (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  artwork_id INTEGER NOT NULL REFERENCES gallery_artworks(id) ON DELETE CASCADE,
  url TEXT NOT NULL,
  alt TEXT NOT NULL DEFAULT '',
  kind TEXT NOT NULL DEFAULT 'detail',
  sort_order INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS gallery_symbolism (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  artwork_id INTEGER NOT NULL REFERENCES gallery_artworks(id) ON DELETE CASCADE,
  label TEXT NOT NULL,
  description TEXT NOT NULL,
  x_pct REAL NOT NULL,
  y_pct REAL NOT NULL,
  sort_order INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS gallery_provenance (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  artwork_id INTEGER NOT NULL REFERENCES gallery_artworks(id) ON DELETE CASCADE,
  kind TEXT NOT NULL,
  title TEXT NOT NULL,
  detail TEXT,
  date_text TEXT,
  sort_order INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS gallery_inquiries (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  created_at TEXT NOT NULL,
  artwork_id INTEGER REFERENCES gallery_artworks(id) ON DELETE SET NULL,
  artwork_title_snapshot TEXT,
  name TEXT NOT NULL,
  email TEXT NOT NULL,
  phone TEXT,
  country TEXT,
  message TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'new'
);
CREATE TABLE IF NOT EXISTS gallery_collector_emails (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  created_at TEXT NOT NULL,
  email TEXT NOT NULL UNIQUE,
  source TEXT NOT NULL DEFAULT 'private_releases'
);
CREATE TABLE IF NOT EXISTS gallery_submissions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  created_at TEXT NOT NULL,
  name TEXT NOT NULL,
  story TEXT NOT NULL,
  photo_url TEXT,
  permission_granted INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'new'
);
CREATE TABLE IF NOT EXISTS gallery_stories (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  created_at TEXT NOT NULL,
  slug TEXT NOT NULL UNIQUE,
  title TEXT NOT NULL,
  dek TEXT NOT NULL DEFAULT '',
  body TEXT NOT NULL DEFAULT '',
  cover_image_url TEXT,
  published_at TEXT,
  is_published INTEGER NOT NULL DEFAULT 1,
  sort_order INTEGER NOT NULL DEFAULT 0
);
`);

function nowIso() {
  return new Date().toISOString();
}

// ---------------------------------------------------------------------------
// Row <-> domain mapping (SQLite has no bool/array types)

function rowToArtwork(row: any): Artwork {
  return {
    ...row,
    is_original: !!row.is_original,
    signed: !!row.signed,
    edition_closed: !!row.edition_closed,
    is_published: !!row.is_published,
    categories: JSON.parse(row.categories || '[]'),
  };
}

function rowToImage(row: any): ArtworkImage {
  return { ...row };
}

function rowToSymbolism(row: any): SymbolismHotspot {
  return { ...row };
}

function rowToProvenance(row: any): ProvenanceEntry {
  return { ...row };
}

function rowToInquiry(row: any): Inquiry {
  return { ...row };
}

function rowToCollectorEmail(row: any): CollectorEmail {
  return { ...row };
}

function rowToSubmission(row: any): Submission {
  return { ...row, permission_granted: !!row.permission_granted };
}

function rowToStory(row: any): Story {
  return { ...row, is_published: !!row.is_published };
}

// ---------------------------------------------------------------------------
// Artworks

export type ArtworkFilter = {
  availability?: Availability[];
  category?: ArtworkCategory;
  isOriginal?: boolean;
  isEdition?: boolean;
  includeUnpublished?: boolean;
  includeUnreleased?: boolean;
};

export function listArtworks(filter: ArtworkFilter = {}): Artwork[] {
  const rows = galleryDb
    .prepare(`SELECT * FROM gallery_artworks ORDER BY sort_order ASC, year DESC, id DESC`)
    .all() as any[];
  let artworks = rows.map(rowToArtwork);

  if (!filter.includeUnpublished) artworks = artworks.filter((a) => a.is_published);
  if (!filter.includeUnreleased) {
    const now = Date.now();
    artworks = artworks.filter((a) => !a.release_at || new Date(a.release_at).getTime() <= now);
  }
  if (filter.availability?.length) artworks = artworks.filter((a) => filter.availability!.includes(a.availability));
  if (filter.category) artworks = artworks.filter((a) => a.categories.includes(filter.category!));
  if (filter.isOriginal !== undefined) artworks = artworks.filter((a) => a.is_original === filter.isOriginal);
  if (filter.isEdition !== undefined) artworks = artworks.filter((a) => (a.edition_total != null) === filter.isEdition);

  return artworks;
}

// Artworks whose release_at is in the future — used to render "NEW WORK,
// revealing <date>" countdown cards even though they're excluded from the
// normal published listing above.
export function listUpcomingArtworks(): Artwork[] {
  const rows = galleryDb
    .prepare(`SELECT * FROM gallery_artworks WHERE is_published = 1 AND release_at IS NOT NULL ORDER BY release_at ASC`)
    .all() as any[];
  const now = Date.now();
  return rows.map(rowToArtwork).filter((a) => a.release_at && new Date(a.release_at).getTime() > now);
}

export function getArtworkBySlug(slug: string, opts: { includeUnpublished?: boolean } = {}): Artwork | null {
  const row = galleryDb.prepare(`SELECT * FROM gallery_artworks WHERE slug = ?`).get(slug) as any;
  if (!row) return null;
  const artwork = rowToArtwork(row);
  if (!opts.includeUnpublished && !artwork.is_published) return null;
  return artwork;
}

export function getArtworkById(id: number): Artwork | null {
  const row = galleryDb.prepare(`SELECT * FROM gallery_artworks WHERE id = ?`).get(id) as any;
  return row ? rowToArtwork(row) : null;
}

export function getArtworkImages(artworkId: number): ArtworkImage[] {
  return (galleryDb.prepare(`SELECT * FROM gallery_artwork_images WHERE artwork_id = ? ORDER BY sort_order ASC, id ASC`).all(artworkId) as any[]).map(rowToImage);
}

export function getArtworkSymbolism(artworkId: number): SymbolismHotspot[] {
  return (galleryDb.prepare(`SELECT * FROM gallery_symbolism WHERE artwork_id = ? ORDER BY sort_order ASC, id ASC`).all(artworkId) as any[]).map(rowToSymbolism);
}

export function getArtworkProvenance(artworkId: number): ProvenanceEntry[] {
  return (galleryDb.prepare(`SELECT * FROM gallery_provenance WHERE artwork_id = ? ORDER BY sort_order ASC, id ASC`).all(artworkId) as any[]).map(rowToProvenance);
}

export function getArtworkFull(artwork: Artwork): ArtworkFull {
  return {
    ...artwork,
    images: getArtworkImages(artwork.id),
    symbolism: getArtworkSymbolism(artwork.id),
    provenance: getArtworkProvenance(artwork.id),
  };
}

export function slugify(title: string): string {
  return title
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '');
}

const ARTWORK_CODE_PREFIX = 'SO';

// Next sequential artwork ID for a given year, e.g. SO-2026-001. Purely
// informational/provenance — never used as a primary key.
export function nextArtworkCode(year: number): string {
  const row = galleryDb
    .prepare(`SELECT artwork_code FROM gallery_artworks WHERE artwork_code LIKE ? ORDER BY artwork_code DESC LIMIT 1`)
    .get(`${ARTWORK_CODE_PREFIX}-${year}-%`) as any;
  let next = 1;
  if (row?.artwork_code) {
    const parts = String(row.artwork_code).split('-');
    const n = parseInt(parts[2], 10);
    if (!Number.isNaN(n)) next = n + 1;
  }
  return `${ARTWORK_CODE_PREFIX}-${year}-${String(next).padStart(3, '0')}`;
}

export function createArtwork(input: Partial<ArtworkInput> & { title: string; year: number }): Artwork {
  const now = nowIso();
  const slug = input.slug && input.slug.trim() ? slugify(input.slug) : slugify(input.title);
  const code = input.artwork_code && input.artwork_code.trim() ? input.artwork_code : nextArtworkCode(input.year);
  const stmt = galleryDb.prepare(`
    INSERT INTO gallery_artworks (
      created_at, updated_at, slug, title, year, medium, dimensions, short_description, story,
      categories, availability, is_original, signed, price_cents, price_display_mode,
      edition_total, edition_remaining, edition_closed, artwork_code, certificate_number,
      hero_image_url, silhouette_image_url, release_at, is_published, sort_order
    ) VALUES (
      @created_at, @updated_at, @slug, @title, @year, @medium, @dimensions, @short_description, @story,
      @categories, @availability, @is_original, @signed, @price_cents, @price_display_mode,
      @edition_total, @edition_remaining, @edition_closed, @artwork_code, @certificate_number,
      @hero_image_url, @silhouette_image_url, @release_at, @is_published, @sort_order
    )
  `);
  const result = stmt.run({
    created_at: now,
    updated_at: now,
    slug,
    title: input.title,
    year: input.year,
    medium: input.medium ?? '',
    dimensions: input.dimensions ?? '',
    short_description: input.short_description ?? '',
    story: input.story ?? '',
    categories: JSON.stringify(input.categories ?? []),
    availability: input.availability ?? 'available',
    is_original: input.is_original === false ? 0 : 1,
    signed: input.signed === false ? 0 : 1,
    price_cents: input.price_cents ?? null,
    price_display_mode: input.price_display_mode ?? 'upon_request',
    edition_total: input.edition_total ?? null,
    edition_remaining: input.edition_remaining ?? input.edition_total ?? null,
    edition_closed: input.edition_closed ? 1 : 0,
    artwork_code: code,
    certificate_number: input.certificate_number ?? null,
    hero_image_url: input.hero_image_url ?? null,
    silhouette_image_url: input.silhouette_image_url ?? null,
    release_at: input.release_at ?? null,
    is_published: input.is_published === false ? 0 : 1,
    sort_order: input.sort_order ?? 0,
  });
  return getArtworkById(result.lastInsertRowid as number)!;
}

export function updateArtwork(id: number, patch: Partial<ArtworkInput>): Artwork | null {
  const existing = getArtworkById(id);
  if (!existing) return null;
  const merged: any = { ...existing, ...patch };
  galleryDb.prepare(`
    UPDATE gallery_artworks SET
      updated_at = @updated_at, slug = @slug, title = @title, year = @year, medium = @medium,
      dimensions = @dimensions, short_description = @short_description, story = @story,
      categories = @categories, availability = @availability, is_original = @is_original,
      signed = @signed, price_cents = @price_cents, price_display_mode = @price_display_mode,
      edition_total = @edition_total, edition_remaining = @edition_remaining,
      edition_closed = @edition_closed, artwork_code = @artwork_code,
      certificate_number = @certificate_number, hero_image_url = @hero_image_url,
      silhouette_image_url = @silhouette_image_url, release_at = @release_at,
      is_published = @is_published, sort_order = @sort_order
    WHERE id = @id
  `).run({
    id,
    updated_at: nowIso(),
    slug: patch.slug ? slugify(patch.slug) : existing.slug,
    title: merged.title,
    year: merged.year,
    medium: merged.medium,
    dimensions: merged.dimensions,
    short_description: merged.short_description,
    story: merged.story,
    categories: JSON.stringify(merged.categories ?? []),
    availability: merged.availability,
    is_original: merged.is_original ? 1 : 0,
    signed: merged.signed ? 1 : 0,
    price_cents: merged.price_cents ?? null,
    price_display_mode: merged.price_display_mode,
    edition_total: merged.edition_total ?? null,
    edition_remaining: merged.edition_remaining ?? null,
    edition_closed: merged.edition_closed ? 1 : 0,
    artwork_code: merged.artwork_code,
    certificate_number: merged.certificate_number ?? null,
    hero_image_url: merged.hero_image_url ?? null,
    silhouette_image_url: merged.silhouette_image_url ?? null,
    release_at: merged.release_at ?? null,
    is_published: merged.is_published ? 1 : 0,
    sort_order: merged.sort_order ?? 0,
  });
  return getArtworkById(id);
}

export function deleteArtwork(id: number) {
  galleryDb.prepare(`DELETE FROM gallery_artworks WHERE id = ?`).run(id);
}

// ---------------------------------------------------------------------------
// Images

export function addArtworkImage(artworkId: number, data: { url: string; alt?: string; kind?: ImageKind; sort_order?: number }): ArtworkImage {
  const result = galleryDb.prepare(`
    INSERT INTO gallery_artwork_images (artwork_id, url, alt, kind, sort_order)
    VALUES (@artwork_id, @url, @alt, @kind, @sort_order)
  `).run({
    artwork_id: artworkId,
    url: data.url,
    alt: data.alt ?? '',
    kind: data.kind ?? 'detail',
    sort_order: data.sort_order ?? 0,
  });
  return rowToImage(galleryDb.prepare(`SELECT * FROM gallery_artwork_images WHERE id = ?`).get(result.lastInsertRowid));
}

export function deleteArtworkImage(id: number) {
  galleryDb.prepare(`DELETE FROM gallery_artwork_images WHERE id = ?`).run(id);
}

// ---------------------------------------------------------------------------
// Symbolism hotspots

export function addSymbolism(artworkId: number, data: { label: string; description: string; x_pct: number; y_pct: number; sort_order?: number }): SymbolismHotspot {
  const result = galleryDb.prepare(`
    INSERT INTO gallery_symbolism (artwork_id, label, description, x_pct, y_pct, sort_order)
    VALUES (@artwork_id, @label, @description, @x_pct, @y_pct, @sort_order)
  `).run({ artwork_id: artworkId, sort_order: 0, ...data });
  return rowToSymbolism(galleryDb.prepare(`SELECT * FROM gallery_symbolism WHERE id = ?`).get(result.lastInsertRowid));
}

export function deleteSymbolism(id: number) {
  galleryDb.prepare(`DELETE FROM gallery_symbolism WHERE id = ?`).run(id);
}

// ---------------------------------------------------------------------------
// Provenance

export function addProvenance(artworkId: number, data: { kind: ProvenanceKind; title: string; detail?: string | null; date_text?: string | null; sort_order?: number }): ProvenanceEntry {
  const result = galleryDb.prepare(`
    INSERT INTO gallery_provenance (artwork_id, kind, title, detail, date_text, sort_order)
    VALUES (@artwork_id, @kind, @title, @detail, @date_text, @sort_order)
  `).run({
    artwork_id: artworkId,
    kind: data.kind,
    title: data.title,
    detail: data.detail ?? null,
    date_text: data.date_text ?? null,
    sort_order: data.sort_order ?? 0,
  });
  return rowToProvenance(galleryDb.prepare(`SELECT * FROM gallery_provenance WHERE id = ?`).get(result.lastInsertRowid));
}

export function deleteProvenance(id: number) {
  galleryDb.prepare(`DELETE FROM gallery_provenance WHERE id = ?`).run(id);
}

// ---------------------------------------------------------------------------
// Inquiries ("Acquire This Work")

export function createInquiry(input: InquiryInput): Inquiry {
  const artwork = input.artwork_id ? getArtworkById(input.artwork_id) : null;
  const result = galleryDb.prepare(`
    INSERT INTO gallery_inquiries (created_at, artwork_id, artwork_title_snapshot, name, email, phone, country, message, status)
    VALUES (@created_at, @artwork_id, @artwork_title_snapshot, @name, @email, @phone, @country, @message, 'new')
  `).run({
    created_at: nowIso(),
    artwork_id: input.artwork_id,
    artwork_title_snapshot: artwork?.title ?? null,
    name: input.name,
    email: input.email,
    phone: input.phone,
    country: input.country,
    message: input.message,
  });
  return rowToInquiry(galleryDb.prepare(`SELECT * FROM gallery_inquiries WHERE id = ?`).get(result.lastInsertRowid));
}

export function listInquiries(): Inquiry[] {
  return (galleryDb.prepare(`SELECT * FROM gallery_inquiries ORDER BY created_at DESC`).all() as any[]).map(rowToInquiry);
}

export function updateInquiryStatus(id: number, status: Inquiry['status']) {
  galleryDb.prepare(`UPDATE gallery_inquiries SET status = ? WHERE id = ?`).run(status, id);
}

// ---------------------------------------------------------------------------
// Collector emails ("Private Releases")

export function addCollectorEmail(email: string, source = 'private_releases'): { ok: true; created: boolean } {
  try {
    galleryDb.prepare(`INSERT INTO gallery_collector_emails (created_at, email, source) VALUES (?, ?, ?)`).run(nowIso(), email.trim().toLowerCase(), source);
    return { ok: true, created: true };
  } catch {
    // UNIQUE constraint — already on the list, treat as success (idempotent signup)
    return { ok: true, created: false };
  }
}

export function listCollectorEmails(): CollectorEmail[] {
  return (galleryDb.prepare(`SELECT * FROM gallery_collector_emails ORDER BY created_at DESC`).all() as any[]).map(rowToCollectorEmail);
}

// ---------------------------------------------------------------------------
// "Become Part of the Work" submissions

export function createSubmission(input: SubmissionInput): Submission {
  const result = galleryDb.prepare(`
    INSERT INTO gallery_submissions (created_at, name, story, photo_url, permission_granted, status)
    VALUES (@created_at, @name, @story, @photo_url, @permission_granted, 'new')
  `).run({
    created_at: nowIso(),
    name: input.name,
    story: input.story,
    photo_url: input.photo_url,
    permission_granted: input.permission_granted ? 1 : 0,
  });
  return rowToSubmission(galleryDb.prepare(`SELECT * FROM gallery_submissions WHERE id = ?`).get(result.lastInsertRowid));
}

export function listSubmissions(): Submission[] {
  return (galleryDb.prepare(`SELECT * FROM gallery_submissions ORDER BY created_at DESC`).all() as any[]).map(rowToSubmission);
}

export function updateSubmissionStatus(id: number, status: Submission['status']) {
  galleryDb.prepare(`UPDATE gallery_submissions SET status = ? WHERE id = ?`).run(status, id);
}

// ---------------------------------------------------------------------------
// Stories (process/journal entries for the STORIES nav item)

export function listStories(opts: { includeUnpublished?: boolean } = {}): Story[] {
  const rows = (galleryDb.prepare(`SELECT * FROM gallery_stories ORDER BY sort_order ASC, published_at DESC`).all() as any[]).map(rowToStory);
  return opts.includeUnpublished ? rows : rows.filter((s) => s.is_published);
}

export function getStoryBySlug(slug: string, opts: { includeUnpublished?: boolean } = {}): Story | null {
  const row = galleryDb.prepare(`SELECT * FROM gallery_stories WHERE slug = ?`).get(slug) as any;
  if (!row) return null;
  const story = rowToStory(row);
  if (!opts.includeUnpublished && !story.is_published) return null;
  return story;
}

export function createStory(input: Partial<Story> & { title: string }): Story {
  const now = nowIso();
  const slug = input.slug && input.slug.trim() ? slugify(input.slug) : slugify(input.title);
  const result = galleryDb.prepare(`
    INSERT INTO gallery_stories (created_at, slug, title, dek, body, cover_image_url, published_at, is_published, sort_order)
    VALUES (@created_at, @slug, @title, @dek, @body, @cover_image_url, @published_at, @is_published, @sort_order)
  `).run({
    created_at: now,
    slug,
    title: input.title,
    dek: input.dek ?? '',
    body: input.body ?? '',
    cover_image_url: input.cover_image_url ?? null,
    published_at: input.published_at ?? now,
    is_published: input.is_published === false ? 0 : 1,
    sort_order: input.sort_order ?? 0,
  });
  return rowToStory(galleryDb.prepare(`SELECT * FROM gallery_stories WHERE id = ?`).get(result.lastInsertRowid));
}

export function deleteStory(id: number) {
  galleryDb.prepare(`DELETE FROM gallery_stories WHERE id = ?`).run(id);
}

// ---------------------------------------------------------------------------
// Seed — a handful of sample works so the site never renders empty. Real
// artwork replaces these from /gallery/admin; nothing here is fake
// provenance (no invented exhibitions/press — see README).

function seedIfEmpty() {
  const count = (galleryDb.prepare(`SELECT COUNT(*) AS c FROM gallery_artworks`).get() as any).c;
  if (count > 0) return;

  const seedArtworks: Array<Partial<ArtworkInput> & { title: string; year: number; imageSeed: string }> = [
    {
      title: 'The Garden',
      year: 2026,
      medium: 'Graphite on paper',
      dimensions: '24 × 30 in',
      short_description: 'He knew what was coming. He stayed anyway.',
      story: 'There are moments when someone desperately needs help but never says the words.\n\nEveryone around them assumes they’re okay.\n\nThis piece is about that moment — the space between what a person is going through and what they let anyone see.',
      categories: ['human_emotion', 'psychological'],
      availability: 'available',
      price_display_mode: 'upon_request',
      is_original: true,
      signed: true,
      imageSeed: 'the-garden',
    },
    {
      title: 'Gethsemane',
      year: 2025,
      medium: 'Charcoal on paper',
      dimensions: '22 × 28 in',
      short_description: 'Every surrender begins in a quiet, unwatched place.',
      story: 'Before anything is public, it is decided somewhere private — on your knees, alone, with no one to perform for.\n\nThis drawing sits inside that decision, before the outcome, before anyone else knows what it cost.',
      categories: ['religious', 'psychological'],
      availability: 'sold',
      price_display_mode: 'hidden',
      is_original: true,
      signed: true,
      imageSeed: 'gethsemane',
    },
    {
      title: 'What the Uniform Hides',
      year: 2025,
      medium: 'Graphite and charcoal on paper',
      dimensions: '18 × 24 in',
      short_description: 'The face underneath the composure everyone expects of him.',
      story: 'A uniform teaches a person to hold their face a certain way in public.\n\nThis is an attempt at what that same face might look like the moment no one is watching.',
      categories: ['military', 'human_emotion'],
      availability: 'available',
      price_display_mode: 'public',
      price_cents: 480000,
      is_original: true,
      signed: true,
      imageSeed: 'uniform',
    },
    {
      title: 'Held',
      year: 2024,
      medium: 'Graphite on paper',
      dimensions: '16 × 20 in',
      short_description: 'A study of the last ordinary second before everything changes.',
      story: 'Most portraits capture a person as they want to be seen.\n\nThis one tries to catch something a person doesn’t know is showing — the second right before they brace for what’s next.',
      categories: ['human_emotion'],
      availability: 'private_collection',
      price_display_mode: 'hidden',
      is_original: true,
      signed: true,
      imageSeed: 'held',
    },
  ];

  seedArtworks.forEach((s, i) => {
    const artwork = createArtwork({
      ...s,
      hero_image_url: `/gallery-assets/placeholder/${s.imageSeed}.svg`,
      sort_order: i,
    } as any);
    addArtworkImage(artwork.id, { url: `/gallery-assets/placeholder/${s.imageSeed}-detail-1.svg`, kind: 'detail', alt: `Detail from ${artwork.title}` });
    addArtworkImage(artwork.id, { url: `/gallery-assets/placeholder/${s.imageSeed}-texture.svg`, kind: 'texture', alt: `Paper and graphite texture, ${artwork.title}` });
    addArtworkImage(artwork.id, { url: `/gallery-assets/placeholder/signature.svg`, kind: 'signature', alt: `Artist signature on ${artwork.title}` });
    addArtworkImage(artwork.id, { url: `/gallery-assets/placeholder/${s.imageSeed}-framed.svg`, kind: 'framed', alt: `${artwork.title}, framed and installed` });
  });

  // One symbolism hotspot on the first piece, as an example for the admin.
  const garden = getArtworkBySlug('the-garden', { includeUnpublished: true });
  if (garden) {
    addSymbolism(garden.id, { label: 'The Shadow', description: 'Represents the part of ourselves we hide from everyone else.', x_pct: 62, y_pct: 48 });
    addSymbolism(garden.id, { label: 'The Open Gate', description: 'A way out that was always there — never used.', x_pct: 28, y_pct: 71 });
  }

  const releaseDate = new Date(Date.now() + 14 * 24 * 60 * 60 * 1000).toISOString();
  createArtwork({
    title: 'Untitled (Forthcoming)',
    year: new Date().getFullYear(),
    medium: 'Graphite and charcoal on paper',
    dimensions: '20 × 26 in',
    short_description: '',
    story: '',
    categories: [],
    availability: 'available',
    price_display_mode: 'upon_request',
    is_original: true,
    signed: true,
    silhouette_image_url: '/gallery-assets/placeholder/upcoming-silhouette.svg',
    release_at: releaseDate,
    sort_order: 99,
  } as any);

  createStory({
    title: 'On Drawing What People Don’t Say',
    dek: 'Notes from the studio on why this work stays in graphite and charcoal, not color.',
    body: 'Color asks to be liked. Graphite and charcoal don’t have that problem — they can just sit with something difficult until it’s true.\n\nEvery piece here starts the same way: a feeling I can’t say out loud yet, and paper.',
    sort_order: 0,
  });
}

seedIfEmpty();
