// Free, keyless Wikimedia Commons client — same "no credential, never add
// one" status as lib/wikidata.ts. Searches Commons for images tagged
// against a Wikidata entity (or, as a fallback, by plain-text search) and
// returns ONLY images whose license is unambiguously open — CC0, public
// domain, or a Creative Commons license that permits reuse. Anything
// license-unclear (missing/unknown extmetadata, an all-rights-reserved
// tag, a non-free-use rationale) is filtered out here, not left for the
// caller to guess about — see PERMISSIVE_LICENSE_PATTERN below. This never
// scrapes Google Images or pulls a random Wikipedia infobox image; it only
// ever queries Commons' own API, which carries structured license metadata
// per file.

const API_URL = 'https://commons.wikimedia.org/w/api.php';

type CommonsResult<T> = { ok: true; data: T } | { ok: false; error: string };

async function commonsFetch(params: Record<string, string>): Promise<CommonsResult<any>> {
  const url = `${API_URL}?${new URLSearchParams({ format: 'json', origin: '*', ...params }).toString()}`;
  let res: Response;
  try {
    res = await fetch(url, { headers: { 'User-Agent': 'SendAShot-Scout/1.0 (internal artist-discovery tool)' }, cache: 'no-store' });
  } catch (err: any) {
    return { ok: false, error: `Could not reach Wikimedia Commons: ${err?.message ?? 'network error'}` };
  }
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    return { ok: false, error: `Wikimedia Commons returned ${res.status}: ${body.slice(0, 300)}` };
  }
  try {
    return { ok: true, data: await res.json() };
  } catch {
    return { ok: false, error: 'Wikimedia Commons returned a response that was not valid JSON.' };
  }
}

// Matches the license short-names Commons' extmetadata actually returns for
// an openly-reusable file: "CC0", "Public domain", or any "CC BY..." variant
// (BY, BY-SA — NOT the non-commercial/no-derivatives ones, which Commons
// itself is not supposed to host but occasionally does via old imports).
// Deliberately conservative: anything not matching this is treated as
// unclear and rejected, per the "if unclear, do NOT use the image" rule.
const PERMISSIVE_LICENSE_PATTERN = /^(cc0|public domain|cc[\s-]?by(?:[\s-]?sa)?)([\s-].*)?$/i;
const REJECTED_LICENSE_HINT_PATTERN = /nc|nd|non-?commercial|no-?derivs?|all rights reserved/i;

export function isPermissiveLicense(licenseShortName: string | undefined): boolean {
  if (!licenseShortName) return false;
  const trimmed = licenseShortName.trim();
  if (REJECTED_LICENSE_HINT_PATTERN.test(trimmed)) return false;
  return PERMISSIVE_LICENSE_PATTERN.test(trimmed);
}

export type CommonsCandidate = {
  title: string; // "File:Example Artist 2024.jpg"
  pageUrl: string; // the Commons file description page — required as photo_source_url
  imageUrl: string; // direct, hotlinkable image URL
  thumbUrl?: string; // a smaller rendition for a picker UI
  width?: number;
  height?: number;
  license: string; // short name, e.g. "CC BY-SA 4.0"
  licenseUrl?: string;
  attribution: string; // the text a Scout must keep visible if this image is used
};

function buildAttribution(artist: string | undefined, credit: string | undefined, licenseShortName: string): string {
  const creator = artist?.replace(/<[^>]+>/g, '').trim();
  const creditText = credit?.replace(/<[^>]+>/g, '').trim();
  const who = creator || creditText || 'Unknown author';
  return `${who}, via Wikimedia Commons (${licenseShortName})`;
}

// One page of Commons search results + full imageinfo/extmetadata in a
// single call (generator=search avoids a separate search-then-fetch
// round trip). Filters out anything whose license doesn't clearly permit
// reuse — never returns a candidate a Scout would have to double-check
// the license on themselves.
export async function searchCommonsImages(query: string, limit = 12): Promise<CommonsResult<CommonsCandidate[]>> {
  const trimmed = query.trim();
  if (trimmed.length < 2) return { ok: true, data: [] };

  const result = await commonsFetch({
    action: 'query',
    generator: 'search',
    gsrsearch: `${trimmed} filetype:bitmap`,
    gsrnamespace: '6', // File: namespace
    gsrlimit: String(limit),
    prop: 'imageinfo',
    iiprop: 'url|size|extmetadata',
    iiurlwidth: '400',
  });
  if (!result.ok) return result;

  const pages = Object.values(result.data.query?.pages ?? {}) as any[];
  const candidates: CommonsCandidate[] = [];
  for (const page of pages) {
    const info = page.imageinfo?.[0];
    if (!info) continue;
    const meta = info.extmetadata ?? {};
    const licenseShortName: string | undefined = meta.LicenseShortName?.value;
    if (!isPermissiveLicense(licenseShortName)) continue;

    candidates.push({
      title: page.title,
      pageUrl: info.descriptionurl,
      imageUrl: info.url,
      thumbUrl: info.thumburl,
      width: info.width,
      height: info.height,
      license: licenseShortName!,
      licenseUrl: meta.LicenseUrl?.value,
      attribution: buildAttribution(meta.Artist?.value, meta.Credit?.value, licenseShortName!),
    });
  }
  return { ok: true, data: candidates };
}

// Images specifically tagged on Commons as depicting a given Wikidata
// entity (P18 "image" claim resolved to the file that's actually linked,
// or files carrying a "depicts"/structured-data statement) are a much
// stronger signal than a plain-text search — a text search for a common
// name can turn up anything. Falls back to a plain search using the
// artist's own name when no depicts-tagged image exists, since most small
// artists' Commons presence (if any) won't be structured-data-tagged.
export async function findCommonsImagesForArtist(artistName: string, wikidataQid?: string): Promise<CommonsResult<CommonsCandidate[]>> {
  if (wikidataQid) {
    const depictsResult = await commonsFetch({
      action: 'query',
      generator: 'search',
      gsrsearch: `haswbstatement:P180=${wikidataQid}`,
      gsrnamespace: '6',
      gsrlimit: '12',
      prop: 'imageinfo',
      iiprop: 'url|size|extmetadata',
      iiurlwidth: '400',
    });
    if (depictsResult.ok) {
      const pages = Object.values(depictsResult.data.query?.pages ?? {}) as any[];
      if (pages.length > 0) {
        const candidates: CommonsCandidate[] = [];
        for (const page of pages) {
          const info = page.imageinfo?.[0];
          if (!info) continue;
          const meta = info.extmetadata ?? {};
          const licenseShortName: string | undefined = meta.LicenseShortName?.value;
          if (!isPermissiveLicense(licenseShortName)) continue;
          candidates.push({
            title: page.title, pageUrl: info.descriptionurl, imageUrl: info.url, thumbUrl: info.thumburl,
            width: info.width, height: info.height, license: licenseShortName!, licenseUrl: meta.LicenseUrl?.value,
            attribution: buildAttribution(meta.Artist?.value, meta.Credit?.value, licenseShortName!),
          });
        }
        if (candidates.length > 0) return { ok: true, data: candidates };
      }
    }
  }
  return searchCommonsImages(artistName);
}
