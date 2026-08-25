'use client';
import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { formatCents } from '@/lib/format';

const STEPS = ['welcome', 'score-price', 'how-to', 'go'] as const;
type Step = (typeof STEPS)[number];

// First-login walkthrough for NEXT. Shown once — see completeNextOnboarding
// in lib/db.ts, which is idempotent by design. After this, InfoTip.tsx is
// how a user looks a term back up without re-running the whole thing.
export default function NextOnboarding({ startingCreditsCents }: { startingCreditsCents: number }) {
  const router = useRouter();
  const [dismissed, setDismissed] = useState(false);
  const [stepIndex, setStepIndex] = useState(0);
  const [finishing, setFinishing] = useState(false);
  const step: Step = STEPS[stepIndex];

  async function finish() {
    if (finishing) return;
    setFinishing(true);
    setDismissed(true); // hide immediately — don't make the user wait on the network
    try {
      await fetch('/api/next/onboarding/complete', { method: 'POST' });
    } catch {
      // Best-effort — worst case the walkthrough shows again next login,
      // which is harmless, not a reason to block the user here.
    }
  }

  function goDiscoverFirstArtist() {
    finish();
    // Feed is the default logged-in home screen after onboarding — Discover
    // (still one tap away in the nav) stays deliberate marketplace browsing.
    router.push('/next/feed');
  }

  if (dismissed) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      style={{ background: 'oklch(10% 0.01 40 / 0.72)', backdropFilter: 'blur(4px)' }}
    >
      <div className="next-card w-full max-w-[440px] p-7 sm:p-8 relative" style={{ background: 'var(--surface)' }}>
        <button
          type="button"
          onClick={finish}
          className="absolute top-5 right-5 text-[12px]"
          style={{ color: 'var(--text-faint)' }}
        >
          Skip
        </button>

        {step === 'welcome' && (
          <>
            <div className="flex items-baseline gap-0.5 font-display font-extrabold text-[20px] mb-5">
              <span>NEXT</span>
              <span className="w-1.5 h-1.5 rounded-full bg-[var(--ember)] self-center ml-1 shadow-[0_0_12px_var(--ember)]" />
            </div>
            <h2 className="font-display font-bold text-[24px] mb-3 leading-tight">Welcome — here's your starting balance.</h2>
            <div
              className="rounded-[12px] px-4 py-3.5 mb-4 flex items-center justify-between"
              style={{ background: 'var(--ember-dim)', border: '1px solid var(--ember-line)' }}
            >
              <span className="text-[13px]" style={{ color: 'var(--on-ember-soft)' }}>Your NEXT Credits</span>
              <span className="num font-bold text-[19px]" style={{ color: 'var(--ember)' }}>{formatCents(startingCreditsCents)}</span>
            </div>
            <p className="text-[13.5px] leading-relaxed" style={{ color: 'var(--text-muted)' }}>
              Every account starts with the same virtual balance to back artists with. <strong style={{ color: 'var(--text)' }}>NEXT Credits aren't real money</strong> — nothing here can be withdrawn or cashed out. It's a way to prove you can spot an artist early, not an investment.
            </p>
          </>
        )}

        {step === 'score-price' && (
          <>
            <h2 className="font-display font-bold text-[24px] mb-4 leading-tight">Two numbers drive everything.</h2>
            <div className="flex flex-col gap-3 mb-4">
              <div className="rounded-[12px] p-4" style={{ background: 'var(--surface-2)', border: '1px solid var(--border-soft)' }}>
                <div className="text-[11px] font-mono mb-1" style={{ color: 'var(--text-faint)' }}>NEXT SCORE</div>
                <p className="text-[13px] m-0" style={{ color: 'var(--text-muted)' }}>Our read on an artist's real momentum — growth, engagement, and buzz, boiled down to one number.</p>
              </div>
              <div className="rounded-[12px] p-4" style={{ background: 'var(--surface-2)', border: '1px solid var(--border-soft)' }}>
                <div className="text-[11px] font-mono mb-1" style={{ color: 'var(--text-faint)' }}>NEXT PRICE</div>
                <p className="text-[13px] m-0" style={{ color: 'var(--text-muted)' }}>What the market — everyone else's trades — currently thinks that artist is worth.</p>
              </div>
            </div>
            <p className="text-[13.5px] leading-relaxed" style={{ color: 'var(--text-muted)' }}>
              When Score runs ahead of Price, that's a signal — the artist is <strong style={{ color: 'var(--ember)' }}>undervalued</strong>, and the market hasn't caught up yet. That gap is the whole game.
            </p>
          </>
        )}

        {step === 'how-to' && (
          <>
            <h2 className="font-display font-bold text-[24px] mb-5 leading-tight">Three things you'll do a lot.</h2>
            <div className="flex flex-col gap-4">
              <div className="flex items-start gap-3">
                <span className="w-8 h-8 rounded-full flex items-center justify-center shrink-0" style={{ background: 'var(--surface-2)', border: '1px solid var(--border-soft)' }}>
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="var(--ember)"><path d="M6 4 20 12 6 20Z" /></svg>
                </span>
                <p className="text-[13px] m-0 pt-1.5" style={{ color: 'var(--text-muted)' }}><strong style={{ color: 'var(--text)' }}>Listen</strong> — every artist card has a preview. Hear them before you back them.</p>
              </div>
              <div className="flex items-start gap-3">
                <span className="w-8 h-8 rounded-full flex items-center justify-center shrink-0" style={{ background: 'var(--surface-2)', border: '1px solid var(--border-soft)' }}>
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="var(--ember)" strokeWidth={2}><path d="M6 3h12a1 1 0 0 1 1 1v17l-7-4-7 4V4a1 1 0 0 1 1-1Z" /></svg>
                </span>
                <p className="text-[13px] m-0 pt-1.5" style={{ color: 'var(--text-muted)' }}><strong style={{ color: 'var(--text)' }}>Watchlist</strong> — not ready to back someone yet? Save them and track the gap over time.</p>
              </div>
              <div className="flex items-start gap-3">
                <span className="w-8 h-8 rounded-full flex items-center justify-center shrink-0" style={{ background: 'var(--surface-2)', border: '1px solid var(--border-soft)' }}>
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="var(--ember)" strokeWidth={2}><path d="M3 17 9 11l4 4 8-8" /><path d="M15 7h6v6" /></svg>
                </span>
                <p className="text-[13px] m-0 pt-1.5" style={{ color: 'var(--text-muted)' }}><strong style={{ color: 'var(--text)' }}>Back an artist</strong> — spend some Credits on the ones you believe in. You can sell anytime.</p>
              </div>
            </div>
          </>
        )}

        {step === 'go' && (
          <>
            <h2 className="font-display font-bold text-[24px] mb-3 leading-tight">You're ready.</h2>
            <p className="text-[13.5px] leading-relaxed mb-6" style={{ color: 'var(--text-muted)' }}>
              Go find someone worth backing before everyone else catches on.
            </p>
            <button type="button" onClick={goDiscoverFirstArtist} className="next-btn-primary w-full text-center py-3 rounded-[10px] text-[14px] font-bold">
              Discover your first artist
            </button>
          </>
        )}

        <div className="flex items-center justify-between mt-7">
          <div className="flex items-center gap-1.5">
            {STEPS.map((s, i) => (
              <span
                key={s}
                className="h-1.5 rounded-full transition-all"
                style={{ width: i === stepIndex ? '18px' : '6px', background: i === stepIndex ? 'var(--ember)' : 'var(--border)' }}
              />
            ))}
          </div>
          {step !== 'go' && (
            <div className="flex items-center gap-2">
              {stepIndex > 0 && (
                <button type="button" onClick={() => setStepIndex((i) => i - 1)} className="next-btn-ghost px-4 py-2 rounded-[9px] text-[13px] font-semibold">
                  Back
                </button>
              )}
              <button type="button" onClick={() => setStepIndex((i) => i + 1)} className="next-btn-primary px-5 py-2 rounded-[9px] text-[13px] font-bold">
                Next
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
