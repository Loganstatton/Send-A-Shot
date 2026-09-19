'use client';
import { useEffect, useState } from 'react';
import { Artwork } from '@/lib/gallery/types';
import PrivateReleasesForm from './PrivateReleasesForm';

function timeLeft(target: string) {
  const diff = new Date(target).getTime() - Date.now();
  if (diff <= 0) return null;
  const days = Math.floor(diff / (1000 * 60 * 60 * 24));
  const hours = Math.floor((diff / (1000 * 60 * 60)) % 24);
  const minutes = Math.floor((diff / (1000 * 60)) % 60);
  const seconds = Math.floor((diff / 1000) % 60);
  return { days, hours, minutes, seconds };
}

function formatReveal(target: string) {
  return new Date(target).toLocaleString('en-US', {
    month: 'long',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    timeZoneName: 'short',
  });
}

export default function UpcomingReveal({ artwork }: { artwork: Artwork }) {
  const [left, setLeft] = useState<ReturnType<typeof timeLeft>>(null);

  useEffect(() => {
    if (!artwork.release_at) return;
    const update = () => setLeft(timeLeft(artwork.release_at!));
    update();
    const interval = setInterval(update, 1000);
    return () => clearInterval(interval);
  }, [artwork.release_at]);

  if (!artwork.release_at) return null;

  return (
    <div className="relative overflow-hidden mb-20" style={{ background: 'var(--g-charcoal)' }}>
      <div className="grid grid-cols-1 md:grid-cols-12">
        <div className="md:col-span-6 relative min-h-[50vh]">
          {artwork.silhouette_image_url ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={artwork.silhouette_image_url}
              alt="A new work, obscured until its reveal"
              className="w-full h-full object-cover"
              style={{ filter: 'brightness(0.35) grayscale(1)' }}
            />
          ) : (
            <div className="w-full h-full" style={{ background: 'var(--g-black)' }} />
          )}
        </div>
        <div className="md:col-span-6 p-10 sm:p-16 flex flex-col justify-center">
          <p className="g-label mb-5">New Work</p>
          <h3 className="g-serif text-[clamp(1.6rem,3vw,2.4rem)] mb-6">Revealing {formatReveal(artwork.release_at)}</h3>

          {left ? (
            <div className="flex gap-8 mb-10 num">
              {[
                { v: left.days, l: 'Days' },
                { v: left.hours, l: 'Hours' },
                { v: left.minutes, l: 'Min' },
                { v: left.seconds, l: 'Sec' },
              ].map((c) => (
                <div key={c.l}>
                  <div className="g-serif text-3xl sm:text-4xl tabular-nums">{String(c.v).padStart(2, '0')}</div>
                  <div className="g-label mt-1">{c.l}</div>
                </div>
              ))}
            </div>
          ) : (
            <p className="mb-10" style={{ color: 'var(--g-text-muted)' }}>Revealing shortly.</p>
          )}

          <p className="g-label mb-4">Request Early Access</p>
          <PrivateReleasesForm source={`release-${artwork.slug}`} />
        </div>
      </div>
    </div>
  );
}
