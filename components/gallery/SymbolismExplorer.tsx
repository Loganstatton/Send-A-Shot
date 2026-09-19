'use client';
import { useState } from 'react';
import { SymbolismHotspot } from '@/lib/gallery/types';

export default function SymbolismExplorer({ imageUrl, alt, hotspots }: { imageUrl: string; alt: string; hotspots: SymbolismHotspot[] }) {
  const [activeId, setActiveId] = useState<number | null>(null);
  const active = hotspots.find((h) => h.id === activeId) ?? null;

  return (
    <div className="grid grid-cols-1 md:grid-cols-12 gap-8 md:gap-16 items-start">
      <div className="md:col-span-7 relative">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={imageUrl} alt={alt} className="w-full" />
        {hotspots.map((h) => (
          <button
            key={h.id}
            className="g-hotspot"
            style={{ left: `${h.x_pct}%`, top: `${h.y_pct}%` }}
            data-active={activeId === h.id}
            aria-label={h.label}
            onMouseEnter={() => setActiveId(h.id)}
            onFocus={() => setActiveId(h.id)}
            onClick={(e) => {
              e.stopPropagation();
              setActiveId((cur) => (cur === h.id ? null : h.id));
            }}
          />
        ))}
      </div>

      <div className="md:col-span-5 min-h-[8rem]">
        {active ? (
          <div key={active.id}>
            <p className="g-label mb-3">{active.label}</p>
            <p className="g-serif italic text-xl leading-relaxed" style={{ color: 'var(--g-text-muted)' }}>{active.description}</p>
          </div>
        ) : (
          <p style={{ color: 'var(--g-gray-faint)' }}>Hover or select a mark on the drawing to reveal what it holds.</p>
        )}
      </div>
    </div>
  );
}
