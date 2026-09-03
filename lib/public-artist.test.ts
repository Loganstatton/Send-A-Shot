import { describe, expect, it } from 'vitest';
import { toPublicArtist } from './public-artist';
import { Artist, SCORE_WEIGHTS } from './types';

// The exact internal fields a PublicArtist must NEVER carry — see
// PublicArtist's own comment in lib/types.ts for the full reasoning.
// Testing the actual serialized JSON (not just TypeScript's structural
// type) is deliberate: TypeScript would happily let a future
// `{ ...rawArtist, extraField: 'x' }` typo slip through since object
// literals aren't checked against PublicArtist unless assigned directly to
// one — this test catches that at runtime regardless of how the leak
// happens, which is the whole point per the migration brief's "catch a
// future developer accidentally doing `artist: rawArtist` again."
const FORBIDDEN_KEYS = [
  'stage', 'scout_name', 'notes', 'created_by', 'created_by_name', 'high_rating_note',
  'claimed_by_user_id', 'soundcharts_uuid', 'soundcharts_synced_at', 'deezer_synced_at',
  'youtube_synced_at', 'soundcharts_no_match_at', 'youtube_no_match_at', 'featured_video_match_type',
  'followers_count', 'monthly_listeners', 'growth_velocity_pct', 'engagement_rate_pct',
  'top_song_url', 'song_preview_url', 'photo_source_type', 'photo_source_url',
  'photo_uploaded_by_user_id', 'photo_uploaded_at', 'photo_rights_confirmed_at',
  'wikidata_qid', 'wikidata_fetched_at', 'wikidata_no_match_at',
  ...Object.keys(SCORE_WEIGHTS), // the 8 raw rating categories
] as const;

function makeRawArtist(overrides: Partial<Artist> = {}): Artist {
  const now = new Date().toISOString();
  return {
    id: 1, created_at: now, updated_at: now, name: 'Test Artist', stage: 'portfolio',
    genre: 'Pop', location: 'Los Angeles, CA', scout_name: 'Internal Scout Name',
    notes: 'Confidential internal scouting notes.', created_by: 42, created_by_name: 'Admin User',
    high_rating_note: 'Rated 9 because of X internal reasoning.', claimed_by_user_id: 7,
    soundcharts_uuid: 'uuid-secret-123', soundcharts_synced_at: now, deezer_synced_at: now,
    youtube_synced_at: now,
    featured_video_match_type: 'search_unverified',
    followers_count: 123456, monthly_listeners: 98765, growth_velocity_pct: 12.5, engagement_rate_pct: 4.2,
    top_song_url: 'https://deezer.com/track/secret', song_preview_url: 'https://cdn.example/preview.mp3',
    music_talent: 9, growth_velocity: 8, engagement_quality: 7, original_song_response: 6,
    brand_personality: 5, content_consistency: 4, commercial_potential: 3, professionalism: 2,
    photo_url: 'https://example.com/photo.jpg', bio: 'A public bio.', why_trending: 'Public reason.',
    featured_video_id: 'dQw4w9WgXcQ', website_url: 'https://artist-site.example',
    tiktok_url: 'https://tiktok.com/@artist', instagram_url: 'https://instagram.com/artist',
    youtube_url: 'https://youtube.com/@artist', spotify_url: 'https://open.spotify.com/artist/x',
    soundcloud_url: 'https://soundcloud.com/artist',
    photo_source_type: 'SCOUT_MANUAL', photo_source_url: 'https://example.com/photo.jpg',
    photo_uploaded_by_user_id: 7, photo_uploaded_at: now, photo_rights_confirmed_at: now,
    wikidata_qid: 'Q999999', wikidata_fetched_at: now, wikidata_no_match_at: undefined,
    ...overrides,
  };
}

