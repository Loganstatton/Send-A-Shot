'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { ProvenanceEntry, ProvenanceKind, PROVENANCE_LABELS } from '@/lib/gallery/types';

const KINDS = Object.keys(PROVENANCE_LABELS) as ProvenanceKind[];

export default function ArtworkProvenanceManager({ artworkId, entries }: { artworkId: number; entries: ProvenanceEntry[] }) {
  const router = useRouter();
  const [kind, setKind] = useState<ProvenanceKind>('exhibition');
  const [title, setTitle] = useState('');
  const [dateText, setDateText] = useState('');
  const [detail, setDetail] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleAdd(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setError(null);
    try {
      const res = await fetch(`/api/gallery/works/${artworkId}/provenance`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ kind, title, date_text: dateText, detail }),
      });
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error ?? 'Save failed.');
      setTitle('');
      setDateText('');
      setDetail('');
      router.refresh();
    } catch (err: any) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete(id: number) {
    await fetch(`/api/gallery/works/${artworkId}/provenance/${id}`, { method: 'DELETE' });
    router.refresh();
  }

  return (
    <div>
      <h3 className="g-serif text-lg mb-2">Provenance</h3>
      <p className="text-sm mb-6" style={{ color: 'var(--g-text-muted)' }}>Exhibitions, publications, awards, and ownership history. Only shown on the work&rsquo;s page once an entry exists.</p>

      <ul className="space-y-3 mb-8">
        {entries.map((p) => (
          <li key={p.id} className="flex items-start justify-between gap-4 g-hairline-soft pt-3">
            <div>
              <p className="g-label">{PROVENANCE_LABELS[p.kind]}</p>
              <p className="g-serif">{p.title}{p.date_text && ` — ${p.date_text}`}</p>
              {p.detail && <p className="text-sm" style={{ color: 'var(--g-text-muted)' }}>{p.detail}</p>}
            </div>
            <button type="button" onClick={() => handleDelete(p.id)} className="text-xs text-red-400 shrink-0">Remove</button>
          </li>
        ))}
      </ul>

      <form onSubmit={handleAdd} className="max-w-md space-y-4">
        <label className="block">
          <span className="g-label block mb-2">Kind</span>
          <select className="g-input" value={kind} onChange={(e) => setKind(e.target.value as ProvenanceKind)}>
            {KINDS.map((k) => <option key={k} value={k}>{PROVENANCE_LABELS[k]}</option>)}
          </select>
        </label>
        <label className="block">
          <span className="g-label block mb-2">Title</span>
          <input required className="g-input" value={title} onChange={(e) => setTitle(e.target.value)} />
        </label>
        <label className="block">
          <span className="g-label block mb-2">Date (free text)</span>
          <input className="g-input" value={dateText} onChange={(e) => setDateText(e.target.value)} placeholder="e.g. March 2026" />
        </label>
        <label className="block">
          <span className="g-label block mb-2">Detail (optional)</span>
          <textarea rows={2} className="g-input resize-none" value={detail} onChange={(e) => setDetail(e.target.value)} />
        </label>
        {error && <p className="text-sm text-red-400">{error}</p>}
        <button type="submit" disabled={saving} className="g-btn">{saving ? 'Adding…' : 'Add Entry'}</button>
      </form>
    </div>
  );
}
