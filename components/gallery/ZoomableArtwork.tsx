'use client';
import { useRef, useState } from 'react';

// Click/tap to zoom in close on the pencil marks, then drag (or, on
// mobile, native pinch/scroll within the frame) to study a detail. Kept
// deliberately simple — no gesture library — since the ask is "let
// visitors study the marks closely," not a full pan/zoom editor.
export default function ZoomableArtwork({ src, alt }: { src: string; alt: string }) {
  const [zoomed, setZoomed] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  return (
    <div
      ref={containerRef}
      className={`relative w-full overflow-auto ${zoomed ? 'cursor-zoom-out' : 'cursor-zoom-in'}`}
      style={{ maxHeight: '86svh' }}
      onClick={() => setZoomed((z) => !z)}
    >
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={src}
        alt={alt}
        className="transition-transform duration-700 ease-out mx-auto"
        style={{
          width: zoomed ? '220%' : '100%',
          maxWidth: zoomed ? 'none' : '100%',
        }}
      />
      <span
        className="absolute bottom-4 right-4 g-label px-3 py-1.5 pointer-events-none transition-opacity"
        style={{ background: 'oklch(0% 0 0 / 0.55)', color: 'var(--g-offwhite)', opacity: zoomed ? 0 : 1 }}
      >
        Click to zoom
      </span>
    </div>
  );
}
