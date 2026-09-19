'use client';
import Link from 'next/link';
import { useState } from 'react';
import { Artwork, AVAILABILITY_LABELS } from '@/lib/gallery/types';

export default function WorkCard({ artwork }: { artwork: Artwork }) {
  const [hover, setHover] = useState(false);
  const notForSale = artwork.availability === 'sold' || artwork.availability === 'private_collection';

  return (
    <Link
      href={`/gallery/works/${artwork.slug}`}
      className="block group"
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
    >
      <div className="relative overflow-hidden aspect-[4/5]">
        {artwork.hero_image_url ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={artwork.hero_image_url}
            alt={`${artwork.title}, ${artwork.medium}, ${artwork.year}`}
            loading="lazy"
            className="w-full h-full object-cover g-scale-hover"
            style={notForSale ? { filter: 'grayscale(0.15) brightness(0.85)' } : undefined}
          />
        ) : (
          <div className="w-full h-full" style={{ background: 'var(--g-charcoal)' }} />
        )}

        <div
          className="absolute inset-0 flex flex-col justify-end p-5 transition-opacity duration-300"
          style={{
            opacity: hover ? 1 : 0,
            background: 'linear-gradient(180deg, transparent 40%, oklch(0% 0 0 / 0.75) 100%)',
          }}
        >
          <p className="g-serif text-lg text-[var(--g-offwhite)]">{artwork.title}</p>
          <p className="g-label text-[var(--g-offwhite)] opacity-80 mt-1">{artwork.year}</p>
        </div>

        {notForSale && (
          <span className="absolute top-4 right-4 g-tag" style={{ background: 'oklch(0% 0 0 / 0.5)', borderColor: 'oklch(100% 0 0 / 0.25)', color: 'var(--g-offwhite-dim)' }}>
            {AVAILABILITY_LABELS[artwork.availability]}
          </span>
        )}
      </div>

      <div className="mt-3 flex items-baseline justify-between sm:hidden">
        <span className="text-sm">{artwork.title}</span>
        <span className="g-label">{artwork.year}</span>
      </div>
    </Link>
  );
}
