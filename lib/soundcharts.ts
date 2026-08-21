// Server-only Soundcharts API client. Never import this from a client
// component — SOUNDCHARTS_APP_ID/SOUNDCHARTS_API_KEY must never reach the
// browser bundle.
//
// Confirmed against real responses (search "Taylor Swift" and "Drake" on
// the live deploy, checked in Render's logs): GET /api/v2/artist/{uuid}
// returns only { uuid, slug, name, appUrl, imageUrl, webUrl, countryCode }
// — no genres, no biography, no platform identifiers, even for an artist
// as major as Drake. That's not a wrong field name to fix, it's the whole
// response — Soundcharts just doesn't return that data from this endpoint
// on this plan. So photo_url and location (country only, no city) are
// real; bio, genre, and the platform URLs stay manual-entry fields, same
// as fields like top_song_url that never had a Soundcharts source to
// begin with. The lenient multi-key pick() below is left in place in case
// some other artist record does carry more — it costs nothing when absent
// — but don't expect it to fill in for most artists.

const BASE_URL = 'https://customer.api.soundcharts.com';

export function soundchartsConfigured(): boolean {
  return Boolean(process.env.SOUNDCHARTS_APP_ID && process.env.SOUNDCHARTS_API_KEY);
}

type SoundchartsResult<T> = { ok: true; data: T } | { ok: false; error: string };

async function soundchartsFetch(path: string): Promise<SoundchartsResult<any>> {
  const appId = process.env.SOUNDCHARTS_APP_ID;
  const apiKey = process.env.SOUNDCHARTS_API_KEY;
  if (!appId || !apiKey) return { ok: false, error: 'Soundcharts is not configured on this server.' };

  let res: Response;
  try {
    res = await fetch(`${BASE_URL}${path}`, {
      headers: { 'x-app-id': appId, 'x-api-key': apiKey },
      cache: 'no-store',
    });
  } catch (err: any) {
    return { ok: false, error: `Could not reach Soundcharts: ${err?.message ?? 'network error'}` };
  }

  if (res.status === 401 || res.status === 403) {
    const body = await res.text().catch(() => '');
    return {
      ok: false,
      error: `Soundcharts returned ${res.status} — check SOUNDCHARTS_APP_ID/SOUNDCHARTS_API_KEY and that this server's outbound network allows customer.api.soundcharts.com. Response: ${body.slice(0, 200)}`,
    };
  }
  if (res.status === 404) {
    return { ok: false, error: 'not found' };
  }
  if (res.status === 429) {
    return { ok: false, error: 'Soundcharts rate limit hit — try again shortly.' };
  }
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    return { ok: false, error: `Soundcharts returned ${res.status}: ${body.slice(0, 300)}` };
  }

  try {
    return { ok: true, data: await res.json() };
  } catch {
    return { ok: false, error: 'Soundcharts returned a response that was not valid JSON.' };
  }
}

const pick = (obj: any, ...keys: string[]) => {
  for (const k of keys) {
    if (obj?.[k] != null && obj[k] !== '') return obj[k];
  }
  return undefined;
};

export type SoundchartsSearchHit = {
  uuid: string;
  name: string;
  imageUrl?: string;
  appUrl?: string;
};

export async function searchArtists(term: string): Promise<SoundchartsResult<SoundchartsSearchHit[]>> {
  const trimmed = term.trim();
  if (trimmed.length < 2) return { ok: true, data: [] };

  const result = await soundchartsFetch(`/api/v2/artist/search/${encodeURIComponent(trimmed)}`);
  if (!result.ok) return result;

  const items = pick(result.data, 'items') ?? [];
  if (!Array.isArray(items)) return { ok: false, error: 'Unexpected search response shape from Soundcharts.' };

  const hits: SoundchartsSearchHit[] = items
    .map((item: any) => ({
      uuid: pick(item, 'uuid', 'id'),
      name: pick(item, 'name'),
      imageUrl: pick(item, 'imageUrl', 'image_url', 'picture'),
      appUrl: pick(item, 'appUrl', 'app_url'),
    }))
    .filter((h: SoundchartsSearchHit) => h.uuid && h.name);

  return { ok: true, data: hits };
}

export type SoundchartsArtistData = {
  name?: string;
  photo_url?: string;
  bio?: string;
  genre?: string;
  location?: string;
  followers_count?: number;
  monthly_listeners?: number;
  growth_velocity_pct?: number;
  engagement_rate_pct?: number;
  spotify_url?: string;
  instagram_url?: string;
  tiktok_url?: string;
  youtube_url?: string;
};

// Merges the metadata endpoint (name/genre/bio/photo/country) with a
// best-effort pull of the artist's audience endpoint (follower counts,
// growth). The audience call is allowed to fail independently — metadata
// alone is still useful to fill in.
export async function getArtistData(uuid: string): Promise<SoundchartsResult<SoundchartsArtistData>> {
  const metaResult = await soundchartsFetch(`/api/v2/artist/${encodeURIComponent(uuid)}`);
  if (!metaResult.ok) return metaResult;

  const meta = pick(metaResult.data, 'object', 'artist') ?? metaResult.data;

  const genres = pick(meta, 'genres');
  const genre = Array.isArray(genres) && genres.length > 0
    ? (typeof genres[0] === 'string' ? genres[0] : pick(genres[0], 'name', 'root'))
    : pick(meta, 'genre');

  const city = pick(meta, 'city');
  const country = pick(meta, 'countryCode', 'country_code', 'country');
  const location = [city, country].filter(Boolean).join(', ') || undefined;

  const platforms = pick(meta, 'platformIdentifiers', 'identifiers') ?? [];
  const platformUrl = (platform: string) =>
    Array.isArray(platforms)
      ? pick(
          platforms.find((p: any) => (pick(p, 'platform', 'platformCode') ?? '').toLowerCase() === platform),
          'url',
          'appUrl'
        )
      : undefined;

  const data: SoundchartsArtistData = {
    name: pick(meta, 'name'),
    photo_url: pick(meta, 'imageUrl', 'image_url', 'picture'),
    bio: pick(meta, 'biography', 'bio'),
    genre,
    location,
    spotify_url: platformUrl('spotify'),
    instagram_url: platformUrl('instagram'),
    tiktok_url: platformUrl('tiktok'),
    youtube_url: platformUrl('youtube'),
  };

  // Confirmed against a real response (see git history): this endpoint
  // returns Spotify FOLLOWER counts over time (field: followerCount), not
  // "monthly listeners" — Spotify doesn't expose monthly listeners through
  // any public API, only follower-style counts. items[] is chronological
  // ascending, so the last entry is the most recent.
  const audience = await soundchartsFetch(`/api/v2/artist/${encodeURIComponent(uuid)}/audience/spotify`);
  if (audience.ok) {
    const items = pick(audience.data, 'items') ?? [];
    const latest = Array.isArray(items) && items.length > 0 ? items[items.length - 1] : undefined;
    const earliest = Array.isArray(items) && items.length > 0 ? items[0] : undefined;
    if (latest) {
      const latestValue = pick(latest, 'followerCount');
      const earliestValue = earliest ? pick(earliest, 'followerCount') : undefined;
      if (typeof latestValue === 'number') data.followers_count = Math.round(latestValue);
      if (typeof latestValue === 'number' && typeof earliestValue === 'number' && earliestValue > 0) {
        data.growth_velocity_pct = Math.round(((latestValue - earliestValue) / earliestValue) * 1000) / 10;
      }
    }
  }

  return { ok: true, data };
}
