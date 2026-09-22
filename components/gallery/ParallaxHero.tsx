'use client';
import { useEffect, useRef } from 'react';
import Link from 'next/link';
import { Artwork } from '@/lib/gallery/types';

// Full-screen cinematic hero. Movement is intentionally tiny — a few
// pixels of translate driven by scroll position and mouse position,
// rAF-throttled, and switched off entirely under prefers-reduced-motion.
export default function ParallaxHero({ artwork, artistName }: { artwork: Artwork | null; artistName: string }) {
  const imgRef = useRef<HTMLDivElement>(null);
  const raf = useRef<number>();
  const target = useRef({ x: 0, y: 0 });
  const current = useRef({ x: 0, y: 0 });

  useEffect(() => {
    const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (reduceMotion) return;

    function onMouseMove(e: MouseEvent) {
      const nx = (e.clientX / window.innerWidth - 0.5) * 2;
      const ny = (e.clientY / window.innerHeight - 0.5) * 2;
      target.current = { x: nx * 10, y: ny * 8 };
    }
    function onScroll() {
      const scrollY = window.scrollY;
      target.current = { ...target.current, y: target.current.y - scrollY * 0.04 };
    }

    function tick() {
      current.current.x += (target.current.x - current.current.x) * 0.06;
      current.current.y += (target.current.y - current.current.y) * 0.06;
      if (imgRef.current) {
        imgRef.current.style.transform = `translate3d(${current.current.x}px, ${current.current.y}px, 0) scale(1.08)`;
      }
      raf.current = requestAnimationFrame(tick);
    }

    window.addEventListener('mousemove', onMouseMove, { passive: true });
    window.addEventListener('scroll', onScroll, { passive: true });
    raf.current = requestAnimationFrame(tick);
    return () => {
      window.removeEventListener('mousemove', onMouseMove);
      window.removeEventListener('scroll', onScroll);
      if (raf.current) cancelAnimationFrame(raf.current);
    };
  }, []);

  return (
    <section className="relative h-[100svh] w-full overflow-hidden" style={{ background: 'var(--g-black)' }}>
      <div ref={imgRef} className="absolute inset-0 motion-reduce:!transform-none" style={{ transform: 'scale(1.08)' }}>
        {artwork?.hero_image_url ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={artwork.hero_image_url}
            alt={`${artwork.title}, ${artwork.medium}, ${artwork.year}`}
            className="w-full h-full object-cover"
            style={{ filter: 'brightness(0.62)' }}
          />
        ) : (
          <div className="w-full h-full" style={{ background: 'var(--g-charcoal)' }} />
        )}
      </div>
      <div className="absolute inset-0" style={{ background: 'linear-gradient(180deg, oklch(0% 0 0 / 0.15) 0%, transparent 35%, transparent 60%, oklch(0% 0 0 / 0.65) 100%)' }} />

      <div className="relative h-full flex flex-col items-center justify-center text-center px-6">
        <p className="g-label text-[var(--g-offwhite)] opacity-80 mb-6">{artistName}</p>
        <h1 className="g-serif italic text-[clamp(1.4rem,3.4vw,2.6rem)] leading-snug max-w-2xl text-[var(--g-offwhite)]">
          Original drawings of the moments in Scripture that hit hardest — and get talked about least.
        </h1>
        <Link href="/gallery/works" className="g-btn mt-12">View the Collection</Link>
      </div>

      <div className="absolute bottom-8 left-1/2 -translate-x-1/2 flex flex-col items-center gap-2 opacity-60">
        <span className="g-label text-[10px]">Scroll</span>
        <span className="block w-px h-10" style={{ background: 'var(--g-line)' }} />
      </div>
    </section>
  );
}
