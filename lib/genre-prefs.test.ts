import { describe, expect, it } from 'vitest';

const { createArtist, createUser, db } = await import('./db');
const {
  cleanGenrePrefs, DEFAULT_GENRE_OPTIONS, getGenreOptions, getGenrePrefs, matchesGenrePrefs, MAX_GENRE_PREFS, setGenrePrefs,
} = await import('./genre-prefs');
const { getNotificationsForUser } = await import('./notifications');

let seq = 0;
async function makeArtist(genre: string) {
  seq++;
  return createArtist({
    name: `Genre Artist ${seq}`, genre, music_talent: 7, growth_velocity: 7, engagement_quality: 7, original_song_response: 7,
    brand_personality: 7, content_consistency: 7, commercial_potential: 7, professionalism: 7,
  });
}

describe('matchesGenrePrefs', () => {
  it('matches on any slash- or comma-separated part, ignoring case', () => {
    expect(matchesGenrePrefs('Pop/R&B', ['R&B'])).toBe(true);
    expect(matchesGenrePrefs('Rap', ['Hip-Hop/Rap'])).toBe(true);
    expect(matchesGenrePrefs('indie, folk', ['Indie'])).toBe(true);
    expect(matchesGenrePrefs('Country', ['Pop', 'R&B'])).toBe(false);
  });
  it('never matches a missing genre or an empty preference list', () => {
    expect(matchesGenrePrefs(null, ['Pop'])).toBe(false);
    expect(matchesGenrePrefs('Pop', [])).toBe(false);
  });
  it('does not treat a part of a word as a match', () => {
    expect(matchesGenrePrefs('K-Pop', ['Pop'])).toBe(false);
  });
});

describe('cleanGenrePrefs', () => {
  const options = ['Pop', 'R&B', 'Country'];
  it('keeps only offered genres, in their own spelling, without duplicates', () => {
    expect(cleanGenrePrefs([' pop ', 'POP', 'Polka', 42, 'r&b'], options)).toEqual({ ok: true, genres: ['Pop', 'R&B'] });
  });
  it('rejects a non-list and more than the cap', () => {
    expect(cleanGenrePrefs('Pop', options).ok).toBe(false);
    const many = Array.from({ length: MAX_GENRE_PREFS + 1 }, (_, i) => `G${i}`);
    expect(cleanGenrePrefs(many, many).ok).toBe(false);
  });
});

describe('genre options and storage', () => {
  it('offers the defaults first, then roster genres the defaults do not already cover', async () => {
    await makeArtist('Afrobeats');
    await makeArtist('Pop/R&B');
    const options = await getGenreOptions();
    expect(options.slice(0, DEFAULT_GENRE_OPTIONS.length)).toEqual(DEFAULT_GENRE_OPTIONS);
    expect(options).toContain('Afrobeats');
    expect(options).not.toContain('Pop/R&B'); // both parts already offered
  });

  it('saves, reads back and clears a player’s genres', async () => {
    const user = await createUser({ name: 'Genre Fan', email: 'genre-fan@example.com', password_hash: 'hash' });
    expect(await getGenrePrefs(user.id)).toEqual([]);
    await setGenrePrefs(user.id, ['Pop', 'Country']);
    expect(await getGenrePrefs(user.id)).toEqual(['Pop', 'Country']);
    await setGenrePrefs(user.id, []);
    expect(await getGenrePrefs(user.id)).toEqual([]);
  });

  it('reads a corrupted value as no preferences instead of failing', async () => {
    const user = await createUser({ name: 'Corrupt Prefs', email: 'corrupt-prefs@example.com', password_hash: 'hash' });
    await db.prepare('UPDATE users SET next_genre_prefs = ? WHERE id = ?').run('not json', user.id);
    expect(await getGenrePrefs(user.id)).toEqual([]);
  });
});

describe('new-artist notifications use picked genres', () => {
  it('a brand-new player who picked a genre hears about new artists in it, without having backed anyone', async () => {
    const user = await createUser({ name: 'Picker', email: 'picker@example.com', password_hash: 'hash' });
    const artist = await makeArtist('Country/Folk');
    let notes = await getNotificationsForUser(user);
    expect(notes.some((n) => n.kind === 'new_artist_genre' && n.artistId === artist.id)).toBe(false);

    await setGenrePrefs(user.id, ['Country']);
    notes = await getNotificationsForUser(user);
    expect(notes.some((n) => n.kind === 'new_artist_genre' && n.artistId === artist.id)).toBe(true);
  });
});
