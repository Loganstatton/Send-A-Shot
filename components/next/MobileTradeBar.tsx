'use client';
import { formatCents } from '@/lib/format';

// The full TradePanel already lives at the bottom of the page's single
// mobile column — on a real phone that's 3-4 screens of scrolling past the
// price chart, score chart, and momentum stats before a trade is even
// reachable. Rather than duplicate the trade form (and its balance/
// ownership validation) in a second place, this is a thin, always-visible
// bar that jumps straight to the real one — "sticky trade controls"
// without a second source of truth for what a trade actually does.
// lg:hidden because the desktop two-column layout already keeps
// TradePanel visible via its own `sticky top-6`.
export default function MobileTradeBar({ artistName, priceCents, changePct }: { artistName: string; priceCents: number; changePct: number }) {
  function scrollToTrade() {
    document.getElementById('trade-panel')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  return (
    <div
      className="lg:hidden fixed left-0 right-0 bottom-0 z-30 flex items-center justify-between gap-3 px-4 py-3"
      style={{ background: 'oklch(12% 0.014 40 / 0.92)', backdropFilter: 'blur(10px)', borderTop: '1px solid var(--border-soft)' }}
    >
      <div className="min-w-0">
        <div className="text-[11px] truncate" style={{ color: 'var(--text-faint)' }}>{artistName}</div>
        <div className="flex items-center gap-1.5">
          <span className="num text-[15px] font-bold">{formatCents(priceCents)}</span>
          <span className="num text-[11px] font-semibold" style={{ color: changePct >= 0 ? 'var(--up)' : 'var(--down)' }}>
            {changePct >= 0 ? '+' : ''}{changePct.toFixed(1)}%
          </span>
        </div>
      </div>
      <button
        type="button"
        onClick={scrollToTrade}
        className="next-btn-primary text-sm font-bold px-6 py-3 rounded-xl shrink-0"
        style={{ background: 'var(--ember)', color: 'var(--on-ember)' }}
      >
        Trade
      </button>
    </div>
  );
}
