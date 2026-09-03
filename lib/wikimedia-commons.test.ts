import { afterEach, describe, expect, it, vi } from 'vitest';
import { findCommonsImagesForArtist, isPermissiveLicense, searchCommonsImages } from './wikimedia-commons';

function mockFetchSequence(responses: unknown[]) {
  let call = 0;
  global.fetch = vi.fn(async () => {
    const json = responses[Math.min(call, responses.length - 1)];
    call++;
    return { ok: true, status: 200, json: async () => json, text: async () => JSON.stringify(json) } as any;
  });
}

function page(overrides: Partial<{ title: string; url: string; descriptionurl: string; licenseShortName: string; artist: string; licenseUrl: string }> = {}) {
  return {
    title: overrides.title ?? 'File:Example Artist 2024.jpg',
    imageinfo: [
      {
        url: overrides.url ?? 'https://upload.wikimedia.org/example.jpg',
        descriptionurl: overrides.descriptionurl ?? 'https://commons.wikimedia.org/wiki/File:Example_Artist_2024.jpg',
        thumburl: 'https://upload.wikimedia.org/thumb/example.jpg',
        width: 1200,
        height: 800,
        extmetadata: {
          LicenseShortName: { value: overrides.licenseShortName ?? 'CC BY-SA 4.0' },
          LicenseUrl: { value: overrides.licenseUrl ?? 'https://creativecommons.org/licenses/by-sa/4.0' },
          Artist: { value: overrides.artist ?? 'Jane Photographer' },
        },
      },
    ],
  };
}

describe('isPermissiveLicense', () => {
  it('accepts CC0, public domain, and CC BY / BY-SA variants', () => {
    expect(isPermissiveLicense('CC0')).toBe(true);
    expect(isPermissiveLicense('Public domain')).toBe(true);
    expect(isPermissiveLicense('CC BY 4.0')).toBe(true);
    expect(isPermissiveLicense('CC BY-SA 4.0')).toBe(true);
    expect(isPermissiveLicense('cc-by-sa-3.0')).toBe(true);
  });

  it('rejects non-commercial, no-derivatives, and all-rights-reserved licenses', () => {
    expect(isPermissiveLicense('CC BY-NC 4.0')).toBe(false);
    expect(isPermissiveLicense('CC BY-ND 4.0')).toBe(false);
    expect(isPermissiveLicense('All rights reserved')).toBe(false);
  });

  it('rejects a missing or empty license — unclear means unusable, not a default yes', () => {
    expect(isPermissiveLicense(undefined)).toBe(false);
    expect(isPermissiveLicense('')).toBe(false);
  });
});

describe('searchCommonsImages', () => {
  afterEach(() => vi.restoreAllMocks());

  it('returns a permissively-licensed image with attribution built from the Artist field', async () => {
    mockFetchSequence([{ query: { pages: { '1': page() } } }]);
    const result = await searchCommonsImages('Example Artist');
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data).toHaveLength(1);
      expect(result.data[0].license).toBe('CC BY-SA 4.0');
      expect(result.data[0].pageUrl).toBe('https://commons.wikimedia.org/wiki/File:Example_Artist_2024.jpg');
      expect(result.data[0].attribution).toContain('Jane Photographer');
      expect(result.data[0].attribution).toContain('CC BY-SA 4.0');
    }
  });

  it('filters out a non-commercial-licensed image entirely rather than returning it with a warning', async () => {
    mockFetchSequence([{ query: { pages: { '1': page({ licenseShortName: 'CC BY-NC 4.0' }) } } }]);
    const result = await searchCommonsImages('Example Artist');
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.data).toEqual([]);
  });

  it('filters out an image with no license metadata at all', async () => {
    const noLicensePage = page();
    delete (noLicensePage.imageinfo[0].extmetadata as any).LicenseShortName;
    mockFetchSequence([{ query: { pages: { '1': noLicensePage } } }]);
    const result = await searchCommonsImages('Example Artist');
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.data).toEqual([]);
  });

  it('falls back to the Credit field for attribution when Artist is absent', async () => {
    const p = page({ artist: '' });
    delete (p.imageinfo[0].extmetadata as any).Artist;
    (p.imageinfo[0].extmetadata as any).Credit = { value: 'Example Press Kit' };
    mockFetchSequence([{ query: { pages: { '1': p } } }]);
    const result = await searchCommonsImages('Example Artist');
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.data[0].attribution).toContain('Example Press Kit');
  });

  it('returns no results, not an error, when nothing is found — expected for most small artists', async () => {
    mockFetchSequence([{ query: { pages: {} } }]);
    const result = await searchCommonsImages('A Genuinely Unknown Artist');
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.data).toEqual([]);
  });

  it('short-circuits a too-short query without a network call', async () => {
    const fetchSpy = vi.fn();
    global.fetch = fetchSpy;
    const result = await searchCommonsImages('a');
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.data).toEqual([]);
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});

describe('findCommonsImagesForArtist', () => {
  afterEach(() => vi.restoreAllMocks());

  it('prefers depicts-tagged results (haswbstatement) when a Wikidata QID is given and something is found', async () => {
    mockFetchSequence([{ query: { pages: { '1': page({ title: 'File:Depicts Match.jpg' }) } } }]);
    const result = await findCommonsImagesForArtist('Example Artist', 'Q76');
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data).toHaveLength(1);
      expect(result.data[0].title).toBe('File:Depicts Match.jpg');
    }
    expect(global.fetch).toHaveBeenCalledTimes(1);
    expect((global.fetch as any).mock.calls[0][0]).toContain('haswbstatement');
  });

  it('falls back to a plain name search when the depicts-tagged query finds nothing', async () => {
    mockFetchSequence([{ query: { pages: {} } }, { query: { pages: { '1': page({ title: 'File:Plain Search Match.jpg' }) } } }]);
    const result = await findCommonsImagesForArtist('Example Artist', 'Q76');
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data).toHaveLength(1);
      expect(result.data[0].title).toBe('File:Plain Search Match.jpg');
    }
    expect(global.fetch).toHaveBeenCalledTimes(2);
  });

  it('goes straight to a plain name search when no Wikidata QID is available at all', async () => {
    mockFetchSequence([{ query: { pages: { '1': page() } } }]);
    const result = await findCommonsImagesForArtist('Example Artist');
    expect(result.ok).toBe(true);
    expect(global.fetch).toHaveBeenCalledTimes(1);
    expect((global.fetch as any).mock.calls[0][0]).not.toContain('haswbstatement');
  });
});
