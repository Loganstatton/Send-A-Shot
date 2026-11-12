import { describe, expect, it } from 'vitest';

const { createUser, completeNextOnboarding, logEvent } = await import('./db');
const { getGrowthLoops } = await import('./analytics');
const { createLeague, joinLeague } = await import('./leagues');
const { setGenrePrefs } = await import('./genre-prefs');

describe('getGrowthLoops', () => {
  it('counts each loop from the events and tables it says it does', async () => {
    const before = await getGrowthLoops();

    const owner = await createUser({ name: 'Loop Owner', email: 'loop-owner@example.com', password_hash: 'x' });
    const friend = await createUser({ name: 'Loop Friend', email: 'loop-friend@example.com', password_hash: 'x' });
    await completeNextOnboarding(owner.id);
    await setGenrePrefs(owner.id, ['Pop']);

    await logEvent(null, 'discover_viewed', { guest: true });
    await logEvent(owner.id, 'discover_viewed');
    await logEvent(null, 'artist_detail_opened', { artistId: 1 });
    await logEvent(null, 'artist_detail_opened', { artistId: 1, proofRecordId: 9, via: 'proof_page' });
    await logEvent(friend.id, 'artist_detail_opened', { artistId: 1, proofRecordId: 9, via: 'proof_page' });
    await logEvent(owner.id, 'proof_link_shared', { recordId: 9, method: 'copy' });

    const league = await createLeague(owner.id, 'Loop League');
    if (!league.ok) throw new Error(league.error);
    await logEvent(owner.id, 'league_invite_shared', { leagueId: league.league.id, method: 'copy' });
    await logEvent(null, 'league_invite_viewed', { leagueId: league.league.id, guest: true });
    await logEvent(friend.id, 'league_invite_viewed', { leagueId: league.league.id, guest: false });
    await joinLeague(friend.id, league.league.invite_code);
    await logEvent(friend.id, 'league_joined', { leagueId: league.league.id });

    const after = await getGrowthLoops();
    const d = (k: keyof typeof after) => after[k] - before[k];
    expect(d('guestDiscoverViews')).toBe(1);
    expect(d('guestArtistViews')).toBe(1); // the proof-page view is counted separately
    expect(d('signups')).toBe(2);
    expect(d('onboardingCompleted')).toBe(1);
    expect(d('pickedGenres')).toBe(1);
    expect(d('proofLinksShared')).toBe(1);
    expect(d('proofViewsSignedOut')).toBe(1);
    expect(d('proofViewsSignedIn')).toBe(1);
    expect(d('leaguesActive')).toBe(1);
    expect(d('leagueMembers')).toBe(2);
    expect(d('leagueInvitesShared')).toBe(1);
    expect(d('inviteViewsSignedOut')).toBe(1);
    expect(d('inviteViewsSignedIn')).toBe(1);
    expect(d('leagueJoins')).toBe(1);
  });
});
