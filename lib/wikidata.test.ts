import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  extractWikidataArtistData, findWikidataMatch, looksLikeMusicalEntity, resolveEntityLabels, searchWikidataEntities,
} from './wikidata';

function mockFetchSequence(responses: unknown[]) {
  let call = 0;
  global.fetch = vi.fn(async () => {
    const json = responses[Math.min(call, responses.length - 1)];
    call++;
    return { ok: true, status: 200, json: async () => json, text: async () => JSON.stringify(json) } as any;
  });
}

describe('looksLikeMusicalEntity', () => {
  it('accepts a human with a musician-ish occupation (P106)', () => {
    const claims = { P31: [{ mainsnak: { datavalue: { value: { id: 'Q5' } } } }], P106: [{ mainsnak: { datavalue: { value: { id: 'Q177220' } } } }] };
    expect(looksLikeMusicalEntity(claims)).toBe(true);
  });

  it('accepts a musical group directly, no occupation check needed', () => {
    const claims = { P31: [{ mainsnak: { datavalue: { value: { id: 'Q215380' } } } }] };
    expect(looksLikeMusicalEntity(claims)).toBe(true);
  });

  it('rejects a human whose occupation is not musical — a same-named non-musician', () => {
    const claims = { P31: [{ mainsnak: { datavalue: { value: { id: 'Q5' } } } }], P106: [{ mainsnak: { datavalue: { value: { id: 'Q82955' } } } }] }; // Q82955 = politician
    expect(looksLikeMusicalEntity(claims)).toBe(false);
  });

  it('rejects a non-human, non-group entity entirely (e.g. a place, a ship)', () => {
    const claims = { P31: [{ mainsnak: { datavalue: { value: { id: 'Q515' } } } }] }; // Q515 = city
    expect(looksLikeMusicalEntity(claims)).toBe(false);
  });

  it('handles a human with no P106 claim at all rather than throwing', () => {
    const claims = { P31: [{ mainsnak: { datavalue: { value: { id: 'Q5' } } } }] };
    expect(looksLikeMusicalEntity(claims)).toBe(false);
  });
});

describe('extractWikidataArtistData', () => {
  it('pulls genre QIDs, prefers P495 (country of origin) over P27 (citizenship) for a group', () => {
    const claims = {
      P136: [{ mainsnak: { datavalue: { value: { id: 'Q11401' } } } }, { mainsnak: { datavalue: { value: { id: 'Q37073' } } } }],
      P495: [{ mainsnak: { datavalue: { value: { id: 'Q30' } } } }],
      P27: [{ mainsnak: { datavalue: { value: { id: 'Q145' } } } }],
      P856: [{ mainsnak: { datavalue: { value: 'https://example-artist.com' } } }],
      P434: [{ mainsnak: { datavalue: { value: 'abc-123-def' } } }],
    };
    const data = extractWikidataArtistData('Q999', claims);
    expect(data.genreQids).toEqual(['Q11401', 'Q37073']);
    expect(data.countryQid).toBe('Q30');
    expect(data.website).toBe('https://example-artist.com');
    expect(data.musicbrainzId).toBe('abc-123-def');
  });

  it('falls back to P27 when P495 is absent (a solo artist has no "country of origin" claim)', () => {
    const claims = { P27: [{ mainsnak: { datavalue: { value: { id: 'Q145' } } } }] };
    expect(extractWikidataArtistData('Q1', claims).countryQid).toBe('Q145');
  });

  it('leaves every field undefined/empty on a bare entity with no relevant claims — absence is valid, not an error', () => {
    const data = extractWikidataArtistData('Q1', {});
    expect(data.genreQids).toEqual([]);
    expect(data.countryQid).toBeUndefined();
    expect(data.website).toBeUndefined();
    expect(data.musicbrainzId).toBeUndefined();
  });
});

describe('searchWikidataEntities', () => {
  afterEach(() => vi.restoreAllMocks());

  it('shapes wbsearchentities hits into {qid, label, description}', async () => {
    mockFetchSequence([{ search: [{ id: 'Q76', label: 'Test Artist', description: 'a musician' }] }]);
    const result = await searchWikidataEntities('Test Artist');
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.data).toEqual([{ qid: 'Q76', label: 'Test Artist', description: 'a musician' }]);
  });

  it('short-circuits a too-short query without a network call', async () => {
    const fetchSpy = vi.fn();
    global.fetch = fetchSpy;
    const result = await searchWikidataEntities('a');
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.data).toEqual([]);
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});

describe('resolveEntityLabels', () => {
  afterEach(() => vi.restoreAllMocks());

  it('batches multiple QIDs into one call and returns a qid->label map', async () => {
    mockFetchSequence([{ entities: { Q11401: { labels: { en: { value: 'Pop music' } } }, Q30: { labels: { en: { value: 'United States of America' } } } } }]);
    const result = await resolveEntityLabels(['Q11401', 'Q30']);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.data).toEqual({ Q11401: 'Pop music', Q30: 'United States of America' });
  });

  it('returns an empty map without a network call when given no qids', async () => {
    const fetchSpy = vi.fn();
    global.fetch = fetchSpy;
    const result = await resolveEntityLabels([]);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.data).toEqual({});
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});

describe('findWikidataMatch', () => {
  afterEach(() => vi.restoreAllMocks());

  it('finds an exact-label musician match and resolves its genre/country to display labels', async () => {
    mockFetchSequence([
      { search: [{ id: 'Q1', label: 'Some Other Q1', description: 'a place' }, { id: 'Q76', label: 'Test Artist', description: 'a musician' }] },
      // getWikidataEntityClaims for Q1 (checked first by search rank, not exact match) — actually exact match sorts first, so Q76 is checked first.
      { entities: { Q76: { claims: { P31: [{ mainsnak: { datavalue: { value: { id: 'Q5' } } } }], P106: [{ mainsnak: { datavalue: { value: { id: 'Q177220' } } } }], P136: [{ mainsnak: { datavalue: { value: { id: 'Q11401' } } } }], P27: [{ mainsnak: { datavalue: { value: { id: 'Q30' } } } }] } } } },
      { entities: { Q11401: { labels: { en: { value: 'Pop music' } } }, Q30: { labels: { en: { value: 'United States of America' } } } } },
    ]);
    const result = await findWikidataMatch('Test Artist');
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data?.qid).toBe('Q76');
      expect(result.data?.genre).toBe('Pop music');
      expect(result.data?.country).toBe('United States of America');
    }
  });

  it('skips a same-named non-musician and returns null (not an error) when nothing else matches', async () => {
    mockFetchSequence([
      { search: [{ id: 'Q1', label: 'Test Artist', description: 'a politician' }] },
      { entities: { Q1: { claims: { P31: [{ mainsnak: { datavalue: { value: { id: 'Q5' } } } }], P106: [{ mainsnak: { datavalue: { value: { id: 'Q82955' } } } }] } } } },
    ]);
    const result = await findWikidataMatch('Test Artist');
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.data).toBeNull();
  });

  it('returns null, not an error, when the search itself finds nothing — the expected outcome for a small artist', async () => {
    mockFetchSequence([{ search: [] }]);
    const result = await findWikidataMatch('A Genuinely Unknown Artist');
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.data).toBeNull();
  });
});
