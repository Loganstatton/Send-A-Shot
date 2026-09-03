'use client';
import { useState } from 'react';
import { ArtistInput } from '@/lib/types';

type Match = { qid: string; label: string; genre?: string; country?: string; website?: string; musicbrainzId?: string };

// Free, keyless Wikidata enrichment — same "search, review, Scout decides
// whether to fill the form" shape as SoundchartsSearch, just simpler
// (findWikidataMatch already does search+confirm+resolve in one call, so
// there's no candidate dropdown — one best match, or none). Nothing here
// is ever auto-applied: a match just populates a preview card with an
// explicit "Fill in" button per field group, same "never silently
// overwrite" rule as Soundcharts. Absence of a match is shown as a plain
// fact, not an error — most artists this small genuinely have no Wikidata
// entry yet.
export default function WikidataLookup({ artistId, onFill }: { artistId: number; onFill: (data: Partial<ArtistInput>) => void }) {
  const [loading, setLoading] = useState(false);
  const [checked, setChecked] = useState(false);
  const [match, setMatch] = useState<Match | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [filled, setFilled] = useState(false);

  async function lookup() {
    setLoading(true);
    setError(null);
    setFilled(false);
    try {
      const res = await fetch(`/api/wikidata/lookup/${artistId}`);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? 'Lookup failed');
      setMatch(data.match);
      setChecked(true);
    } catch (err: any) {
      setError(err.message ?? 'Wikidata lookup failed');
    } finally {
      setLoading(false);
    }
  }

  function fill() {
    if (!match) return;
    const fields: Partial<ArtistInput> = {};
    if (match.genre) fields.genre = match.genre;
    if (match.country) fields.location = match.country;
    if (match.website) fields.website_url = match.website;
    onFill(fields);
    setFilled(true);
  }

  return (
    <div className="card space-y-3">
      <h2 className="font-bold text-lg">Wikidata</h2>
      <p className="text-xs" style={{ color: 'var(--text-faint)' }}>
        Free, keyless enrichment — genre, country, and official website, when Wikidata has an entry for this artist.
        Never overwrites anything by itself; review the match, then Fill in and Save.
      </p>
      <button type="button" className="btn text-sm" disabled={loading} onClick={lookup}>
        {loading ? 'Looking up…' : checked ? '🔄 Look up again' : '🔎 Look up on Wikidata'}
      </button>
      {error && <p className="text-xs" style={{ color: 'var(--down)' }}>{error}</p>}
      {checked && !match && !error && (
        <p className="text-xs" style={{ color: 'var(--text-faint)' }}>No confident Wikidata match found — normal for a smaller or newer artist.</p>
      )}
      {match && (
        <div className="rounded-lg p-3 space-y-2" style={{ border: '1px solid var(--border-soft)', background: 'var(--bg-2)' }}>
          <p className="text-sm font-semibold">{match.label}</p>
          <div className="text-xs space-y-0.5" style={{ color: 'var(--text-muted)' }}>
            {match.genre && <p>Genre: {match.genre}</p>}
            {match.country && <p>Country: {match.country}</p>}
            {match.website && <p>Website: {match.website}</p>}
            {match.musicbrainzId && <p>MusicBrainz ID: {match.musicbrainzId}</p>}
            {!match.genre && !match.country && !match.website && <p>No genre/country/website on this entry.</p>}
          </div>
          <button type="button" className="btn text-sm" onClick={fill} disabled={!match.genre && !match.country && !match.website}>
            Fill in
          </button>
          {filled && <span className="text-xs ml-2" style={{ color: 'var(--up)' }}>Filled — remember to Save.</span>}
        </div>
      )}
    </div>
  );
}
