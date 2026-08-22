// Server-only Deezer API client — replaces the earlier Spotify integration
// (see git history) after Spotify's Client Credentials flow started
// returning 403 Forbidden on every catalog call for newly-created apps,
// even correctly configured ones, with no fix available from our side.
//
// Deezer's public catalog endpoints (artist search, an artist's top track)
// need no API key, no app registration, no OAuth — they're just public
// GET requests. Free, and nothing to misconfigure. Deezer also reliably
// returns a direct 30-second preview mp3 for almost every track, which
// Spotify had stopped doing for a growing share of its catalog anyway.
//
// One quirk to know: Deezer signals errors inside a 200 OK response body
// (`{"error": {...}}`), not via HTTP status codes — deezerFetch below
// checks for that explicitly rather than trusting res.ok alone.

const API_BASE_URL = 'https://api.deezer.com';

type DeezerResult<T> = { ok: true; data: T } | { ok: false; error: string };

async function deezerFetch(path: string): Promise<DeezerResult<any>> {
  let res: Response;
  try {
    res = await fetch(`${API_BASE_URL}${path}`, { cache: 'no-store' });
  } catch (err: any) {
    return { ok: false, error: `Could not reach Deezer: ${err?.message ?? 'network error'}` };
  }

  if (!res.ok) {
    const body = await res.text().catch(() => '');
    return { ok: false, error: `Deezer returned ${res.status}: ${body.slice(0, 400)}` };
  }

  const json = await res.json().catch(() => null);
  if (json == null) return { ok: false, error: 'Deezer returned a response that was not valid JSON.' };
  if (json.error) return { ok: false, error: `Deezer error: ${json.error.message ?? JSON.stringify(json.error)}` };

  return { ok: true, data: json };
}

export type DeezerArtistHit = { id: number; name: string };

export async function searchArtist(name: string): Promise<DeezerResult<DeezerArtistHit | null>> {
  const trimmed = name.trim();
  if (trimmed.length < 2) return { ok: true, data: null };

  const result = await deezerFetch(`/search/artist?q=${encodeURIComponent(trimmed)}&limit=5`);
  if (!result.ok) return result;

  const items = result.data?.data;
  if (!Array.isArray(items) || items.length === 0) return { ok: true, data: null };

  // Same preference as the earlier Spotify lookup: an exact (case-insensitive)
  // name match among the top results over Deezer's raw top hit.
  const normalized = trimmed.toLowerCase();
  const exact = items.find((item: any) => typeof item?.name === 'string' && item.name.toLowerCase() === normalized);
  const best = exact ?? items[0];
  return best?.id ? { ok: true, data: { id: best.id, name: best.name } } : { ok: true, data: null };
}

export type DeezerTopTrack = { url: string; previewUrl?: string; name: string };

export async function getTopTrack(artistId: number): Promise<DeezerResult<DeezerTopTrack | null>> {
  const result = await deezerFetch(`/artist/${encodeURIComponent(String(artistId))}/top?limit=1`);
  if (!result.ok) return result;

  const tracks = result.data?.data;
  if (!Array.isArray(tracks) || tracks.length === 0) return { ok: true, data: null };

  const top = tracks[0];
  if (!top?.link) return { ok: true, data: null };

  return { ok: true, data: { url: top.link, previewUrl: top.preview || undefined, name: top.title } };
}

export type DeezerTopSong = { top_song_url: string; song_preview_url?: string };

// Same missing-vs-error distinction the earlier Spotify version established:
// 'no_artist_match'/'no_top_track' mean the calls succeeded but genuinely
// found nothing; 'search_failed'/'top_track_lookup_failed' mean an actual
// call errored — a Scout needs to tell those apart when a real artist
// unexpectedly gets no match.
export type DeezerLookupFailureReason = 'no_artist_match' | 'search_failed' | 'no_top_track' | 'top_track_lookup_failed';

export type DeezerLookupResult =
  | { ok: true; data: DeezerTopSong }
  | { ok: false; reason: DeezerLookupFailureReason; error?: string };

// The combined, one-call-site convenience this is actually used through.
// No existing-link shortcut like the Spotify version had — artists don't
// have a stored Deezer id to skip the search from, and Deezer's rate limit
// (50 req/5s) is generous enough that always searching by name is fine.
export async function getTopSongForArtist(name: string): Promise<DeezerLookupResult> {
  const searchResult = await searchArtist(name);
  if (!searchResult.ok) return { ok: false, reason: 'search_failed', error: searchResult.error };
  if (!searchResult.data) return { ok: false, reason: 'no_artist_match' };

  const trackResult = await getTopTrack(searchResult.data.id);
  if (!trackResult.ok) return { ok: false, reason: 'top_track_lookup_failed', error: trackResult.error };
  if (!trackResult.data) return { ok: false, reason: 'no_top_track' };

  return { ok: true, data: { top_song_url: trackResult.data.url, song_preview_url: trackResult.data.previewUrl } };
}
