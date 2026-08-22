// Server-only Spotify Web API client. Never import this from a client
// component — SPOTIFY_CLIENT_ID/SPOTIFY_CLIENT_SECRET must never reach the
// browser bundle.
//
// Free to use: this only reads public catalog data (artist search, an
// artist's top tracks), which needs the Client Credentials flow — an
// app-only token, no user login, no scopes, no cost. A free Spotify
// Developer account (developer.spotify.com/dashboard) is all that's
// required to get a client id/secret.
//
// Purpose: fill top_song_url (and best-effort song_preview_url) — the one
// piece of "what NEXT users actually see" media data that never had any
// API source before (see the file header in lib/soundcharts.ts). Nothing
// here overlaps with Soundcharts; this runs independently of whether
// Soundcharts is configured or an artist is linked to it at all.

const AUTH_URL = 'https://accounts.spotify.com/api/token';
const API_BASE_URL = 'https://api.spotify.com/v1';

export function spotifyConfigured(): boolean {
  return Boolean(process.env.SPOTIFY_CLIENT_ID && process.env.SPOTIFY_CLIENT_SECRET);
}

type SpotifyResult<T> = { ok: true; data: T } | { ok: false; error: string };

// Client Credentials tokens last ~1 hour and don't depend on which artist
// is being looked up — cached in module scope so a sync run touching many
// artists reuses one token instead of requesting a fresh one per artist.
let cachedToken: { token: string; expiresAt: number } | null = null;

// Exported so a sync run can verify credentials ONCE before looping over
// every artist — a bad client id/secret should surface as one clear error
// immediately, not as N silent "no match" failures with no explanation
// (the exact bug already found and fixed for the YouTube scan's API key).
export async function getAccessToken(): Promise<SpotifyResult<string>> {
  const clientId = process.env.SPOTIFY_CLIENT_ID;
  const clientSecret = process.env.SPOTIFY_CLIENT_SECRET;
  if (!clientId || !clientSecret) return { ok: false, error: 'Spotify is not configured on this server.' };

  if (cachedToken && cachedToken.expiresAt > Date.now()) {
    return { ok: true, data: cachedToken.token };
  }

  let res: Response;
  try {
    res = await fetch(AUTH_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        Authorization: `Basic ${Buffer.from(`${clientId}:${clientSecret}`).toString('base64')}`,
      },
      body: 'grant_type=client_credentials',
      cache: 'no-store',
    });
  } catch (err: any) {
    return { ok: false, error: `Could not reach Spotify: ${err?.message ?? 'network error'}` };
  }

  if (!res.ok) {
    const body = await res.text().catch(() => '');
    return { ok: false, error: `Spotify auth returned ${res.status} — check SPOTIFY_CLIENT_ID/SPOTIFY_CLIENT_SECRET. Response: ${body.slice(0, 300)}` };
  }

  const json = await res.json().catch(() => null);
  const token = json?.access_token;
  const expiresIn = typeof json?.expires_in === 'number' ? json.expires_in : 3600;
  if (!token) return { ok: false, error: 'Spotify auth response did not include an access token.' };

  // Refresh 60s early so a token never expires mid-request.
  cachedToken = { token, expiresAt: Date.now() + (expiresIn - 60) * 1000 };
  return { ok: true, data: token };
}

async function spotifyFetch(path: string): Promise<SpotifyResult<any>> {
  const tokenResult = await getAccessToken();
  if (!tokenResult.ok) return tokenResult;

  let res: Response;
  try {
    res = await fetch(`${API_BASE_URL}${path}`, {
      headers: { Authorization: `Bearer ${tokenResult.data}` },
      cache: 'no-store',
    });
  } catch (err: any) {
    return { ok: false, error: `Could not reach Spotify: ${err?.message ?? 'network error'}` };
  }

  if (res.status === 401) {
    cachedToken = null; // stale/invalid token — clear so the next call re-authenticates
    return { ok: false, error: 'Spotify returned 401 — token was invalid or expired.' };
  }
  if (res.status === 404) return { ok: false, error: 'not found' };
  if (res.status === 429) return { ok: false, error: 'Spotify rate limit hit — try again shortly.' };
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    return { ok: false, error: `Spotify returned ${res.status}: ${body.slice(0, 400)}` };
  }

  try {
    return { ok: true, data: await res.json() };
  } catch {
    return { ok: false, error: 'Spotify returned a response that was not valid JSON.' };
  }
}

