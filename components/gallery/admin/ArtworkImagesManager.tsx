'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { ArtworkImage, ImageKind } from '@/lib/gallery/types';

const KINDS: { value: ImageKind; label: string }[] = [
  { value: 'detail', label: 'Detail (close-up of the drawing)' },
  { value: 'texture', label: 'Paper / Graphite Texture' },
  { value: 'signature', label: 'Signature' },
  { value: 'framed', label: 'Framed in a Home' },
  { value: 'gallery_wall', label: 'Hanging in a Gallery' },
  { value: 'process', label: 'Process' },
];

function readFileAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

export default function ArtworkImagesManager({ artworkId, images }: { artworkId: number; images: ArtworkImage[] }) {
  const router = useRouter();
  const [kind, setKind] = useState<ImageKind>('detail');
  const [alt, setAlt] = useState('');
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploading(true);
    setError(null);
    try {
      const dataUrl = await readFileAsDataUrl(file);
      const res = await fetch(`/api/gallery/works/${artworkId}/images`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ data_url: dataUrl, kind, alt }),
      });
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error ?? 'Upload failed.');
      setAlt('');
      e.target.value = '';
      router.refresh();
    } catch (err: any) {
      setError(err.message);
    } finally {
      setUploading(false);
    }
  }

  async function handleDelete(imageId: number) {
    await fetch(`/api/gallery/works/${artworkId}/images/${imageId}`, { method: 'DELETE' });
    router.refresh();
  }

  return (
    <div>
      <h3 className="g-serif text-lg mb-6">Additional Images</h3>

      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-4 mb-8">
        {images.map((img) => (
          <div key={img.id} className="relative">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={img.url} alt={img.alt} className="w-full aspect-square object-cover" style={{ background: 'var(--g-charcoal)' }} />
            <p className="g-label mt-2">{KINDS.find((k) => k.value === img.kind)?.label ?? img.kind}</p>
            <button type="button" onClick={() => handleDelete(img.id)} className="text-xs text-red-400 mt-1">Remove</button>
          </div>
        ))}
        {images.length === 0 && <p className="col-span-full text-sm" style={{ color: 'var(--g-gray-faint)' }}>No additional images yet.</p>}
      </div>

      <div className="g-hairline-soft pt-6 max-w-md space-y-4">
        <label className="block">
          <span className="g-label block mb-2">Image Type</span>
          <select className="g-input" value={kind} onChange={(e) => setKind(e.target.value as ImageKind)}>
            {KINDS.map((k) => <option key={k.value} value={k.value}>{k.label}</option>)}
          </select>
        </label>
        <label className="block">
          <span className="g-label block mb-2">Caption / Alt Text</span>
          <input className="g-input" value={alt} onChange={(e) => setAlt(e.target.value)} />
        </label>
        <input type="file" accept="image/jpeg,image/png,image/webp" onChange={handleUpload} disabled={uploading} className="text-sm" style={{ color: 'var(--g-text-muted)' }} />
        {uploading && <p className="text-xs" style={{ color: 'var(--g-gray-faint)' }}>Uploading…</p>}
        {error && <p className="text-sm text-red-400">{error}</p>}
      </div>
    </div>
  );
}
