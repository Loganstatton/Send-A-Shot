'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';

const MAX = 6; // mirrors MAX_GENRE_PREFS in lib/genre-prefs.ts

// Settings card for the genres Discover's "For you" filter uses.
export default function GenrePrefsForm({ options, initial }: { options: string[]; initial: string[] }) {
  const router = useRouter();
  const [selected, setSelected] = useState<string[]>(initial);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const atMax = selected.length >= MAX;

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setMessage(null);
    setError(null);
    try {
      const res = await fetch('/api/next/genre-prefs', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ genres: selected, source: 'settings' }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error ?? 'Could not save.');
      setMessage(selected.length > 0 ? 'Saved. Discover opens on these genres.' : 'Cleared. Discover shows all genres.');
      router.refresh();
    } catch (err: any) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <form onSubmit={save} className="card space-y-3">
      <fieldset className="space-y-3">
        <legend className="font-semibold text-neutral-100">Genres you listen to</legend>
        <p className="text-xs text-neutral-500 -mt-1">
          Up to {MAX}. NEXT&apos;s Discover page shows a &ldquo;For you&rdquo; filter with artists in these genres.
        </p>
        <div className="grid grid-cols-2 gap-2">
          {options.map((g) => {
            const on = selected.includes(g);
            return (
              <label key={g} className="flex items-center gap-2 text-sm text-neutral-300" style={!on && atMax ? { opacity: 0.5 } : undefined}>
                <input
                  type="checkbox"
                  checked={on}
                  disabled={!on && atMax}
                  onChange={(e) => setSelected(e.target.checked ? [...selected, g] : selected.filter((s) => s !== g))}
                />
                {g}
              </label>
            );
          })}
        </div>
      </fieldset>
      {error && <div role="alert" className="text-sm text-red-300">{error}</div>}
      {message && <div role="status" className="text-sm text-green-400">{message}</div>}
      <button type="submit" className="btn btn-primary" disabled={saving}>{saving ? 'Saving…' : 'Save genres'}</button>
    </form>
  );
}
