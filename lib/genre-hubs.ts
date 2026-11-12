import { getNextMarket } from './db';
import { getGenreOptions } from './genre-prefs';
import { matchesGenrePrefs } from './genre-match';
import type { NextMarketRow } from './types';

// Genre pages (/next/genres/<slug>): one public, shareable page per genre,
// built from the same genre options onboarding offers. Matching uses the
// same rules as "For you" (lib/genre-match.ts), so "R&B" includes an
// artist tagged "Pop/R&B".

export function genreSlug(label: string): string {
  return label.toLowerCase().replace(/&/g, 'n').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
}

export type GenreHub = { label: string; slug: string; count: number };

export async function getGenreHubs(): Promise<GenreHub[]> {
  const [options, rows] = await Promise.all([getGenreOptions(), getNextMarket()]);
  return options
    .map((label) => ({ label, slug: genreSlug(label), count: rows.filter((r) => matchesGenrePrefs(r.artist.genre, [label])).length }))
    .filter((h) => h.slug.length > 0);
}

export async function getGenreHub(slug: string): Promise<{ hub: GenreHub; rows: NextMarketRow[] } | null> {
  const options = await getGenreOptions();
  const label = options.find((o) => genreSlug(o) === slug);
  if (!label) return null;
  const rows = (await getNextMarket()).filter((r) => matchesGenrePrefs(r.artist.genre, [label]));
  return { hub: { label, slug, count: rows.length }, rows };
}

// The hub an artist's genre belongs to (first match in option order), for
// linking an artist page to its genre page.
export async function hubForGenre(genre: string | null | undefined): Promise<GenreHub | null> {
  if (!genre) return null;
  const options = await getGenreOptions();
  const label = options.find((o) => matchesGenrePrefs(genre, [o]));
  return label ? { label, slug: genreSlug(label), count: 0 } : null;
}
