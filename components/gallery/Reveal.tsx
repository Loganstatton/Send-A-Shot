'use client';
import { useEffect, useRef, useState } from 'react';

// Restrained scroll-reveal: a slow fade + slight rise, once, respecting
// prefers-reduced-motion (handled in gallery-theme.css's .g-fade-in rule).
export default function Reveal({
  children,
  className = '',
  delayMs = 0,
}: {
  children: React.ReactNode;
  className?: string;
  delayMs?: number;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          window.setTimeout(() => setVisible(true), delayMs);
          observer.disconnect();
        }
      },
      { threshold: 0.15 }
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, [delayMs]);

  return (
    <div ref={ref} className={`g-fade-in ${visible ? 'g-visible' : ''} ${className}`}>
      {children}
    </div>
  );
}
