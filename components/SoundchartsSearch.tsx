'use client';
import { useEffect, useRef, useState } from 'react';
import { ArtistInput } from '@/lib/types';

type Hit = { uuid: string; name: string; imageUrl?: string; appUrl?: string };

// Search Soundcharts by name and auto-fill the artist form from a pick, or
// (once linked) re-sync the same artist's stats with one click. Fields that
// come back empty from Soundcharts are left alone — this never blanks out
// something a Scout already typed in by hand.
export default function SoundchartsSearch({
  soundchartsUuid,
  onFill,
}: {
  soundchartsUuid?: string;
  onFill: (data: Partial<ArtistInput>) => void;
}) {
  const [query, setQuery] = useState('');
  const [hits, setHits] = useState<Hit[]>([]);
  const [open, setOpen] = useState(false);
  const [searching, setSearching] = useState(false);
  const [filling, setFilling] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout>>();

  useEffect(() => {
    if (query.trim().length < 2) {
      setHits([]);
      setOpen(false);
      return;
    }
    clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(async () => {
      setSearching(true);
      setError(null);
      try {
        const res = await fetch(`/api/soundcharts/search?q=${encodeURIComponent(query)}`);
        const data = await res.json();
        if (!res.ok) throw new Error(data.error ?? 'Search failed');
        setHits(data);
        setOpen(true);
      } catch (err: any) {
        setError(err.message ?? 'Search failed');
        setHits([]);
      } finally {
        setSearching(false);
      }
    }, 300);
    return () => clearTimeout(debounceRef.current);
  }, [query]);

  async function fill(uuid: string, label: string) {
    setFilling(true);
    setError(null);
    setStatus(null);
    setOpen(false);
    try {
      const res = await fetch(`/api/soundcharts/artist/${encodeURIComponent(uuid)}`);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? 'Fetch failed');
      const { soundcharts_uuid, ...fields } = data;
      // Only carry over fields Soundcharts actually returned a value for.
      const nonEmpty = Object.fromEntries(Object.entries(fields).filter(([, v]) => v != null && v !== ''));
      onFill({ ...nonEmpty, soundcharts_uuid });
      setStatus(`Filled from Soundcharts (${label}).`);
      setQuery('');
    } catch (err: any) {
      setError(err.message ?? 'Could not fetch Soundcharts data');
    } finally {
      setFilling(false);
    }
  }

  return (
    <div className="card space-y-3">
      <h2 className="font-semibold text-lg">Soundcharts</h2>
      {soundchartsUuid ? (
        <div className="flex items-center gap-3 flex-wrap">
          <span className="badge text-xs">🔗 Linked</span>
          <button
            type="button"
            className="btn text-sm"
            disabled={filling}
            onClick={() => fill(soundchartsUuid, 'synced')}
          >
            {filling ? 'Syncing…' : '🔄 Sync from Soundcharts'}
          </button>
        </div>
      ) : (
        <div className="relative">
          <input
            className="input"
            placeholder="Search Soundcharts by artist name…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onFocus={() => hits.length > 0 && setOpen(true)}
          />
          {open && (
            <div className="absolute z-10 mt-1 w-full max-h-72 overflow-y-auto rounded-lg border border-neutral-700 bg-neutral-900 shadow-lg">
              {hits.length === 0 && !searching && (
                <p className="text-sm text-neutral-500 p-3">No matches.</p>
              )}
              {hits.map((hit) => (
                <button
                  key={hit.uuid}
                  type="button"
                  className="w-full flex items-center gap-3 p-2 hover:bg-white/5 text-left"
                  onClick={() => fill(hit.uuid, hit.name)}
                  disabled={filling}
                >
                  {hit.imageUrl ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={hit.imageUrl} alt="" className="w-8 h-8 rounded-full object-cover bg-neutral-800" />
                  ) : (
                    <div className="w-8 h-8 rounded-full bg-neutral-800 border border-neutral-700" />
                  )}
                  <span className="text-sm">{hit.name}</span>
                </button>
              ))}
            </div>
          )}
        </div>
      )}
      {searching && <p className="text-xs text-neutral-500">Searching…</p>}
      {status && <p className="text-xs text-emerald-400">{status}</p>}
      {error && <p className="text-xs text-red-300">{error}</p>}
      <p className="text-xs text-neutral-500">
        Fills in photo, bio, genre, location, and platform stats — never overwrites the Breakout Score
        inputs, which are your own rating. Fields Soundcharts doesn&apos;t return are left untouched.
      </p>
    </div>
  );
}
