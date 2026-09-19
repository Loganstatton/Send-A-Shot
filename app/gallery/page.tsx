import Link from 'next/link';
import type { Metadata } from 'next';
import ParallaxHero from '@/components/gallery/ParallaxHero';
import Reveal from '@/components/gallery/Reveal';
import UpcomingReveal from '@/components/gallery/UpcomingReveal';
import { listArtworks, listUpcomingArtworks } from '@/lib/gallery/db';
import { AVAILABILITY_LABELS } from '@/lib/gallery/types';
import { ARTIST_NAME } from '@/lib/gallery/constants';

// A page-level `absolute` title (rather than relying on the layout's
// default as a fallback) so this bypasses every ancestor template,
// including the root layout's own "%s · NEXT" (see app/layout.tsx).
export const metadata: Metadata = {
  title: { absolute: `${ARTIST_NAME} — Original Pencil & Charcoal Drawings` },
};

export default function GalleryHomePage() {
  const artworks = listArtworks().slice(0, 6);
  const hero = artworks[0] ?? null;
  const rest = artworks.slice(1);
  const upcoming = listUpcomingArtworks();

  return (
    <>
      <ParallaxHero artwork={hero} artistName={ARTIST_NAME} />

      {upcoming.length > 0 && (
        <section className="max-w-[1600px] mx-auto px-5 sm:px-8 pt-28">
          {upcoming.map((a) => (
            <UpcomingReveal key={a.id} artwork={a} />
          ))}
        </section>
      )}

      <section className="max-w-[1600px] mx-auto px-5 sm:px-8 py-28 sm:py-40 space-y-32 sm:space-y-48">
        {rest.map((artwork, i) => (
          <Reveal key={artwork.id}>
            <article className={`grid grid-cols-1 md:grid-cols-12 gap-8 md:gap-16 items-center ${i % 2 === 1 ? 'md:[direction:rtl]' : ''}`}>
              <div className="md:col-span-7 [direction:ltr] overflow-hidden">
                <Link href={`/gallery/works/${artwork.slug}`} className="block g-scale-hover">
                  {artwork.hero_image_url ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={artwork.hero_image_url}
                      alt={`${artwork.title}, ${artwork.medium}, ${artwork.year}`}
                      loading="lazy"
                      className="w-full h-[70vh] object-cover"
                    />
                  ) : (
                    <div className="w-full h-[70vh]" style={{ background: 'var(--g-charcoal)' }} />
                  )}
                </Link>
              </div>
              <div className="md:col-span-5 [direction:ltr]">
                <p className="g-label mb-4">
                  {artwork.medium} &middot; {artwork.year} &middot; {artwork.is_original ? 'Original' : 'Edition'}
                </p>
                <h2 className="g-serif text-[clamp(1.8rem,4vw,3rem)] leading-tight mb-6">{artwork.title}</h2>
                <p className="text-lg leading-relaxed mb-8 max-w-md" style={{ color: 'var(--g-text-muted)' }}>
                  {artwork.short_description}
                </p>
                <div className="flex items-center gap-4 mb-10">
                  <span className={`g-tag g-tag-status-${artwork.availability}`}>{AVAILABILITY_LABELS[artwork.availability]}</span>
                </div>
                <Link href={`/gallery/works/${artwork.slug}`} className="g-btn">Explore the Work</Link>
              </div>
            </article>
          </Reveal>
        ))}
      </section>

      <section className="g-hairline-soft py-28 sm:py-36 text-center px-6" style={{ background: 'var(--g-charcoal)' }}>
        <Reveal>
          <p className="g-label mb-6">The Artist</p>
          <p className="g-serif italic text-[clamp(1.3rem,2.6vw,2rem)] max-w-2xl mx-auto leading-relaxed mb-10">
            Every piece begins with a feeling I can&rsquo;t say out loud yet, and paper.
          </p>
          <Link href="/gallery/about" className="g-btn">Read the Artist&rsquo;s Story</Link>
        </Reveal>
      </section>
    </>
  );
}
