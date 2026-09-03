// Free, keyless Wikidata client — no SOUNDCHARTS_APP_ID-style credential
// exists or is needed here, and none should ever be added (zero-cost
// pre-beta constraint). Two calls only: wbsearchentities (fuzzy name
// search) and wbgetentities (fetch a specific QID's claims). Both are
// public, unauthenticated, and rate-limit generously for this app's
// per-artist, Scout-triggered usage (never a bulk background crawl).
//
// This never writes to the database and never decides an artist's actual
// genre/location/website — it only fetches and shapes what Wikidata says.
// The caller (app/api/wikidata/lookup/[id]/route.ts, components/
// WikidataLookup.tsx) is what makes it a "Scout reviews and Saves" flow,
// same as SoundchartsSearch: absence of a match is a normal, expected
// outcome for a small/undiscovered artist, never an error.

const API_URL = 'https://www.wikidata.org/w/api.php';

type WikidataResult<T> = { ok: true; data: T } | { ok: false; error: string };

async function wikidataFetch(params: Record<string, string>): Promise<WikidataResult<any>> {
  const url = `${API_URL}?${new URLSearchParams({ format: 'json', origin: '*', ...params }).toString()}`;
  let res: Response;
  try {
    // Wikidata asks anonymous API consumers to identify themselves with a
    // real User-Agent — see https://foundation.wikimedia.org/wiki/Policy:User-Agent_policy.
    res = await fetch(url, { headers: { 'User-Agent': 'SendAShot-Scout/1.0 (internal artist-discovery tool)' }, cache: 'no-store' });
  } catch (err: any) {
    return { ok: false, error: `Could not reach Wikidata: ${err?.message ?? 'network error'}` };
  }
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    return { ok: false, error: `Wikidata returned ${res.status}: ${body.slice(0, 300)}` };
  }
  try {
    return { ok: true, data: await res.json() };
  } catch {
    return { ok: false, error: 'Wikidata returned a response that was not valid JSON.' };
  }
}

export type WikidataSearchHit = { qid: string; label: string; description?: string };

export async function searchWikidataEntities(name: string): Promise<WikidataResult<WikidataSearchHit[]>> {
  const trimmed = name.trim();
  if (trimmed.length < 2) return { ok: true, data: [] };

  const result = await wikidataFetch({ action: 'wbsearchentities', search: trimmed, language: 'en', type: 'item', limit: '10' });
  if (!result.ok) return result;

  const hits = (result.data.search ?? []) as any[];
  return { ok: true, data: hits.map((h) => ({ qid: h.id, label: h.label, description: h.description })) };
}

// Occupations (P106) that count as "this human is a musician" — deliberately
// broad (singer, rapper, composer, songwriter, DJ, record producer) since
// Wikidata models these as distinct items, not one canonical "musician"
// value, and a real artist's page often only lists one or two of them.
const MUSICIAN_OCCUPATION_QIDS = new Set([
  'Q639669', // musician
  'Q177220', // singer
  'Q36834', // composer
  'Q753110', // songwriter
  'Q855091', // record producer
  'Q2252262', // rapper
  'Q158852', // conductor (bands/ensembles)
  'Q13590141', // singer-songwriter
  'Q488205', // singer-songwriter (dup label, distinct QID seen in the wild)
  'Q1259917', // musical artist (Wikidata's own general item, used inconsistently but real)
]);
const MUSICAL_GROUP_QIDS = new Set([
  'Q215380', // musical group
  'Q2088357', // musical ensemble
]);
const HUMAN_QID = 'Q5';

function claimValueIds(claims: any, property: string): string[] {
  const statements = claims?.[property] ?? [];
  return statements
    .map((s: any) => s?.mainsnak?.datavalue?.value?.id)
    .filter((id: unknown): id is string => typeof id === 'string');
}

function claimStringValues(claims: any, property: string): string[] {
  const statements = claims?.[property] ?? [];
  return statements
    .map((s: any) => s?.mainsnak?.datavalue?.value)
    .filter((v: unknown): v is string => typeof v === 'string');
}

// Confirms an entity is actually a musical act before treating a name match
// as real — Wikidata is full of same-named non-musicians (P31=human doesn't
// tell you what someone does; P106 does), and a solo artist's group
// affiliation would otherwise never be excluded from view but this at
// least stops an obviously wrong match (a same-named athlete, a place, a
// company) from silently filling in an artist's genre/country.
export function looksLikeMusicalEntity(claims: any): boolean {
  const instanceOf = claimValueIds(claims, 'P31');
  if (instanceOf.some((id) => MUSICAL_GROUP_QIDS.has(id))) return true;
  if (!instanceOf.includes(HUMAN_QID)) return false;
  const occupations = claimValueIds(claims, 'P106');
  return occupations.some((id) => MUSICIAN_OCCUPATION_QIDS.has(id));
}

