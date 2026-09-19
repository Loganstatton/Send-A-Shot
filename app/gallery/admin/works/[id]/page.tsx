import { notFound } from 'next/navigation';
import Link from 'next/link';
import type { Metadata } from 'next';
import { getArtworkById, getArtworkFull } from '@/lib/gallery/db';

export const metadata: Metadata = { title: 'Admin — Edit Work' };
import ArtworkEditForm from '@/components/gallery/admin/ArtworkEditForm';
import ArtworkImagesManager from '@/components/gallery/admin/ArtworkImagesManager';
import ArtworkSymbolismManager from '@/components/gallery/admin/ArtworkSymbolismManager';
import ArtworkProvenanceManager from '@/components/gallery/admin/ArtworkProvenanceManager';

export default function AdminWorkEditPage({ params }: { params: { id: string } }) {
  const artwork = getArtworkById(Number(params.id));
  if (!artwork) notFound();
  const full = getArtworkFull(artwork);

  return (
    <div>
      <div className="flex items-center justify-between mb-10">
        <h2 className="g-serif text-xl">{artwork.title || 'Untitled'}</h2>
        {artwork.is_published && (
          <Link href={`/gallery/works/${artwork.slug}`} className="g-label opacity-70 hover:opacity-100">View Live &rarr;</Link>
        )}
      </div>

      <ArtworkEditForm artwork={full} />

      <div className="g-hairline mt-16 pt-16">
        <ArtworkImagesManager artworkId={artwork.id} images={full.images} />
      </div>

      <div className="g-hairline mt-16 pt-16">
        <ArtworkSymbolismManager artworkId={artwork.id} hotspots={full.symbolism} heroImageUrl={artwork.hero_image_url} />
      </div>

      <div className="g-hairline mt-16 pt-16">
        <ArtworkProvenanceManager artworkId={artwork.id} entries={full.provenance} />
      </div>
    </div>
  );
}
