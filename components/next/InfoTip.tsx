'use client';
import { useState, useRef, useEffect } from 'react';

// A small "what does this mean" affordance for NEXT's own vocabulary
// (Score, Price, the gap between them). This is the thing that lets a
// user skip/close onboarding and still look a term up later without
// re-running the whole walkthrough — see NextOnboarding.tsx.
export default function InfoTip({ text, label }: { text: string; label?: string }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    if (!open) return;
    function onDocClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener('click', onDocClick);
    return () => document.removeEventListener('click', onDocClick);
  }, [open]);

  return (
    <span ref={ref} className="relative inline-flex items-center">
      <button
        type="button"
        aria-label={label ? `What is ${label}?` : 'More info'}
        onClick={(e) => {
          e.preventDefault();
          e.stopPropagation();
          setOpen((o) => !o);
        }}
        className="w-5 h-5 rounded-full flex items-center justify-center shrink-0"
        style={{ background: 'var(--surface-2)', border: '1px solid var(--border-soft)', color: 'var(--text-faint)' }}
      >
        <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={3}>
          <circle cx="12" cy="8" r="0.5" />
          <path d="M12 11v6" strokeLinecap="round" />
        </svg>
      </button>
      {open && (
        <span
          role="tooltip"
          onClick={(e) => e.stopPropagation()}
          className="absolute z-20 left-1/2 -translate-x-1/2 top-[calc(100%+8px)] w-[220px] text-[11.5px] leading-snug rounded-[10px] px-3 py-2.5 shadow-lg"
          style={{ background: 'var(--surface)', border: '1px solid var(--border)', color: 'var(--text-muted)' }}
        >
          {text}
        </span>
      )}
    </span>
  );
}
