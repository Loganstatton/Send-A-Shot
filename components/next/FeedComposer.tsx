'use client';
import { useEffect, useRef, useState } from 'react';
import { heroGradient } from '@/components/next/heroGradient';

type ArtistHit = { id: number; name: string; photo_url?: string; genre?: string };

const BODY_MAX_LENGTH = 500;

// "Share your take…" — the one Feed post type a normal user can write.
// Strongly artist-centered by design (an artist is required, not optional)
// so this can never become generic, contextless chatter — see the spec's
// own "prevents the Feed from becoming generic Twitter" reasoning.
export default function FeedComposer({ onPosted, openSignal = 0 }: { onPosted: () => void; openSignal?: number }) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<ArtistHit[]>([]);
  const [selected, setSelected] = useState<ArtistHit | null>(null);
  const [body, setBody] = useState('');
  const [posting, setPosting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const searchBoxRef = useRef<HTMLDivElement>(null);

  // Opens on every genuine increment of openSignal (e.g. the empty state's
  // "Share a Take" button), including a re-click after a prior Cancel.
  // Compares against the last-seen VALUE rather than a "have I run once"
  // flag — a flag breaks under React 18 Strict Mode's dev-only double
  // effect invocation (mount -> cleanup -> mount), which would flip the
  // flag on the throwaway first pass and open the composer on every real
  // mount. Comparing values is idempotent no matter how many times the
  // effect fires for the same openSignal.
  const lastSignal = useRef(openSignal);
  useEffect(() => {
    if (openSignal !== lastSignal.current) {
      lastSignal.current = openSignal;
      setOpen(true);
    }
  }, [openSignal]);

  useEffect(() => {
    if (selected || query.trim().length === 0) {
      setResults([]);
      return;
    }
    const timeout = setTimeout(async () => {
      try {
        const res = await fetch(`/api/next/artists/search?q=${encodeURIComponent(query.trim())}`);
        if (!res.ok) return;
        const data = await res.json();
        setResults(data.results ?? []);
      } catch {
        // Best-effort — an empty dropdown on a network hiccup is fine, not worth surfacing an error for.
      }
    }, 250);
    return () => clearTimeout(timeout);
  }, [query, selected]);

  function reset() {
    setQuery('');
    setResults([]);
    setSelected(null);
    setBody('');
    setError(null);
    setOpen(false);
  }

  async function submit() {
    if (!selected || !body.trim() || posting) return;
    setPosting(true);
    setError(null);
    try {
      const res = await fetch('/api/next/feed/posts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ artistId: selected.id, body: body.trim() }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? 'Could not post your take.');
      reset();
      onPosted();
    } catch (err: any) {
      setError(err.message ?? 'Could not post your take.');
    } finally {
      setPosting(false);
    }
  }

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="next-card text-left px-5 py-4 text-[14px] w-full"
        style={{ color: 'var(--text-faint)' }}
      >
        Share your take…
      </button>
    );
  }

  return (
    <div className="next-card p-5 flex flex-col gap-3">
      <div>
        <label className="text-[11px] font-mono uppercase tracking-[0.06em]" style={{ color: 'var(--text-faint)' }}>
          What artist are you talking about?
        </label>
        <div ref={searchBoxRef} className="relative mt-1.5">
          {selected ? (
            <div className="flex items-center gap-2.5 px-3 py-2 rounded-lg border" style={{ borderColor: 'var(--border-soft)', background: 'var(--surface-2)' }}>
              <div className="w-7 h-7 rounded-md overflow-hidden shrink-0 flex items-center justify-center" style={{ background: selected.photo_url ? undefined : heroGradient(selected.id) }}>
                {selected.photo_url ? (
                  // eslint-disable-next-line @next/next/no-img-element -- Scout-curated URL, not a next/image candidate.
                  <img src={selected.photo_url} alt="" className="w-full h-full object-cover" />
                ) : (
                  <span className="text-[11px] font-bold">{selected.name.charAt(0).toUpperCase()}</span>
                )}
              </div>
              <span className="text-sm font-medium flex-1 truncate">{selected.name}</span>
              <button type="button" onClick={() => setSelected(null)} className="text-xs" style={{ color: 'var(--text-faint)' }}>
                Change
              </button>
            </div>
          ) : (
            <>
              <input
                type="text"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search artists…"
                className="w-full px-3 py-2 rounded-lg text-sm border"
                style={{ background: 'var(--surface)', borderColor: 'var(--border-soft)', color: 'var(--text)' }}
              />
              {results.length > 0 && (
                <div
                  className="absolute left-0 right-0 top-full mt-1.5 rounded-lg border overflow-hidden z-10"
                  style={{ background: 'var(--surface)', borderColor: 'var(--border-soft)' }}
                >
                  {results.map((r) => (
                    <button
                      key={r.id}
                      type="button"
                      onClick={() => {
                        setSelected(r);
                        setQuery('');
                        setResults([]);
                      }}
                      className="w-full flex items-center gap-2.5 px-3 py-2 text-left text-sm next-card-hover"
                    >
                      <div className="w-6 h-6 rounded-md overflow-hidden shrink-0 flex items-center justify-center" style={{ background: r.photo_url ? undefined : heroGradient(r.id) }}>
                        {r.photo_url ? (
                          // eslint-disable-next-line @next/next/no-img-element -- Scout-curated URL, not a next/image candidate.
                          <img src={r.photo_url} alt="" className="w-full h-full object-cover" />
                        ) : (
                          <span className="text-[10px] font-bold">{r.name.charAt(0).toUpperCase()}</span>
                        )}
                      </div>
                      <span className="truncate">{r.name}</span>
                      {r.genre && <span className="text-xs ml-auto shrink-0" style={{ color: 'var(--text-faint)' }}>{r.genre}</span>}
                    </button>
                  ))}
                </div>
              )}
            </>
          )}
        </div>
      </div>

      <div>
        <label className="text-[11px] font-mono uppercase tracking-[0.06em]" style={{ color: 'var(--text-faint)' }}>
          What&apos;s your take?
        </label>
        <textarea
          value={body}
          onChange={(e) => setBody(e.target.value)}
          maxLength={BODY_MAX_LENGTH}
          rows={3}
          placeholder="I think this artist is massively undervalued…"
          className="w-full mt-1.5 px-3 py-2.5 rounded-lg text-sm border resize-none"
          style={{ background: 'var(--surface)', borderColor: 'var(--border-soft)', color: 'var(--text)' }}
        />
        <div className="text-right text-[11px] mt-0.5" style={{ color: 'var(--text-faint)' }}>{body.length}/{BODY_MAX_LENGTH}</div>
      </div>

      {error && <p className="m-0 text-[13px]" style={{ color: 'var(--down)' }}>{error}</p>}

      <div className="flex items-center gap-2 justify-end">
        <button type="button" onClick={reset} className="next-btn-ghost text-sm px-4 py-2 rounded-[10px]">
          Cancel
        </button>
        <button
          type="button"
          onClick={submit}
          disabled={!selected || !body.trim() || posting}
          className="next-btn-primary text-sm px-5 py-2 rounded-[10px] font-bold"
        >
          {posting ? 'Posting…' : 'Post'}
        </button>
      </div>
    </div>
  );
}
