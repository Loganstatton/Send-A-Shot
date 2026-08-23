'use client';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { formatCents } from '@/lib/format';
import { applyTradeImpact, executionPriceCents } from '@/lib/next-market';

const PRESETS_BUY = [25, 50, 100, 500];

export default function TradePanel({
  artistId,
  priceCents,
  ownedShares,
  costBasisCents,
  creditsCents,
}: {
  artistId: number;
  priceCents: number;
  ownedShares: number;
  costBasisCents: number;
  creditsCents: number;
}) {
  const router = useRouter();
  const [mode, setMode] = useState<'buy' | 'sell'>('buy');
  const [dollars, setDollars] = useState('100');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const marketValueCents = Math.round(ownedShares * priceCents);
  const unrealizedPnlCents = marketValueCents - costBasisCents;

  const amountCents = Math.round((Number(dollars) || 0) * 100);
  const hasAmount = amountCents > 0;
  const postTradePriceCents = hasAmount ? applyTradeImpact(priceCents, amountCents, mode === 'buy' ? 'buy' : 'sell') : priceCents;
  const executionCents = hasAmount ? executionPriceCents(priceCents, postTradePriceCents) : priceCents;
  const estimatedShares = hasAmount ? amountCents / executionCents : 0;
  const creditsAfterCents = mode === 'buy' ? creditsCents - amountCents : creditsCents + Math.round(estimatedShares * executionCents);

  async function handleTrade(e: React.FormEvent) {
    e.preventDefault();
    const amount = Number(dollars);
    if (!amount || amount <= 0) return;
    setSaving(true);
    setError(null);
    try {
      const res = await fetch(`/api/next/artists/${artistId}/trade`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ type: mode, credits_amount_cents: Math.round(amount * 100) }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? 'Trade failed');
      router.refresh();
    } catch (err: any) {
      setError(err.message ?? 'Trade failed');
    } finally {
      setSaving(false);
    }
  }

  function sellAll() {
    setMode('sell');
    setDollars((marketValueCents / 100).toFixed(2));
  }

  function setMax() {
    if (mode === 'buy') setDollars((creditsCents / 100).toFixed(2));
    else setDollars((marketValueCents / 100).toFixed(2));
  }

  const row = 'flex justify-between';
  const rowLabel = { color: 'var(--text-faint)' };

  return (
    <div className="next-card p-[22px] flex flex-col gap-4 sticky top-6">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <h2 className="font-display font-bold text-[17px] m-0">Trade</h2>
        <span className="text-[12.5px]" style={{ color: 'var(--text-faint)' }}>
          Balance <span className="num font-semibold" style={{ color: 'var(--text)' }}>{formatCents(creditsCents)}</span>
        </span>
      </div>

      {ownedShares > 0 && (
        <div className="text-[13px] rounded-xl border p-3 flex flex-col gap-1.5" style={{ borderColor: 'var(--border-soft)' }}>
          <div className={row}><span style={rowLabel}>Shares owned</span><span className="num">{ownedShares.toFixed(4)}</span></div>
          <div className={row}><span style={rowLabel}>Avg cost</span><span className="num">{formatCents(ownedShares > 0 ? costBasisCents / ownedShares : 0)}</span></div>
          <div className={row}><span style={rowLabel}>Market value</span><span className="num">{formatCents(marketValueCents)}</span></div>
          <div className={row}>
            <span style={rowLabel}>Unrealized P&amp;L</span>
            <span className="num" style={{ color: unrealizedPnlCents >= 0 ? 'var(--up)' : 'var(--down)' }}>
              {unrealizedPnlCents >= 0 ? '+' : ''}{formatCents(unrealizedPnlCents)}
            </span>
          </div>
        </div>
      )}

      <div className="flex gap-2">
        <button
          type="button"
          className="flex-1 text-center py-2.5 rounded-[10px] text-[13.5px] font-bold"
          style={mode === 'buy' ? { background: 'var(--ember)', color: 'var(--on-ember)' } : { border: '1px solid var(--border-soft)', color: 'var(--text-muted)' }}
          onClick={() => setMode('buy')}
        >
          Buy
        </button>
        <button
          type="button"
          className="flex-1 text-center py-2.5 rounded-[10px] text-[13.5px] font-bold disabled:opacity-40"
          style={mode === 'sell' ? { background: 'var(--down)', color: 'var(--on-ember)' } : { border: '1px solid var(--border-soft)', color: 'var(--text-muted)' }}
          onClick={() => setMode('sell')}
          disabled={ownedShares <= 0}
        >
          Sell
        </button>
      </div>

      <form onSubmit={handleTrade} className="flex flex-col gap-2">
        <label className="text-[12.5px]" style={rowLabel}>{mode === 'buy' ? 'Spend' : 'Sell'} (NEXT Credits $)</label>
        <input
          type="number"
          step="0.01"
          min="0.01"
          className="num rounded-[10px] px-3.5 py-3 text-lg font-semibold outline-none"
          style={{ border: '1px solid var(--ember-line)', background: 'var(--bg)', color: 'var(--text)' }}
          value={dollars}
          onChange={(e) => setDollars(e.target.value)}
        />
        <div className="flex gap-1.5 flex-wrap">
          {PRESETS_BUY.map((amt) => (
            <button
              key={amt}
              type="button"
              className="px-3 py-[5px] rounded-full text-xs"
              style={{ border: '1px solid var(--border-soft)', color: 'var(--text-muted)' }}
              onClick={() => setDollars(String(amt))}
            >
              ${amt}
            </button>
          ))}
          <button
            type="button"
            className="px-3 py-[5px] rounded-full text-xs"
            style={{ background: 'var(--surface-2)', border: '1px solid var(--border)', color: 'var(--text)' }}
            onClick={setMax}
          >
            MAX
          </button>
        </div>

        {hasAmount && (
          <div className="text-[12.5px] rounded-xl p-3 flex flex-col gap-1.5 mt-1" style={{ background: 'var(--surface-2)' }}>
            <div className={row}><span style={rowLabel}>You&apos;re {mode === 'buy' ? 'buying' : 'selling'} approximately</span><span className="num" style={{ color: 'var(--text)' }}>{estimatedShares.toFixed(4)} shares</span></div>
            <div className={row}><span style={rowLabel}>Average execution</span><span className="num" style={{ color: 'var(--text)' }}>{formatCents(executionCents)}</span></div>
            <div className={row}><span style={rowLabel}>Estimated price after trade</span><span className="num" style={{ color: 'var(--text)' }}>{formatCents(postTradePriceCents)}</span></div>
            <div className={row}><span style={rowLabel}>Available credits after</span><span className="num" style={{ color: 'var(--text)' }}>{formatCents(Math.max(0, creditsAfterCents))}</span></div>
          </div>
        )}

        {error && <p className="text-sm" style={{ color: 'var(--down)' }}>{error}</p>}
        <button
          type="submit"
          className="text-center py-[13px] rounded-xl text-[14.5px] font-bold disabled:opacity-60"
          style={
            mode === 'buy'
              ? { background: 'var(--ember)', color: 'var(--on-ember)', boxShadow: '0 8px 24px -8px var(--ember-line)' }
              : { background: 'var(--down)', color: 'var(--on-ember)' }
          }
          disabled={saving}
        >
          {saving ? 'Placing order…' : mode === 'buy' ? 'Back this artist' : 'Sell'}
        </button>
        {ownedShares > 0 && mode === 'sell' && (
          <button type="button" className="next-btn-ghost text-sm py-2 rounded-[10px]" onClick={sellAll}>Sell all</button>
        )}
      </form>

      <p className="text-[11px] leading-relaxed m-0" style={{ color: 'var(--text-faint)' }}>
        NEXT Credits are virtual — no real monetary value. Price moves ~5% per $10,000 traded on one side.
      </p>
    </div>
  );
}