export type WikidataArtistData = {
  qid: string;
  genreQids: string[];
  countryQid?: string;
  website?: string;
  musicbrainzId?: string;
};

// Fetches one entity's claims and pulls out the fields NEXT cares about:
// P136 genre(s), P495/P27 country (group's country of origin, falling back
// to a solo artist's country of citizenship), P856 official website, P434
// MusicBrainz artist ID (a stable, free, well-known identifier — useful for
// a Scout cross-referencing, costs nothing to carry along). Genre/country
// come back as QIDs, not labels — resolveEntityLabels() below turns those
// into display text, kept as a separate call since not every caller needs it
// (e.g. a match-confirmation check only needs claims, not labels).
export async function getWikidataEntityClaims(qid: string): Promise<WikidataResult<any>> {
  const result = await wikidataFetch({ action: 'wbgetentities', ids: qid, props: 'claims' });
  if (!result.ok) return result;
  const entity = result.data.entities?.[qid];
  if (!entity || entity.missing !== undefined) return { ok: false, error: 'not found' };
  return { ok: true, data: entity.claims ?? {} };
}

export function extractWikidataArtistData(qid: string, claims: any): WikidataArtistData {
  const genreQids = claimValueIds(claims, 'P136');
  const countryQid = claimValueIds(claims, 'P495')[0] ?? claimValueIds(claims, 'P27')[0];
  const website = claimStringValues(claims, 'P856')[0];
  const musicbrainzId = claimStringValues(claims, 'P434')[0];
  return { qid, genreQids, countryQid, website, musicbrainzId };
}

// Batches every QID that needs a human-readable label (genres + country) into
// one call — wbgetentities accepts up to 50 ids per request, and this app
// never needs anywhere near that many at once per artist.
export async function resolveEntityLabels(qids: string[]): Promise<WikidataResult<Record<string, string>>> {
  const unique = [...new Set(qids)].filter(Boolean);
  if (unique.length === 0) return { ok: true, data: {} };

  const result = await wikidataFetch({ action: 'wbgetentities', ids: unique.join('|'), props: 'labels', languages: 'en' });
  if (!result.ok) return result;

  const labels: Record<string, string> = {};
  for (const qid of unique) {
    const label = result.data.entities?.[qid]?.labels?.en?.value;
    if (label) labels[qid] = label;
  }
  return { ok: true, data: labels };
}

export type WikidataMatch = {
  qid: string;
  label: string;
  genre?: string; // first genre, joined if multiple: "Pop, R&B"
  country?: string;
  website?: string;
  musicbrainzId?: string;
};

// The single convenience entry point the lookup route calls: search by
// name, confirm the best-scoring hit is actually a musical act (not just a
// same-named non-musician), fetch + resolve its data. Returns ok:true with
// data:null (not an error) when nothing confident was found — that's the
// normal, expected outcome for a small or unknown artist, same as
// soundcharts_no_match_at/youtube_no_match_at elsewhere in this app.
export async function findWikidataMatch(name: string): Promise<WikidataResult<WikidataMatch | null>> {
  const searchResult = await searchWikidataEntities(name);
  if (!searchResult.ok) return searchResult;

  const normalizedTarget = name.trim().toLowerCase();
  // Prefer an exact (case-insensitive) label match over Wikidata's own
  // relevance ordering — "Drake" the rapper should win over "Drake" the
  // 1585 English galleon if both come back, and an exact label match is a
  // much stronger signal than search rank alone.
  const ordered = [...searchResult.data].sort((a, b) => {
    const aExact = a.label.toLowerCase() === normalizedTarget ? 0 : 1;
    const bExact = b.label.toLowerCase() === normalizedTarget ? 0 : 1;
    return aExact - bExact;
  });

  for (const hit of ordered) {
    const claimsResult = await getWikidataEntityClaims(hit.qid);
    if (!claimsResult.ok) continue;
    if (!looksLikeMusicalEntity(claimsResult.data)) continue;

    const raw = extractWikidataArtistData(hit.qid, claimsResult.data);
    const labelsResult = await resolveEntityLabels([...raw.genreQids, raw.countryQid].filter((x): x is string => Boolean(x)));
    const labels = labelsResult.ok ? labelsResult.data : {};

    return {
      ok: true,
      data: {
        qid: hit.qid,
        label: hit.label,
        genre: raw.genreQids.map((q) => labels[q]).filter(Boolean).join(', ') || undefined,
        country: raw.countryQid ? labels[raw.countryQid] : undefined,
        website: raw.website,
        musicbrainzId: raw.musicbrainzId,
      },
    };
  }
  return { ok: true, data: null };
}
