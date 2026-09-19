'use client';
import { useState } from 'react';

function readFileAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

export default function ParticipateForm() {
  const [name, setName] = useState('');
  const [story, setStory] = useState('');
  const [permission, setPermission] = useState(false);
  const [website, setWebsite] = useState('');
  const [photoDataUrl, setPhotoDataUrl] = useState<string | null>(null);
  const [photoName, setPhotoName] = useState<string | null>(null);
  const [status, setStatus] = useState<'idle' | 'saving' | 'done' | 'error'>('idle');
  const [error, setError] = useState<string | null>(null);

  async function handlePhoto(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    if (file.size > 8 * 1024 * 1024) {
      setError('Photo must be under 8MB.');
      return;
    }
    setPhotoDataUrl(await readFileAsDataUrl(file));
    setPhotoName(file.name);
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setStatus('saving');
    setError(null);
    try {
      const res = await fetch('/api/gallery/submissions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, story, permission_granted: permission, photo_data_url: photoDataUrl, website }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error ?? 'Something went wrong.');
      }
      setStatus('done');
    } catch (err: any) {
      setError(err.message ?? 'Something went wrong.');
      setStatus('error');
    }
  }

  if (status === 'done') {
    return (
      <div className="max-w-lg">
        <p className="g-serif italic text-2xl leading-relaxed mb-4">Thank you for sharing this.</p>
        <p style={{ color: 'var(--g-text-muted)' }}>
          Your submission has been received. It is never published or used without a personal follow-up from the studio first.
        </p>
      </div>
    );
  }

  return (
    <form onSubmit={handleSubmit} className="max-w-lg space-y-7">
      <div className="sr-only" aria-hidden="true">
        <label htmlFor="participate-website">Leave this field blank</label>
        <input id="participate-website" type="text" tabIndex={-1} autoComplete="off" value={website} onChange={(e) => setWebsite(e.target.value)} />
      </div>

      <label className="block">
        <span className="g-label block mb-2">Name</span>
        <input required className="g-input" value={name} onChange={(e) => setName(e.target.value)} />
      </label>

      <label className="block">
        <span className="g-label block mb-2">Your Story</span>
        <textarea
          required
          rows={7}
          minLength={10}
          className="g-input resize-none"
          placeholder="What happened. What it felt like. What you want the work to carry, if anything of it appears."
          value={story}
          onChange={(e) => setStory(e.target.value)}
        />
      </label>

      <label className="block">
        <span className="g-label block mb-2">Photograph (optional)</span>
        <input type="file" accept="image/jpeg,image/png,image/webp" onChange={handlePhoto} className="text-sm" style={{ color: 'var(--g-text-muted)' }} />
        {photoName && <span className="block text-xs mt-1" style={{ color: 'var(--g-text-muted)' }}>{photoName} attached</span>}
      </label>

      <label className="flex items-start gap-3 text-sm" style={{ color: 'var(--g-text-muted)' }}>
        <input type="checkbox" required className="mt-1" checked={permission} onChange={(e) => setPermission(e.target.checked)} />
        <span>I give permission for my story (and photograph, if provided) to be used as inspiration for, or to appear within, a future artwork.</span>
      </label>

      {error && <p className="text-sm text-red-400">{error}</p>}

      <button type="submit" disabled={status === 'saving'} className="g-btn">
        {status === 'saving' ? 'Submitting…' : 'Submit'}
      </button>
    </form>
  );
}
