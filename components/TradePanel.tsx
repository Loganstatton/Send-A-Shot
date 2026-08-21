'use client';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { formatCents } from '@/lib/format';

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
        {mode === 'buy' && Number(dollars) > 0 && (
          <p className="text-xs text-neutral-500">≈ {(Number(dollars) / (priceCents / 100)).toFixed(4)} shares at {formatCents(priceCents)}</p>
        )}
        {error && <p className="text-sm text-red-300">{error}</p>}
        <button type="submit" className={`btn w-full ${mode === 'buy' ? 'btn-primary' : 'bg-red-600 text-white'}`} disabled={saving}>
          {saving ? 'Placing order…' : mode === 'buy' ? 'Buy' : 'Sell'}
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