// Parses the artist id out of a URL a Scout typed in or Soundcharts
// returned, e.g. "https://open.spotify.com/artist/1234...?si=...". Not
// required — searchArtist() below works from just a name — but skips a
// search call entirely when a link is already on file.
export function extractSpotifyArtistId(spotifyUrl: string | null | undefined): string | null {
  if (!spotifyUrl) return null;
  const match = spotifyUrl.match(/open\.spotify\.com\/artist\/([a-zA-Z0-9]+)/);
  return match ? match[1] : null;
}

export type SpotifyArtistHit = { id: string; name: string };

export async function searchArtist(name: string): Promise<SpotifyResult<SpotifyArtistHit | null>> {
  const trimmed = name.trim();
  if (trimmed.length < 2) return { ok: true, data: null };

  const result = await spotifyFetch(`/search?q=${encodeURIComponent(trimmed)}&type=artist&limit=5`);
  if (!result.ok) return result;

  const items = result.data?.artists?.items;
  if (!Array.isArray(items) || items.length === 0) return { ok: true, data: null };

  // Prefer an exact (case-insensitive) name match among the top results —
  // an artist already tracked in Scout has a name a human chose deliberately,
  // so a confident match is worth preferring over Spotify's raw top hit.
  const normalized = trimmed.toLowerCase();
  const exact = items.find((item: any) => typeof item?.name === 'string' && item.name.toLowerCase() === normalized);
  const best = exact ?? items[0];
  return best?.id ? { ok: true, data: { id: best.id, name: best.name } } : { ok: true, data: null };
}

export type SpotifyTopTrack = { url: string; previewUrl?: string; name: string };

// Spotify already sorts by relevance/popularity for this market — the
// first track is the artist's biggest song there. `preview_url` is
// best-effort: Spotify has restricted 30-second previews for a large and
// growing share of tracks over the past few years, so this is often null
// even for a track with a real, working Spotify page — that's a Spotify
// platform limitation, not a bug here.
export async function getTopTrack(artistId: string, market = 'US'): Promise<SpotifyResult<SpotifyTopTrack | null>> {
  const result = await spotifyFetch(`/artists/${encodeURIComponent(artistId)}/top-tracks?market=${market}`);
  if (!result.ok) return result;

  const tracks = result.data?.tracks;
  if (!Array.isArray(tracks) || tracks.length === 0) return { ok: true, data: null };

  const top = tracks[0];
  const url = top?.external_urls?.spotify;
  if (!url) return { ok: true, data: null };

  return { ok: true, data: { url, previewUrl: top?.preview_url ?? undefined, name: top?.name } };
}

export type SpotifyTopSong = { top_song_url: string; song_preview_url?: string };

// Why a lookup didn't produce a top song — 'no_artist_match'/'no_top_track'
// mean the calls succeeded but genuinely found nothing (a fake/demo artist
// name, or a real artist with no tracks in this market); 'search_failed'/
// 'top_track_lookup_failed' mean an actual API call errored. Collapsing
// these into one "failed" bucket (the original design) hid exactly the
// distinction a Scout needs when a REAL artist unexpectedly gets no match:
// was Spotify actually asked and came up empty, or did something break?
export type SpotifyLookupFailureReason = 'no_artist_match' | 'search_failed' | 'no_top_track' | 'top_track_lookup_failed';

export type SpotifyLookupResult =
  | { ok: true; data: SpotifyTopSong }
  | { ok: false; reason: SpotifyLookupFailureReason; error?: string };

// The combined, one-call-site convenience this is actually used through:
// use an existing Spotify link if there is one (skips a search entirely),
// otherwise search by name. Never throws — a failure is always a typed
// result, never an exception, same as every other best-effort enrichment
// step in this app.
export async function getTopSongForArtist(name: string, existingSpotifyUrl?: string | null): Promise<SpotifyLookupResult> {
  const knownId = extractSpotifyArtistId(existingSpotifyUrl);
  let artistId = knownId;

  if (!artistId) {
    const searchResult = await searchArtist(name);
    if (!searchResult.ok) return { ok: false, reason: 'search_failed', error: searchResult.error };
    if (!searchResult.data) return { ok: false, reason: 'no_artist_match' };
    artistId = searchResult.data.id;
  }

  const trackResult = await getTopTrack(artistId);
  if (!trackResult.ok) return { ok: false, reason: 'top_track_lookup_failed', error: trackResult.error };
  if (!trackResult.data) return { ok: false, reason: 'no_top_track' };

  return { ok: true, data: { top_song_url: trackResult.data.url, song_preview_url: trackResult.data.previewUrl } };
}