describe('toPublicArtist — DTO security boundary', () => {
  it('the serialized JSON never contains any forbidden internal key, regardless of value', () => {
    const raw = makeRawArtist();
    const publicArtist = toPublicArtist(raw);
    const serialized = JSON.stringify(publicArtist);
    for (const key of FORBIDDEN_KEYS) {
      expect(serialized.includes(`"${key}"`)).toBe(false);
    }
  });

  it('never leaks the raw claimed_by_user_id — only the boolean isClaimed', () => {
    const raw = makeRawArtist({ claimed_by_user_id: 7 });
    const publicArtist: any = toPublicArtist(raw);
    expect(publicArtist.claimed_by_user_id).toBeUndefined();
    expect(publicArtist.isClaimed).toBe(true);

    const unclaimed = toPublicArtist(makeRawArtist({ claimed_by_user_id: undefined })) as any;
    expect(unclaimed.isClaimed).toBe(false);
  });

  it('carries through every field Public NEXT is genuinely allowed to see', () => {
    const raw = makeRawArtist();
    const publicArtist = toPublicArtist(raw);
    expect(publicArtist.id).toBe(raw.id);
    expect(publicArtist.name).toBe(raw.name);
    expect(publicArtist.genre).toBe(raw.genre);
    expect(publicArtist.location).toBe(raw.location);
    expect(publicArtist.bio).toBe(raw.bio);
    expect(publicArtist.photo_url).toBe(raw.photo_url);
    expect(publicArtist.why_trending).toBe(raw.why_trending);
    expect(publicArtist.featured_video_id).toBe(raw.featured_video_id);
    expect(publicArtist.website_url).toBe(raw.website_url);
    expect(publicArtist.tiktok_url).toBe(raw.tiktok_url);
    expect(publicArtist.instagram_url).toBe(raw.instagram_url);
    expect(publicArtist.youtube_url).toBe(raw.youtube_url);
    expect(publicArtist.spotify_url).toBe(raw.spotify_url);
    expect(publicArtist.soundcloud_url).toBe(raw.soundcloud_url);
  });

  describe('photo source gating (never Deezer/Soundcharts publicly)', () => {
    it('hides photo_url entirely when sourced from LEGACY_DEEZER', () => {
      const raw = makeRawArtist({ photo_source_type: 'LEGACY_DEEZER', photo_url: 'https://deezer-cdn.example/photo.jpg' });
      const publicArtist = toPublicArtist(raw);
      expect(publicArtist.photo_url).toBeUndefined();
    });

    it('hides photo_url entirely when sourced from LEGACY_SOUNDCHARTS', () => {
      const raw = makeRawArtist({ photo_source_type: 'LEGACY_SOUNDCHARTS', photo_url: 'https://soundcharts-cdn.example/photo.jpg' });
      const publicArtist = toPublicArtist(raw);
      expect(publicArtist.photo_url).toBeUndefined();
    });

    it('keeps photo_url for ARTIST_PROVIDED, WIKIMEDIA_COMMONS, SCOUT_MANUAL, and legacy-untagged photos', () => {
      for (const sourceType of ['ARTIST_PROVIDED', 'WIKIMEDIA_COMMONS', 'SCOUT_MANUAL', undefined] as const) {
        const raw = makeRawArtist({ photo_source_type: sourceType, photo_url: 'https://example.com/ok.jpg' });
        expect(toPublicArtist(raw).photo_url).toBe('https://example.com/ok.jpg');
      }
    });

    it('exposes Commons attribution/license/license URL ONLY when the source is WIKIMEDIA_COMMONS', () => {
      const raw = makeRawArtist({
        photo_source_type: 'WIKIMEDIA_COMMONS', photo_attribution: 'Jane Photographer, CC BY-SA 4.0',
        photo_license: 'CC BY-SA 4.0', photo_license_url: 'https://creativecommons.org/licenses/by-sa/4.0',
      });
      const publicArtist = toPublicArtist(raw);
      expect(publicArtist.photo_attribution).toBe('Jane Photographer, CC BY-SA 4.0');
      expect(publicArtist.photo_license).toBe('CC BY-SA 4.0');
      expect(publicArtist.photo_license_url).toBe('https://creativecommons.org/licenses/by-sa/4.0');
    });

    it('never exposes attribution/license fields for a non-Commons source, even if the raw row happens to carry stale values', () => {
      const raw = makeRawArtist({
        photo_source_type: 'SCOUT_MANUAL', photo_attribution: 'stale leftover value', photo_license: 'stale', photo_license_url: 'stale',
      });
      const publicArtist = toPublicArtist(raw);
      expect(publicArtist.photo_attribution).toBeUndefined();
      expect(publicArtist.photo_license).toBeUndefined();
      expect(publicArtist.photo_license_url).toBeUndefined();
    });

    it('never exposes the raw photo_source_type label itself under any circumstance', () => {
      for (const sourceType of ['ARTIST_PROVIDED', 'WIKIMEDIA_COMMONS', 'SCOUT_MANUAL', 'LEGACY_DEEZER', 'LEGACY_SOUNDCHARTS', 'YOUTUBE', 'NEXT'] as const) {
        const publicArtist: any = toPublicArtist(makeRawArtist({ photo_source_type: sourceType }));
        expect(publicArtist.photo_source_type).toBeUndefined();
        expect(JSON.stringify(publicArtist).includes('photo_source_type')).toBe(false);
      }
    });
  });
});
