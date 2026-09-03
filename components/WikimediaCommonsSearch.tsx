'use client';
import { useState } from 'react';
import { ArtistInput, SourceType } from '@/lib/types';

const WIKIMEDIA_COMMONS: SourceType = 'WIKIMEDIA_COMMONS';

type Candidate = {
  title: string; pageUrl: string; imageUrl: string; thumbUrl?: string;
  license: string; licenseUrl?: string; attribution: string;
};

// Free, keyless image search — every candidate returned already passed
// lib/wikimedia-commons.ts's license filter (CC0/public domain/CC BY[-SA]
// only; anything unclear or non-commercial/no-derivatives is excluded
// server-side, never shown here for a Scout to accidentally pick). Picking
// one fills photo_url PLUS the full attribution/license/source-url set
// into the form in one step — same "Scout reviews, form fills, Save is
// still required" shape as SoundchartsSearch/WikidataLookup. Nothing is
// written to the database until the form is actually saved.
export default function WikimediaCommonsSearch({ artistId, onFill }: { artistId: number; onFill: (data: Partial<ArtistInput>) => void }) {
  const [loading, setLoading] = useState(false);
  const [searched, setSearched] = useState(false);
  const [candidates, setCandidates] = useState<Candidate[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [pickedTitle, setPickedTitle] = useState<string | null>(null);

  async function search() {
    setLoading(true);
    setError(null);
    setPickedTitle(null);
    try {
      const res = await fetch(`/api/wikimedia-commons/search/${artistId}`);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? 'Search failed');
      setCandidates(data);
      setSearched(true);
    } catch (err: any) {
      setError(err.message ?? 'Wikimedia Commons search failed');
    } finally {
      setLoading(false);
    }
  }

  function pick(c: Candidate) {
    onFill({
      photo_url: c.imageUrl,
      photo_source_type: WIKIMEDIA_COMMONS,
      photo_source_url: c.pageUrl,
      photo_attribution: c.attribution,
      photo_license: c.license,
      photo_license_url: c.licenseUrl,
    });
    setPickedTitle(c.title);
  }

  return (
    <div className="card space-y-3">
      <h2 className="font-bold text-lg">Wikimedia Commons photo</h2>
      <p className="text-xs" style={{ color: 'var(--text-faint)' }}>
        Free, license-clear images only — every result here already passed a CC0/public-domain/CC-BY(-SA) check.
        Picking one fills the photo plus its required attribution; nothing saves until you hit Save below.
      </p>
      <button type="button" className="btn text-sm" disabled={loading} onClick={search}>
        {loading ? 'Searching…' : searched ? '🔄 Search again' : '🖼️ Search Wikimedia Commons'}
      </button>
      {error && <p className="text-xs" style={{ color: 'var(--down)' }}>{error}</p>}
      {searched && candidates.length === 0 && !error && (
        <p className="text-xs" style={{ color: 'var(--text-faint)' }}>No license-clear images found — normal for a smaller or newer artist.</p>
      )}
      {candidates.length > 0 && (
        <div className="grid grid-cols-3 sm:grid-cols-4 gap-2">
          {candidates.map((c) => (
            <button
              key={c.title}
              type="button"
              onClick={() => pick(c)}
              className="rounded-lg overflow-hidden text-left"
              style={{ border: pickedTitle === c.title ? '2px solid var(--up)' : '1px solid var(--border-soft)' }}
              title={`${c.title} — ${c.license}`}
            >
              {/* eslint-disable-next-line @next/next/no-img-element -- external Commons thumbnail URL, not a next/image candidate. */}
              <img src={c.thumbUrl ?? c.imageUrl} alt="" loading="lazy" className="w-full h-24 object-cover" style={{ background: 'var(--surface-2)' }} />
              <div className="px-1.5 py-1 text-[10px] truncate" style={{ color: 'var(--text-faint)' }}>{c.license}</div>
            </button>
          ))}
        </div>
      )}
      {pickedTitle && <p className="text-xs" style={{ color: 'var(--up)' }}>Filled from &ldquo;{pickedTitle}&rdquo; — remember to Save.</p>}
    </div>
  );
}
