import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import ZoomableArtwork from '@/components/gallery/ZoomableArtwork';
import SymbolismExplorer from '@/components/gallery/SymbolismExplorer';
import AcquireWork from '@/components/gallery/AcquireWork';
import Reveal from '@/components/gallery/Reveal';
import { getArtworkBySlug, getArtworkFull, listArtworks } from '@/lib/gallery/db';
import { AVAILABILITY_LABELS, CATEGORY_LABELS, PROVENANCE_LABELS } from '@/lib/gallery/types';

export function generateStaticParams() {
  return listArtworks().map((a) => ({ slug: a.slug }));
}

export function generateMetadata({ params }: { params: { slug: string } }): Metadata {
  const artwork = getArtworkBySlug(params.slug);
  if (!artwork) return {};
  return {
    title: `${artwork.title} (${artwork.year})`,
    description: artwork.short_description,
    openGraph: {
      title: `${artwork.title} (${artwork.year})`,
      description: artwork.short_description,
      images: artwork.hero_image_url ? [{ url: artwork.hero_image_url }] : undefined,
      type: 'article',
    },
  };
}

export default function ArtworkDetailPage({ params }: { params: { slug: string } }) {
  const artwork = getArtworkBySlug(params.slug);
  if (!artwork) notFound();
  const full = getArtworkFull(artwork);

  const detailImages = full.images.filter((i) => i.kind === 'detail');
  const textureImages = full.images.filter((i) => i.kind === 'texture');
  const presentationImages = full.images.filter((i) => ['framed', 'gallery_wall', 'signature', 'process'].includes(i.kind));

  const storyParagraphs = artwork.story.split(/\n{2,}/).filter(Boolean);

  const jsonLd = {
    '@context': 'https://schema.org',
    '@type': 'VisualArtwork',
    name: artwork.title,
    dateCreated: String(artwork.year),
    artMedium: artwork.medium,
    artform: 'Drawing',
    description: artwork.short_description,
    image: artwork.hero_image_url ?? undefined,
    ...(artwork.price_display_mode === 'public' && artwork.price_cents != null
      ? { offers: { '@type': 'Offer', price: (artwork.price_cents / 100).toFixed(2), priceCurrency: 'USD', availability: artwork.availability === 'available' ? 'https://schema.org/InStock' : 'https://schema.org/SoldOut' } }
      : {}),
  };

  return (
    <div>
      {/* eslint-disable-next-line @next/next/next-script-for-ga */}
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }} />

      <section className="pt-20 sm:pt-24">
        {artwork.hero_image_url && <ZoomableArtwork src={artwork.hero_image_url} alt={`${artwork.title}, ${artwork.medium}, ${artwork.year}`} />}
      </section>

      <section className="max-w-[1600px] mx-auto px-5 sm:px-8 pt-16 pb-20 grid grid-cols-1 md:grid-cols-12 gap-10 md:gap-16 g-hairline-soft">
        <div className="md:col-span-7 pt-10">
          <p className="g-label mb-4">{artwork.artwork_code}</p>
          <h1 className="g-serif text-[clamp(2.2rem,5vw,4rem)] leading-tight mb-8">{artwork.title}</h1>
          <dl className="grid grid-cols-2 sm:grid-cols-3 gap-x-6 gap-y-6 max-w-xl">
            <MetaItem label="Year" value={String(artwork.year)} />
            <MetaItem label="Medium" value={artwork.medium} />
            <MetaItem label="Dimensions" value={artwork.dimensions} />
            <MetaItem label="Type" value={artwork.edition_total != null ? 'Limited Edition' : 'Original'} />
            <MetaItem label="Signature" value={artwork.signed ? 'Signed' : 'Unsigned'} />
            <MetaItem label="Availability" value={AVAILABILITY_LABELS[artwork.availability]} />
          </dl>
          {artwork.categories.length > 0 && (
            <div className="flex flex-wrap gap-2 mt-8">
              {artwork.categories.map((c) => (
                <span key={c} className="g-tag">{CATEGORY_LABELS[c]}</span>
              ))}
            </div>
          )}
        </div>
        <div className="md:col-span-5 pt-10">
          <AcquireWork artwork={artwork} />
        </div>
      </section>

      {storyParagraphs.length > 0 && (
        <section className="py-28 sm:py-40 px-6" style={{ background: 'var(--g-charcoal)' }}>
          <Reveal className="max-w-3xl mx-auto text-center">
            <p className="g-label mb-10">The Story</p>
            <div className="space-y-8">
              {storyParagraphs.map((p, i) => (
                <p key={i} className="g-serif italic text-[clamp(1.3rem,2.8vw,2rem)] leading-relaxed">{p}</p>
              ))}
            </div>
          </Reveal>
        </section>
      )}

      {(detailImages.length > 0 || textureImages.length > 0) && (
        <section className="max-w-[1600px] mx-auto px-5 sm:px-8 py-24 sm:py-32">
          <Reveal>
            <p className="g-label mb-10">In Close Detail</p>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              {[...detailImages, ...textureImages].map((img) => (
                // eslint-disable-next-line @next/next/no-img-element
                <img key={img.id} src={img.url} alt={img.alt} loading="lazy" className="w-full aspect-square object-cover" />
              ))}
            </div>
          </Reveal>
        </section>
      )}

      {full.symbolism.length > 0 && artwork.hero_image_url && (
        <section className="py-24 sm:py-32 px-5 sm:px-8" style={{ background: 'var(--g-charcoal)' }}>
          <Reveal className="max-w-[1600px] mx-auto">
            <p className="g-label mb-10">Details</p>
            <SymbolismExplorer imageUrl={artwork.hero_image_url} alt={artwork.title} hotspots={full.symbolism} />
          </Reveal>
        </section>
      )}

      {presentationImages.length > 0 && (
        <section className="max-w-[1600px] mx-auto px-5 sm:px-8 py-24 sm:py-32">
          <Reveal>
            <p className="g-label mb-10">Presentation</p>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
              {presentationImages.map((img) => (
                <figure key={img.id}>
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={img.url} alt={img.alt} loading="lazy" className="w-full aspect-[4/3] object-cover" />
                  {img.alt && <figcaption className="g-label mt-3">{img.alt}</figcaption>}
                </figure>
              ))}
            </div>
          </Reveal>
        </section>
      )}

      {full.provenance.length > 0 && (
        <section className="max-w-[1600px] mx-auto px-5 sm:px-8 py-24 sm:py-32 g-hairline-soft">
          <Reveal>
            <p className="g-label mb-10">Provenance</p>
            <ul className="space-y-8 max-w-2xl">
              {full.provenance.map((p) => (
                <li key={p.id} className="flex flex-col sm:flex-row sm:items-baseline gap-1 sm:gap-6">
                  <span className="g-label w-32 shrink-0">{PROVENANCE_LABELS[p.kind]}</span>
                  <span>
                    <span className="g-serif text-lg">{p.title}</span>
                    {p.date_text && <span style={{ color: 'var(--g-text-muted)' }}> &mdash; {p.date_text}</span>}
                    {p.detail && <span className="block mt-1 text-sm" style={{ color: 'var(--g-text-muted)' }}>{p.detail}</span>}
                  </span>
                </li>
              ))}
            </ul>
          </Reveal>
        </section>
      )}

      <section className="max-w-[1600px] mx-auto px-5 sm:px-8 pb-28 pt-4 text-center">
        <Link href="/gallery/works" className="g-label">&larr; Back to The Works</Link>
      </section>
    </div>
  );
}

function MetaItem({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="g-label mb-1.5">{label}</dt>
      <dd>{value}</dd>
    </div>
  );
}
