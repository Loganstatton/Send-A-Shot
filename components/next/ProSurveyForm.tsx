'use client';
import { useState } from 'react';

const inputStyle: React.CSSProperties = { border: '1px solid var(--border-soft)', background: 'var(--bg)', color: 'var(--text)' };

type Initial = { features: string[]; topFeature: string; intent: string; tooCheap: string; bargain: string; expensive: string; tooExpensive: string; comment: string };

export default function ProSurveyForm({ features, intents, initial }: { features: Record<string, string>; intents: Record<string, string>; initial: Initial }) {
  const [v, setV] = useState(initial);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const set = (k: keyof Initial, val: any) => { setV((s) => ({ ...s, [k]: val })); setSaved(false); };
  const toggle = (f: string) => set('features', v.features.includes(f) ? v.features.filter((x) => x !== f) : [...v.features, f]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const res = await fetch('/api/next/pro-interest', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(v) });
    const data = await res.json().catch(() => ({}));
    setBusy(false);
    if (!res.ok) return setError(data.error ?? 'Something went wrong.');
    setSaved(true);
  }

  const priceField = (k: 'tooCheap' | 'bargain' | 'expensive' | 'tooExpensive', label: string) => (
    <div>
      <label htmlFor={`pro-${k}`} className="text-sm block mb-1.5">{label}</label>
      <div className="flex items-center gap-1.5">
        <span aria-hidden="true" style={{ color: 'var(--text-faint)' }}>$</span>
        <input id={`pro-${k}`} type="number" inputMode="decimal" min={0} max={100} step="0.01" className="w-28 rounded-[10px] px-3 py-2 text-sm" style={inputStyle} value={v[k]} onChange={(e) => set(k, e.target.value)} />
        <span className="text-xs" style={{ color: 'var(--text-faint)' }}>/ month</span>
      </div>
    </div>
  );

  return (
    <form onSubmit={submit} className="next-card p-6 flex flex-col gap-6">
      <fieldset className="border-0 p-0 m-0 flex flex-col gap-2">
        <legend className="text-sm font-semibold mb-2">Which of these would you actually use? (pick any)</legend>
        {Object.entries(features).map(([k, label]) => (
          <label key={k} className="flex items-start gap-2.5 text-sm cursor-pointer">
            <input type="checkbox" className="mt-1" checked={v.features.includes(k)} onChange={() => toggle(k)} />
            <span>{label}</span>
          </label>
        ))}
      </fieldset>

      <div>
        <label htmlFor="pro-top" className="text-sm font-semibold block mb-1.5">Which one matters most?</label>
        <select id="pro-top" className="rounded-[10px] px-3 py-2 text-sm w-full" style={inputStyle} value={v.topFeature} onChange={(e) => set('topFeature', e.target.value)}>
          <option value="">— None of them —</option>
          {Object.entries(features).map(([k, label]) => <option key={k} value={k}>{label}</option>)}
        </select>
      </div>

      <fieldset className="border-0 p-0 m-0">
        <legend className="text-sm font-semibold mb-2">If NEXT Pro had the features you picked for $7.99/month, would you pay for it?</legend>
        <div className="flex gap-2 flex-wrap">
          {Object.entries(intents).map(([k, label]) => (
            <label key={k} className={`next-pill cursor-pointer ${v.intent === k ? 'next-pill-active' : ''}`}>
              <input type="radio" name="intent" value={k} checked={v.intent === k} onChange={() => set('intent', k)} className="sr-only" required />
              {label}
            </label>
          ))}
        </div>
      </fieldset>

      <fieldset className="border-0 p-0 m-0 flex flex-col gap-3">
        <legend className="text-sm font-semibold mb-1">What price would feel… (optional, monthly)</legend>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          {priceField('tooCheap', 'So cheap you’d doubt the quality')}
          {priceField('bargain', 'A bargain — a great deal')}
          {priceField('expensive', 'Getting expensive, but you’d consider it')}
          {priceField('tooExpensive', 'Too expensive to consider')}
        </div>
      </fieldset>

      <div>
        <label htmlFor="pro-comment" className="text-sm font-semibold block mb-1.5">Anything you’d want in Pro that isn’t listed?</label>
        <textarea id="pro-comment" className="w-full min-h-[70px] rounded-[10px] px-3.5 py-2.5 text-sm" style={inputStyle} value={v.comment} onChange={(e) => set('comment', e.target.value)} maxLength={1000} />
      </div>

      {error && <p role="alert" className="m-0 text-sm" style={{ color: 'var(--down)' }}>{error}</p>}
      {saved && <p role="status" className="m-0 text-sm font-semibold" style={{ color: 'var(--up)' }}>Thanks — saved. You can change your answers any time.</p>}
      <button type="submit" disabled={busy} className="next-btn-primary w-fit px-5 py-2.5 rounded-[10px] text-sm font-semibold">{busy ? 'Saving…' : 'Save my answers'}</button>
    </form>
  );
}
