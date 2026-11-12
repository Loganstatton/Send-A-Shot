import { db } from './pg';
import { getAvailableGenres } from './db';
import { genreParts as parts } from './genre-match';

export { matchesGenrePrefs } from './genre-match';

// Which genres a player likes, so Discover can open on artists they'll
// actually want to hear. Matching rules live in lib/genre-match.ts.

export const MAX_GENRE_PREFS = 6;

// Always offered, even before the roster has artists in them, so a new
// market's onboarding isn't an empty list.
export const DEFAULT_GENRE_OPTIONS = ['Pop', 'Hip-Hop/Rap', 'R&B', 'Rock/Alternative', 'Country', 'Electronic', 'Latin', 'Indie'];

// The genres to offer: the defaults plus every genre on the roster that the
// defaults don't already cover, defaults first.
export async function getGenreOptions(): Promise<string[]> {
  const roster = await getAvailableGenres();
  const covered = new Set(DEFAULT_GENRE_OPTIONS.flatMap(parts));
  const extra = roster.filter((g) => !parts(g).every((p) => covered.has(p)));
  return [...DEFAULT_GENRE_OPTIONS, ...extra];
}

// Keeps only offered options (matched case-insensitively, stored in the
// option's own spelling), de-duplicated, capped.
export function cleanGenrePrefs(input: unknown, options: string[]): { ok: true; genres: string[] } | { ok: false; error: string } {
  if (!Array.isArray(input)) return { ok: false, error: 'genres must be a list.' };
  const byLower = new Map(options.map((o) => [o.toLowerCase(), o]));
  const out: string[] = [];
  for (const raw of input) {
    if (typeof raw !== 'string') continue;
    const match = byLower.get(raw.trim().toLowerCase());
    if (match && !out.includes(match)) out.push(match);
  }
  if (out.length > MAX_GENRE_PREFS) return { ok: false, error: `Pick up to ${MAX_GENRE_PREFS} genres.` };
  return { ok: true, genres: out };
}

export async function getGenrePrefs(userId: number): Promise<string[]> {
  const row = (await db.prepare('SELECT next_genre_prefs FROM users WHERE id = ?').get(userId)) as { next_genre_prefs: string | null } | undefined;
  if (!row?.next_genre_prefs) return [];
  try {
    const parsed = JSON.parse(row.next_genre_prefs);
    return Array.isArray(parsed) ? parsed.filter((g): g is string => typeof g === 'string') : [];
  } catch {
    return [];
  }
}

export async function setGenrePrefs(userId: number, genres: string[]): Promise<void> {
  await db.prepare('UPDATE users SET next_genre_prefs = ? WHERE id = ?').run(genres.length > 0 ? JSON.stringify(genres) : null, userId);
}
