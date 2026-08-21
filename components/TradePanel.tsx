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

  return (
    <div className="card space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <h2 className="font-semibold text-lg">Trade</h2>
        <span className="text-sm text-neutral-400">
          Balance: <strong className="text-white">{formatCents(creditsCents)}</strong> NEXT Credits
        </span>
      </div>

      {ownedShares > 0 && (
        <div className="text-sm border border-neutral-800 rounded-lg p-3 space-y-1">
          <div className="flex justify-between"><span className="text-neutral-400">Shares owned</span><span>{ownedShares.toFixed(4)}</span></div>
          <div className="flex justify-between"><span className="text-neutral-400">Avg cost</span><span>{formatCents(ownedShares > 0 ? costBasisCents / ownedShares : 0)}</span></div>
          <div className="flex justify-between"><span className="text-neutral-400">Market value</span><span>{formatCents(marketValueCents)}</span></div>
          <div className="flex justify-between">
            <span className="text-neutral-400">Unrealized P&amp;L</span>
            <span className={unrealizedPnlCents >= 0 ? 'text-emerald-400' : 'text-red-400'}>
              {unrealizedPnlCents >= 0 ? '+' : ''}{formatCents(unrealizedPnlCents)}
            </span>
          </div>
        </div>
      )}

      <div className="flex gap-2">
        <button type="button" className={`btn flex-1 ${mode === 'buy' ? 'btn-primary' : ''}`} onClick={() => setMode('buy')}>Buy</button>
        <button type="button" className={`btn flex-1 ${mode === 'sell' ? 'bg-red-600 text-white' : ''}`} onClick={() => setMode('sell')} disabled={ownedShares <= 0}>Sell</button>
      </div>

      <form onSubmit={handleTrade} className="space-y-2">
        <label className="label">{mode === 'buy' ? 'Spend' : 'Sell'} (NEXT Credits $)</label>
        <input
          type="number"
          step="0.01"
          min="0.01"
          className="input"
          value={dollars}
          onChange={(e) => setDollars(e.target.value)}
        />
        <div className="flex gap-2 flex-wrap">
          {PRESETS_BUY.map((amt) => (
            <button key={amt} type="button" className="btn text-xs px-2 py-1" onClick={() => setDollars(String(amt))}>${amt}</button>
          ))}
          <button type="button" className="btn text-xs px-2 py-1" onClick={setMax}>MAX</button>
        </div>

        {hasAmount && (
          <div className="text-xs text-neutral-400 border border-neutral-800 rounded-lg p-3 space-y-1 mt-2">
            <div className="flex justify-between"><span>You&apos;re {mode === 'buy' ? 'buying' : 'selling'} approximately</span><span className="text-white">{estimatedShares.toFixed(4)} shares</span></div>
            <div className="flex justify-between"><span>Average execution</span><span className="text-white">{formatCents(executionCents)}</span></div>
            <div className="flex justify-between"><span>Estimated price after trade</span><span className="text-white">{formatCents(postTradePriceCents)}</span></div>
            <div className="flex justify-between"><span>Available credits after</span><span className="text-white">{formatCents(Math.max(0, creditsAfterCents))}</span></div>
          </div>
        )}

        {error && <p className="text-sm text-red-300">{error}</p>}
        <button type="submit" className={`btn w-full ${mode === 'buy' ? 'btn-primary' : 'bg-red-600 text-white'}`} disabled={saving}>
          {saving ? 'Placing order…' : mode === 'buy' ? 'Back this artist' : 'Sell'}
        </button>
        {ownedShares > 0 && mode === 'sell' && (
          <button type="button" className="btn w-full text-sm" onClick={sellAll}>Sell all</button>
        )}
      </form>

      <p className="text-xs text-neutral-500">
        NEXT Credits are virtual — no real monetary value. Price moves ~5% per $10,000 traded on one side.
      </p>
    </div>
  );
}
