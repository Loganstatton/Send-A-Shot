'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';

export default function NewStoryForm() {
  const router = useRouter();
  const [title, setTitle] = useState('');
  const [dek, setDek] = useState('');
  const [body, setBody] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setError(null);
    try {
      const res = await fetch('/api/gallery/stories', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title, dek, body }),
      });
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error ?? 'Something went wrong.');
      setTitle('');
      setDek('');
      setBody('');
      router.refresh();
    } catch (err: any) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="max-w-lg space-y-5">
      <label className="block">
        <span className="g-label block mb-2">Title</span>
        <input required className="g-input" value={title} onChange={(e) => setTitle(e.target.value)} />
      </label>
      <label className="block">
        <span className="g-label block mb-2">Dek (short standfirst)</span>
        <input className="g-input" value={dek} onChange={(e) => setDek(e.target.value)} />
      </label>
      <label className="block">
        <span className="g-label block mb-2">Body (separate paragraphs with a blank line)</span>
        <textarea rows={8} className="g-input resize-none" value={body} onChange={(e) => setBody(e.target.value)} />
      </label>
      {error && <p className="text-sm text-red-400">{error}</p>}
      <button type="submit" disabled={saving} className="g-btn g-btn-solid">{saving ? 'Publishing…' : 'Publish Story'}</button>
    </form>
  );
}
