import { describe, expect, it } from 'vitest';

const { createArtist, createUser, db, executeTrade, logEvent, recordPreviewListen } = await import('./db');
const { classifySignupSource } = await import('./attribution');
const { getFeedbackSummary, submitFeedback, FEEDBACK_PER_DAY } = await import('./feedback');
const { getActivityPulse } = await import('./analytics');

let seq = 0;
const user = async () => { seq++; return createUser({ name: `Pulse ${seq}`, email: `pulse-${seq}@example.com`, password_hash: 'x' }); };

describe('signup source', () => {
  it('classifies the return path, keeping invite codes out of what is stored', () => {
    expect(classifySignupSource('/next/leagues/join/ABCD2345')).toEqual({ via: 'league_invite', path: '/next/leagues/join/…' });
    expect(classifySignupSource('/next/proof/12')).toEqual({ via: 'proof_link', path: '/next/proof/12' });
    expect(classifySignupSource('/next/artists/7?ref=feed')).toEqual({ via: 'artist_page', path: '/next/artists/7' });
    expect(classifySignupSource('/next/genres/rnb').via).toBe('genre_page');
    expect(classifySignupSource('/next/collections/late-night').via).toBe('collection');
    expect(classifySignupSource('/next').via).toBe('discover');
    expect(classifySignupSource(undefined)).toEqual({ via: 'direct', path: null });
    expect(classifySignupSource('https://evil.example/x')).toEqual({ via: 'direct', path: null });
    expect(classifySignupSource('//evil.example')).toEqual({ via: 'direct', path: null });
  });
});

describe('beta feedback', () => {
  it('needs at least one answer, caps per day, and summarises understanding', async () => {
    const u = await user();
    expect(await submitFeedback(u.id, {})).toMatchObject({ ok: false, status: 400 });
    expect(await submitFeedback(u.id, { understood: 'maybe' })).toMatchObject({ ok: false, status: 400 });
    const before = await getFeedbackSummary();
    expect((await submitFeedback(u.id, { understood: 'partly', enjoyed: 'The proof cards', page: '/next' })).ok).toBe(true);
    for (let i = 1; i < FEEDBACK_PER_DAY; i++) await submitFeedback(u.id, { confused: 'Price vs Score' });
    expect(await submitFeedback(u.id, { confused: 'again' })).toMatchObject({ ok: false, status: 429 });
    const after = await getFeedbackSummary();
    expect(after.partly - before.partly).toBe(1);
    expect(after.total - before.total).toBe(FEEDBACK_PER_DAY);
  });
});

describe('activity pulse', () => {
  it('counts active players, next-week returners and signup sources', async () => {
    const before = await getActivityPulse();
    const a = await user();
    const b = await user();
    const artist = await createArtist({ name: `Pulse Artist ${seq}`, genre: 'Pop', music_talent: 7, growth_velocity: 7, engagement_quality: 7, original_song_response: 7, brand_personality: 7, content_consistency: 7, commercial_potential: 7, professionalism: 7 });
    await logEvent(a.id, 'signup_completed', { via: 'league_invite', path: '/next/leagues/join/…' });
    await recordPreviewListen(b.id, artist.id, 'started');

    // A player who joined 10 days ago and came back 8 days after joining.
    const returner = await user();
    const joined = new Date(Date.now() - 10 * 86_400_000).toISOString();
    await db.prepare('UPDATE users SET created_at = ? WHERE id = ?').run(joined, returner.id);
    await executeTrade(returner.id, artist.id, 'buy', 10_000);
    await db.prepare('UPDATE next_transactions SET created_at = ? WHERE user_id = ?').run(new Date(Date.now() - 2 * 86_400_000).toISOString(), returner.id);
    // …and one who joined then and never came back.
    const gone = await user();
    await db.prepare('UPDATE users SET created_at = ? WHERE id = ?').run(joined, gone.id);

    const after = await getActivityPulse();
    expect(after.dau - before.dau).toBeGreaterThanOrEqual(2);
    expect(after.returnedNextWeek.eligible - before.returnedNextWeek.eligible).toBe(2);
    expect(after.returnedNextWeek.returned - before.returnedNextWeek.returned).toBe(1);
    const invites = (p: typeof after) => p.signupsBySource.find((s) => s.via === 'league_invite')?.count ?? 0;
    expect(invites(after) - invites(before)).toBe(1);
    expect(after.artistsOnNext).toBeGreaterThan(0);
  });
});
