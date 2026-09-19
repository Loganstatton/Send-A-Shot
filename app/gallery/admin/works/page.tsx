import Link from 'next/link';
import type { Metadata } from 'next';
import { listArtworks } from '@/lib/gallery/db';
import { AVAILABILITY_LABELS } from '@/lib/gallery/types';

export const metadata: Metadata = { title: 'Admin — Works' };

export default function AdminWorksListPage() {
  const artworks = listArtworks({ includeUnpublished: true, includeUnreleased: true });

  return (
    <div>
      <div className="flex items-center justify-between mb-10">
        <h2 className="g-serif text-xl">All Works ({artworks.length})</h2>
        <Link href="/gallery/admin/works/new" className="g-btn g-btn-solid">+ Add New Work</Link>
      </div>

      <div className="divide-y" style={{ borderColor: 'var(--g-line-soft)' }}>
        {artworks.map((a) => (
          <Link
            key={a.id}
            href={`/gallery/admin/works/${a.id}`}
            className="flex items-center gap-5 py-4 hover:opacity-80 transition-opacity"
            style={{ borderTop: '1px solid var(--g-line-soft)' }}
          >
            <div className="w-16 h-20 shrink-0 overflow-hidden" style={{ background: 'var(--g-charcoal)' }}>
              {a.hero_image_url && (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={a.hero_image_url} alt="" className="w-full h-full object-cover" />
              )}
            </div>
            <div className="flex-1 min-w-0">
              <p className="g-serif">{a.title || <span style={{ color: 'var(--g-gray-faint)' }}>Untitled</span>}</p>
              <p className="g-label mt-1">{a.year} &middot; {AVAILABILITY_LABELS[a.availability]}{!a.is_published && ' · Unpublished'}{a.release_at && new Date(a.release_at).getTime() > Date.now() && ' · Scheduled'}</p>
            </div>
            <span className="g-label">{a.artwork_code}</span>
          </Link>
        ))}
        {artworks.length === 0 && <p className="py-10" style={{ color: 'var(--g-text-muted)' }}>No works yet.</p>}
      </div>
    </div>
  );
}
