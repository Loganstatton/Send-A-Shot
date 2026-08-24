import { afterEach, describe, expect, it, vi } from 'vitest';
import { getTopSongForArtist, searchArtist } from './deezer';

// Real Deezer /search/artist response shape (see git history / Deezer's
// public docs) — picture_medium is what searchArtist should prefer.
function searchResponse(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    data: [
      {
        id: 10977,
        name: 'Paramore',
        picture: 'https://api.deezer.com/artist/10977/image',
        picture_small: 'https://cdns-images.dzcdn.net/images/artist/x/56x56.jpg',
        picture_medium: 'https://cdns-images.dzcdn.net/images/artist/x/250x250.jpg',
        picture_big: 'https://cdns-images.dzcdn.net/images/artist/x/500x500.jpg',
        ...overrides,
      },
    ],
  };
}

function mockFetchSequence(responses: { ok: boolean; json: unknown }[]) {
  let call = 0;
  global.fetch = vi.fn(async () => {
    const r = responses[Math.min(call, responses.length - 1)];
    call++;
    return { ok: r.ok, status: r.ok ? 200 : 500, json: async () => r.json, text: async () => JSON.stringify(r.json) } as any;
  });
}

describe('Deezer artist photo (free, uncapped alternative to Soundcharts)', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('searchArtist prefers picture_medium, falling back through picture_big to picture', async () => {
    mockFetchSequence([{ ok: true, json: searchResponse() }]);
    const result = await searchArtist('Paramore');
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.data?.photoUrl).toBe('https://cdns-images.dzcdn.net/images/artist/x/250x250.jpg');
  });

  it('searchArtist falls back to picture_big when picture_medium is absent', async () => {
    mockFetchSequence([{ ok: true, json: searchResponse({ picture_medium: undefined }) }]);
    const result = await searchArtist('Paramore');
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.data?.photoUrl).toBe('https://cdns-images.dzcdn.net/images/artist/x/500x500.jpg');
  });

  it('getTopSongForArtist returns photo_url alongside top_song_url on a full success', async () => {
    mockFetchSequence([
      { ok: true, json: searchResponse() },
      { ok: true, json: { data: [{ link: 'https://www.deezer.com/track/123', preview: 'https://cdn.example/preview.mp3', title: 'Ain’t It Fun' }] } },
    ]);
    const result = await getTopSongForArtist('Paramore');
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data.top_song_url).toBe('https://www.deezer.com/track/123');
      expect(result.data.photo_url).toBe('https://cdns-images.dzcdn.net/images/artist/x/250x250.jpg');
    }
  });

  it('getTopSongForArtist still surfaces the photo when the artist has no top track (previously a hard failure, losing the photo too)', async () => {
    mockFetchSequence([
      { ok: true, json: searchResponse() },
      { ok: true, json: { data: [] } }, // no top track
    ]);
    const result = await getTopSongForArtist('Paramore');
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data.photo_url).toBe('https://cdns-images.dzcdn.net/images/artist/x/250x250.jpg');
      expect(result.data.top_song_url).toBeUndefined();
    }
  });

  it('getTopSongForArtist still surfaces the photo when the top-track lookup call itself errors', async () => {
    mockFetchSequence([
      { ok: true, json: searchResponse() },
      { ok: false, json: {} },
    ]);
    const result = await getTopSongForArtist('Paramore');
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data.photo_url).toBe('https://cdns-images.dzcdn.net/images/artist/x/250x250.jpg');
      expect(result.data.top_song_url).toBeUndefined();
    }
  });

  it('getTopSongForArtist is a genuine failure when the artist search itself finds nothing (no photo to surface)', async () => {
    mockFetchSequence([{ ok: true, json: { data: [] } }]);
    const result = await getTopSongForArtist('Some Totally Unknown Name');
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe('no_artist_match');
  });
});
