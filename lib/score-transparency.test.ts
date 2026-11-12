import { describe, expect, it } from 'vitest';

const { createArtist, createUser, db, getArtist, getPublicScoreChanges, updateArtist: updateArtistRaw, SCORE_RATIONALE_MAX } = await import('./db');
// Partial updates, as the Scout form and sync routes send them.
const updateArtist = (id: number, input: Record<string, unknown>, actor?: { id: number; name: string }) => updateArtistRaw(id, input as any, actor);
const { scoreGroups, scoreStrengths, SCORING_GUIDELINES } = await import('./scoring-guidelines');
const { breakoutScore } = await import('./scoring');
const { SCORE_WEIGHTS } = await import('./types');

const RATINGS = { music_talent: 8, growth_velocity: 6, engagement_quality: 7, original_song_response: 9, brand_personality: 5, content_consistency: 6, commercial_potential: 4, professionalism: 8 };
let seq = 0;
async function scout() {
  seq++;
  const u = await createUser({ name: `Scout ${seq}`, email: `scout-tr-${seq}@example.com`, password_hash: 'x' });
  return { id: u.id, name: u.name };
}

describe('score groups and strengths', () => {
  it('the three public groups add up to the Score and cover every category once', () => {
    const groups = scoreGroups(RATINGS);
    const total = groups.reduce((s, g) => s + g.points, 0);
    expect(Math.abs(total - breakoutScore(RATINGS))).toBeLessThan(0.2);
    expect(groups.reduce((s, g) => s + g.maxPoints, 0)).toBe(100);
    expect(groups.flatMap((g) => g.categories)).toHaveLength(8);
  });
  it('lists only categories rated 8+, strongest first, never the weak ones', () => {
    expect(scoreStrengths(RATINGS)).toEqual(['Original-Song Response', 'Music / Talent', 'Professionalism / Work Ethic']);
    expect(scoreStrengths({ ...RATINGS, music_talent: 2, original_song_response: 2, professionalism: 2 })).toEqual([]);
  });
  it('has a written guideline with four bands for every weighted category', () => {
    for (const c of Object.keys(SCORE_WEIGHTS) as (keyof typeof SCORING_GUIDELINES)[]) {
      expect(SCORING_GUIDELINES[c].question.length).toBeGreaterThan(10);
      expect(SCORING_GUIDELINES[c].anchors.map((a) => a.range)).toEqual(['0–3', '4–6', '7–8', '9–10']);
    }
  });
});

describe('rating history', () => {
  it('records who rated, when, and the public reasoning; a non-rating edit does not count as a re-rating', async () => {
    const s = await scout();
    const artist = await createArtist({ name: 'Rated Artist', genre: 'Pop', ...RATINGS, score_rationale: '  Strong songs, early audience.  ' }, s);
    const created = (await getArtist(artist.id))!;
    expect(created.scored_at).toBeTruthy();
    expect(created.scored_by).toBe(s.id);
    expect(created.score_rationale).toBe('Strong songs, early audience.');
    const firstRatedAt = created.scored_at;

    // A bio edit: no new rating.
    await new Promise((r) => setTimeout(r, 5));
    await updateArtist(artist.id, { bio: 'New bio' }, s);
    expect((await getArtist(artist.id))!.scored_at).toBe(firstRatedAt);

    // Same values re-submitted (the Scout form always sends every field): still no new rating.
    await updateArtist(artist.id, { ...RATINGS }, s);
    expect((await getArtist(artist.id))!.scored_at).toBe(firstRatedAt);

    // A real rating change, with new reasoning.
    const other = await scout();
    await updateArtist(artist.id, { music_talent: 10, score_rationale: 'New single is a big step up.' }, other);
    const rerated = (await getArtist(artist.id))!;
    expect(rerated.scored_at! > firstRatedAt!).toBe(true);
    expect(rerated.scored_by).toBe(other.id);

    const last = (await db.prepare('SELECT changed_by, rationale FROM score_history WHERE artist_id = ? ORDER BY id DESC LIMIT 1').get(artist.id)) as any;
    expect(last).toEqual({ changed_by: other.id, rationale: 'New single is a big step up.' });

    const changes = await getPublicScoreChanges(artist.id);
    expect(changes).toHaveLength(2); // the bio edit and same-value save don't show up
    expect(changes[0].from).toBeCloseTo(breakoutScore(RATINGS), 1);
    expect(changes[0].to).toBeCloseTo(breakoutScore({ ...RATINGS, music_talent: 10 }), 1);
    expect(changes[0].rationale).toBe('New single is a big step up.');
    expect(changes[1].from).toBeNull();
    expect(changes[1].rationale).toBe('Strong songs, early audience.');
  });

  it('an automated sync change (no person) is recorded without an author', async () => {
    const artist = await createArtist({ name: 'Synced Artist', ...RATINGS });
    await updateArtist(artist.id, { growth_velocity: 9 });
    const last = (await db.prepare('SELECT changed_by FROM score_history WHERE artist_id = ? ORDER BY id DESC LIMIT 1').get(artist.id)) as any;
    expect(last.changed_by).toBeNull();
  });

  it('blank reasoning is stored as none and long reasoning is capped', async () => {
    const s = await scout();
    const a = await createArtist({ name: 'Blank Reason', ...RATINGS, score_rationale: '   ' }, s);
    expect((await getArtist(a.id))!.score_rationale ?? null).toBeNull();
    await updateArtist(a.id, { score_rationale: 'x'.repeat(SCORE_RATIONALE_MAX + 50) }, s);
    expect((await getArtist(a.id))!.score_rationale).toHaveLength(SCORE_RATIONALE_MAX);
  });
});
