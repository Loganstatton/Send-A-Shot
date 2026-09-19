'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';

export default function NewWorkForm() {
  const router = useRouter();
  const [title, setTitle] = useState('');
  const [year, setYear] = useState(new Date().getFullYear());
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setError(null);
    try {
      const res = await fetch('/api/gallery/works', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title, year }),
      });
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error ?? 'Something went wrong.');
      const { artwork } = await res.json();
      router.push(`/gallery/admin/works/${artwork.id}`);
    } catch (err: any) {
      setError(err.message);
      setSaving(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="max-w-md space-y-6">
      <label className="block">
        <span className="g-label block mb-2">Title</span>
        <input required className="g-input" value={title} onChange={(e) => setTitle(e.target.value)} />
      </label>
      <label className="block">
        <span className="g-label block mb-2">Year</span>
        <input required type="number" className="g-input" value={year} onChange={(e) => setYear(Number(e.target.value))} />
      </label>
      {error && <p className="text-sm text-red-400">{error}</p>}
      <button type="submit" disabled={saving} className="g-btn g-btn-solid">{saving ? 'Creating…' : 'Create Work'}</button>
      <p className="text-xs" style={{ color: 'var(--g-gray-faint)' }}>Created as unpublished — you&rsquo;ll fill in the rest and publish on the next screen.</p>
    </form>
  );
}
