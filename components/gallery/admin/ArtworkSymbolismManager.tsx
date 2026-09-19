'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { SymbolismHotspot } from '@/lib/gallery/types';

export default function ArtworkSymbolismManager({ artworkId, hotspots, heroImageUrl }: { artworkId: number; hotspots: SymbolismHotspot[]; heroImageUrl: string | null }) {
  const router = useRouter();
  const [label, setLabel] = useState('');
  const [description, setDescription] = useState('');
  const [xPct, setXPct] = useState(50);
  const [yPct, setYPct] = useState(50);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handlePick(e: React.MouseEvent<HTMLDivElement>) {
    const rect = e.currentTarget.getBoundingClientRect();
    setXPct(Math.round(((e.clientX - rect.left) / rect.width) * 1000) / 10);
    setYPct(Math.round(((e.clientY - rect.top) / rect.height) * 1000) / 10);
  }

  async function handleAdd(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setError(null);
    try {
      const res = await fetch(`/api/gallery/works/${artworkId}/symbolism`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ label, description, x_pct: xPct, y_pct: yPct }),
      });
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error ?? 'Save failed.');
      setLabel('');
      setDescription('');
      router.refresh();
    } catch (err: any) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete(id: number) {
    await fetch(`/api/gallery/works/${artworkId}/symbolism/${id}`, { method: 'DELETE' });
    router.refresh();
  }

  return (
    <div>
      <h3 className="g-serif text-lg mb-2">Hidden Symbolism</h3>
      <p className="text-sm mb-6" style={{ color: 'var(--g-text-muted)' }}>Click on the image to set a hotspot&rsquo;s position, then describe what it means.</p>

      {heroImageUrl && (
        <div className="relative mb-8 max-w-md cursor-crosshair" onClick={handlePick}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={heroImageUrl} alt="" className="w-full" />
          <div className="g-hotspot" style={{ left: `${xPct}%`, top: `${yPct}%`, position: 'absolute' }} />
          {hotspots.map((h) => (
            <div key={h.id} className="g-hotspot" style={{ left: `${h.x_pct}%`, top: `${h.y_pct}%`, position: 'absolute', opacity: 0.5 }} title={h.label} />
          ))}
        </div>
      )}

      <ul className="space-y-3 mb-8">
        {hotspots.map((h) => (
          <li key={h.id} className="flex items-start justify-between gap-4 g-hairline-soft pt-3">
            <div>
              <p className="g-serif">{h.label}</p>
              <p className="text-sm" style={{ color: 'var(--g-text-muted)' }}>{h.description}</p>
            </div>
            <button type="button" onClick={() => handleDelete(h.id)} className="text-xs text-red-400 shrink-0">Remove</button>
          </li>
        ))}
      </ul>

      <form onSubmit={handleAdd} className="max-w-md space-y-4">
        <label className="block">
          <span className="g-label block mb-2">Label</span>
          <input required className="g-input" value={label} onChange={(e) => setLabel(e.target.value)} placeholder="e.g. The Shadow" />
        </label>
        <label className="block">
          <span className="g-label block mb-2">Meaning</span>
          <textarea required rows={2} className="g-input resize-none" value={description} onChange={(e) => setDescription(e.target.value)} />
        </label>
        <p className="text-xs" style={{ color: 'var(--g-gray-faint)' }}>Position: {xPct}%, {yPct}% (click the image above to set)</p>
        {error && <p className="text-sm text-red-400">{error}</p>}
        <button type="submit" disabled={saving} className="g-btn">{saving ? 'Adding…' : 'Add Hotspot'}</button>
      </form>
    </div>
  );
}
