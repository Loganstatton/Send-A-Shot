'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { ArtworkCategory, ArtworkFull, Availability, CATEGORY_LABELS, PriceDisplayMode } from '@/lib/gallery/types';

function readFileAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

async function uploadImage(file: File, subdir = 'artworks'): Promise<string> {
  const dataUrl = await readFileAsDataUrl(file);
  const res = await fetch('/api/gallery/upload', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ data_url: dataUrl, subdir }),
  });
  if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error ?? 'Upload failed.');
  const { url } = await res.json();
  return url;
}

const CATEGORIES = Object.keys(CATEGORY_LABELS) as ArtworkCategory[];

export default function ArtworkEditForm({ artwork }: { artwork: ArtworkFull }) {
  const router = useRouter();
  const [form, setForm] = useState({
    title: artwork.title,
    year: artwork.year,
    medium: artwork.medium,
    dimensions: artwork.dimensions,
    short_description: artwork.short_description,
    story: artwork.story,
    categories: artwork.categories,
    availability: artwork.availability,
    is_original: artwork.is_original,
    signed: artwork.signed,
    price_display_mode: artwork.price_display_mode,
    price_cents: artwork.price_cents ?? 0,
    edition_total: artwork.edition_total ?? 0,
    edition_remaining: artwork.edition_remaining ?? 0,
    edition_closed: artwork.edition_closed,
    artwork_code: artwork.artwork_code,
    certificate_number: artwork.certificate_number ?? '',
    hero_image_url: artwork.hero_image_url ?? '',
    silhouette_image_url: artwork.silhouette_image_url ?? '',
    release_at: artwork.release_at ? artwork.release_at.slice(0, 16) : '',
    is_published: artwork.is_published,
  });
  const [isEdition, setIsEdition] = useState(artwork.edition_total != null);
  const [isScheduled, setIsScheduled] = useState(!!artwork.release_at);
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState<'hero' | 'silhouette' | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  function set<K extends keyof typeof form>(key: K, value: (typeof form)[K]) {
    setForm((f) => ({ ...f, [key]: value }));
  }

  function toggleCategory(cat: ArtworkCategory) {
    set('categories', form.categories.includes(cat) ? form.categories.filter((c) => c !== cat) : [...form.categories, cat]);
  }

  async function handleImageUpload(e: React.ChangeEvent<HTMLInputElement>, field: 'hero_image_url' | 'silhouette_image_url') {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploading(field === 'hero_image_url' ? 'hero' : 'silhouette');
    setError(null);
    try {
      const url = await uploadImage(file);
      set(field, url);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setUploading(null);
    }
  }

  async function handleSave(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setMessage(null);
    setError(null);
    try {
      const payload = {
        ...form,
        price_cents: form.price_display_mode === 'public' ? form.price_cents : null,
        edition_total: isEdition ? form.edition_total : null,
        edition_remaining: isEdition ? form.edition_remaining : null,
        release_at: isScheduled && form.release_at ? new Date(form.release_at).toISOString() : null,
      };
      const res = await fetch(`/api/gallery/works/${artwork.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error ?? 'Save failed.');
      setMessage('Saved.');
      router.refresh();
    } catch (err: any) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete() {
    if (!confirm(`Permanently delete "${form.title}"? This cannot be undone.`)) return;
    await fetch(`/api/gallery/works/${artwork.id}`, { method: 'DELETE' });
    router.push('/gallery/admin/works');
  }

  return (
    <form onSubmit={handleSave} className="grid grid-cols-1 lg:grid-cols-12 gap-12">
      <div className="lg:col-span-7 space-y-7">
        <Field label="Title"><input required className="g-input" value={form.title} onChange={(e) => set('title', e.target.value)} /></Field>

        <div className="grid grid-cols-2 gap-6">
          <Field label="Year"><input required type="number" className="g-input" value={form.year} onChange={(e) => set('year', Number(e.target.value))} /></Field>
          <Field label="Artwork ID"><input className="g-input" value={form.artwork_code} onChange={(e) => set('artwork_code', e.target.value)} /></Field>
        </div>

        <div className="grid grid-cols-2 gap-6">
          <Field label="Medium"><input className="g-input" value={form.medium} onChange={(e) => set('medium', e.target.value)} /></Field>
          <Field label="Dimensions"><input className="g-input" value={form.dimensions} onChange={(e) => set('dimensions', e.target.value)} /></Field>
        </div>

        <Field label="Short Description (homepage / card excerpt)">
          <input className="g-input" value={form.short_description} onChange={(e) => set('short_description', e.target.value)} />
        </Field>

        <Field label="The Story (separate paragraphs with a blank line)">
          <textarea rows={8} className="g-input resize-none" value={form.story} onChange={(e) => set('story', e.target.value)} />
        </Field>

        <div>
          <span className="g-label block mb-3">Collections</span>
          <div className="flex flex-wrap gap-2">
            {CATEGORIES.map((c) => (
              <button
                type="button"
                key={c}
                onClick={() => toggleCategory(c)}
                className="g-tag"
                style={form.categories.includes(c) ? { color: 'var(--g-black)', background: 'var(--g-offwhite)', borderColor: 'var(--g-offwhite)' } : undefined}
              >
                {CATEGORY_LABELS[c]}
              </button>
            ))}
          </div>
        </div>

        <div className="grid grid-cols-2 gap-6">
          <Field label="Availability">
            <select className="g-input" value={form.availability} onChange={(e) => set('availability', e.target.value as Availability)}>
              <option value="available">Available</option>
              <option value="reserved">Reserved</option>
              <option value="sold">Sold</option>
              <option value="private_collection">Private Collection</option>
            </select>
          </Field>
          <Field label="Signature">
            <label className="flex items-center gap-2 mt-2 text-sm">
              <input type="checkbox" checked={form.signed} onChange={(e) => set('signed', e.target.checked)} /> Signed
            </label>
          </Field>
        </div>

        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={form.is_original} onChange={(e) => set('is_original', e.target.checked)} /> Original (uncheck for a print/edition-only listing)
        </label>

        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={isEdition} onChange={(e) => setIsEdition(e.target.checked)} /> This work has a limited-edition print run
        </label>
        {isEdition && (
          <div className="grid grid-cols-3 gap-6 pl-6">
            <Field label="Edition Size"><input type="number" className="g-input" value={form.edition_total} onChange={(e) => set('edition_total', Number(e.target.value))} /></Field>
            <Field label="Remaining"><input type="number" className="g-input" value={form.edition_remaining} onChange={(e) => set('edition_remaining', Number(e.target.value))} /></Field>
            <Field label="Status">
              <label className="flex items-center gap-2 mt-2 text-sm">
                <input type="checkbox" checked={form.edition_closed} onChange={(e) => set('edition_closed', e.target.checked)} /> Closed
              </label>
            </Field>
          </div>
        )}

        <div className="grid grid-cols-2 gap-6">
          <Field label="Price Display">
            <select className="g-input" value={form.price_display_mode} onChange={(e) => set('price_display_mode', e.target.value as PriceDisplayMode)}>
              <option value="public">Show public price</option>
              <option value="upon_request">Price upon request</option>
              <option value="hidden">Hidden</option>
            </select>
          </Field>
          {form.price_display_mode === 'public' && (
            <Field label="Price (USD)">
              <input type="number" className="g-input" value={form.price_cents / 100} onChange={(e) => set('price_cents', Math.round(Number(e.target.value) * 100))} />
            </Field>
          )}
        </div>

        <Field label="Certificate Number (optional)">
          <input className="g-input" value={form.certificate_number} onChange={(e) => set('certificate_number', e.target.value)} />
        </Field>

        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={isScheduled} onChange={(e) => setIsScheduled(e.target.checked)} /> Schedule as a future reveal (countdown shown on homepage until this date)
        </label>
        {isScheduled && (
          <Field label="Reveal Date &amp; Time">
            <input type="datetime-local" className="g-input" value={form.release_at} onChange={(e) => set('release_at', e.target.value)} />
          </Field>
        )}

        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={form.is_published} onChange={(e) => set('is_published', e.target.checked)} /> Published (visible on the public site)
        </label>

        {error && <p className="text-sm text-red-400">{error}</p>}
        {message && <p className="text-sm" style={{ color: 'var(--g-text-muted)' }}>{message}</p>}

        <div className="flex items-center gap-4 pt-4">
          <button type="submit" disabled={saving} className="g-btn g-btn-solid">{saving ? 'Saving…' : 'Save Changes'}</button>
          <button type="button" onClick={handleDelete} className="g-label text-red-400">Delete Work</button>
        </div>
      </div>

      <div className="lg:col-span-5 space-y-10">
        <ImageUploadField
          label="Hero Image (primary view)"
          url={form.hero_image_url}
          uploading={uploading === 'hero'}
          onUpload={(e) => handleImageUpload(e, 'hero_image_url')}
        />
        {isScheduled && (
          <ImageUploadField
            label="Silhouette / Obscured Image (shown before reveal)"
            url={form.silhouette_image_url}
            uploading={uploading === 'silhouette'}
            onUpload={(e) => handleImageUpload(e, 'silhouette_image_url')}
          />
        )}
      </div>
    </form>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="g-label block mb-2">{label}</span>
      {children}
    </label>
  );
}

function ImageUploadField({
  label,
  url,
  uploading,
  onUpload,
}: {
  label: string;
  url: string;
  uploading: boolean;
  onUpload: (e: React.ChangeEvent<HTMLInputElement>) => void;
}) {
  return (
    <div>
      <span className="g-label block mb-3">{label}</span>
      {url && (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={url} alt="" className="w-full aspect-[4/5] object-cover mb-3" style={{ background: 'var(--g-charcoal)' }} />
      )}
      <input type="file" accept="image/jpeg,image/png,image/webp" onChange={onUpload} disabled={uploading} className="text-sm" style={{ color: 'var(--g-text-muted)' }} />
      {uploading && <p className="text-xs mt-1" style={{ color: 'var(--g-gray-faint)' }}>Uploading…</p>}
    </div>
  );
}
