'use client';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { formatCents } from '@/lib/format';
import { applyTradeImpact, executionPriceCents } from '@/lib/next-market';
import { track } from '@/lib/track';

const PRESETS_BUY = [25, 50, 100, 500];

export default function TradePanel({
  artistId,
  artistName,
  priceCents,
  ownedShares,
  costBasisCents,
  creditsCents,
  volumeCents24h,
  recentBackerCount24h,
}: {
  artistId: number;
  artistName: string;
  priceCents: number;
  ownedShares: number;
  costBasisCents: number;
  creditsCents: number;
  volumeCents24h: number;
  recentBackerCount24h: number;
}) {
  const router = useRouter();
  const [mode, setMode] = useState<'buy' | 'sell'>('buy');
  const [dollars, setDollars] = useState('100');
  const [confirming, setConfirming] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  // Generated once per distinct trade attempt (when the confirm screen
  // opens), not per click of "Confirm" — so a retried/duplicated request
  // for the SAME attempt (double-click, a flaky network requiring
  // resubmission) rides the same key and the server returns the original
  // result instead of trading twice. A new key is only drawn the next time
  // startConfirm() runs — i.e. the next genuinely new trade.
  const [idempotencyKey, setIdempotencyKey] = useState<string | null>(null);

  const marketValueCents = Math.round(ownedShares * priceCents);
  const unrealizedPnlCents = marketValueCents - costBasisCents;

  const amountCents = Math.round((Number(dollars) || 0) * 100);
  const hasAmount = amountCents > 0;
  const postTradePriceCents = hasAmount ? applyTradeImpact(priceCents, amountCents, mode === 'buy' ? 'buy' : 'sell') : priceCents;
  const executionCents = hasAmount ? executionPriceCents(priceCents, postTradePriceCents) : priceCents;
  const estimatedShares = hasAmount ? amountCents / executionCents : 0;
  const creditsAfterCents = mode === 'buy' ? creditsCents - amountCents : creditsCents + Math.round(estimatedShares * executionCents);

  // A buy genuinely can't partial-fill past your balance — the server hard
  // -rejects it (see executeTrade) — so this needs to actually block
  // submission, not just show an error after the round trip. A sell that
  // asks for more than you own is different: the server caps it to
  // "sell everything you have" and fills it, which is worth explaining
  // (below) rather than blocking outright.
  const overBalance = mode === 'buy' && hasAmount && amountCents > creditsCents;
  const overOwned = mode === 'sell' && hasAmount && amountCents > marketValueCents;
  const canSubmit = hasAmount && !overBalance && (mode === 'buy' || ownedShares > 0);

  function resetAfterAction() {
    setConfirming(false);
    setError(null);
  }

  function startConfirm(e: React.FormEvent) {
    e.preventDefault();
    if (!canSubmit) return;
    setSuccess(null);
    setConfirming(true);
    setIdempotencyKey(crypto.randomUUID());
    if (mode === 'buy') track('buy_started', { artistId, amountCents });
  }

  async function confirmTrade() {
    setSaving(true);
    setError(null);
    try {
      const res = await fetch(`/api/next/artists/${artistId}/trade`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ type: mode, credits_amount_cents: amountCents, idempotencyKey }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? 'Trade failed');
      setSuccess(
        mode === 'buy'
          ? `Bought ${Number(data.shares).toFixed(4)} shares of ${artistName} at ${formatCents(data.priceCents)}.`
          : `Sold ${Number(data.shares).toFixed(4)} shares of ${artistName} at ${formatCents(data.priceCents)}.`
      );
      setConfirming(false);
      router.refresh();
    } catch (err: any) {
      setError(err.message ?? 'Trade failed');
      setConfirming(false);
    } finally {
      setSaving(false);
    }
  }

  function sellAll() {
    setMode('sell');
    setDollars((marketValueCents / 100).toFixed(2));
    resetAfterAction();
  }

  function setMax() {
    if (mode === 'buy') setDollars((creditsCents / 100).toFixed(2));
    else setDollars((marketValueCents / 100).toFixed(2));
    resetAfterAction();
  }

  const row = 'flex justify-between';
  const rowLabel = { color: 'var(--text-faint)' };

  return (
    <div id="trade-panel" className="next-card p-[22px] flex flex-col gap-4 sticky top-6">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <h2 className="font-display font-bold text-[17px] m-0">Trade</h2>
        <span className="text-[12.5px]" style={{ color: 'var(--text-faint)' }}>
          Balance <span className="num font-semibold" style={{ color: 'var(--text)' }}>{formatCents(creditsCents)}</span>
        </span>
      </div>

      <div className="grid grid-cols-2 gap-2.5 text-[12px]" style={{ color: 'var(--text-faint)' }}>
        <div className="rounded-lg px-3 py-2" style={{ background: 'var(--surface-2)' }}>
          <div>24h volume</div>
          <div className="num text-[14px] font-bold mt-0.5" style={{ color: 'var(--text)' }}>{formatCents(volumeCents24h)}</div>
        </div>
        <div className="rounded-lg px-3 py-2" style={{ background: 'var(--surface-2)' }}>
          <div>Backed recently</div>
          <div className="num text-[14px] font-bold mt-0.5" style={{ color: 'var(--text)' }}>{recentBackerCount24h} {recentBackerCount24h === 1 ? 'person' : 'people'}</div>
        </div>
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

      {success && (
        <div className="text-[13px] rounded-xl border px-3.5 py-3 flex items-center gap-2" style={{ borderColor: 'var(--up)', background: 'oklch(65% 0.16 150 / 0.1)', color: 'var(--up)' }}>
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5} className="shrink-0"><path d="M20 6 9 17l-5-5" /></svg>
          <span>{success}</span>
        </div>
      )}

      <div className="flex gap-2">
        <button
          type="button"
          className="flex-1 text-center py-2.5 rounded-[10px] text-[13.5px] font-bold"
          style={mode === 'buy' ? { background: 'var(--ember)', color: 'var(--on-ember)' } : { border: '1px solid var(--border-soft)', color: 'var(--text-muted)' }}
          onClick={() => { setMode('buy'); resetAfterAction(); }}
        >
          Buy
        </button>
        <button
          type="button"
          className="flex-1 text-center py-2.5 rounded-[10px] text-[13.5px] font-bold disabled:opacity-40"
          style={mode === 'sell' ? { background: 'var(--down)', color: 'var(--on-ember)' } : { border: '1px solid var(--border-soft)', color: 'var(--text-muted)' }}
          onClick={() => { setMode('sell'); resetAfterAction(); }}
          disabled={ownedShares <= 0}
        >
          Sell
        </button>
      </div>

      {!confirming ? (
        <form onSubmit={startConfirm} className="flex flex-col gap-2">
          <label className="text-[12.5px]" style={rowLabel}>{mode === 'buy' ? 'Spend' : 'Sell'} (NEXT Credits $)</label>
          <input
            type="number"
            inputMode="decimal"
            step="0.01"
            min="0.01"
            className="num rounded-[10px] px-3.5 py-3 text-lg font-semibold outline-none"
            style={{ border: `1px solid ${overBalance ? 'var(--down)' : 'var(--ember-line)'}`, background: 'var(--bg)', color: 'var(--text)' }}
            value={dollars}
            onChange={(e) => { setDollars(e.target.value); setSuccess(null); }}
          />
          <div className="flex gap-1.5 flex-wrap">
            {PRESETS_BUY.map((amt) => (
              <button
                key={amt}
                type="button"
                className="px-3 py-[5px] rounded-full text-xs"
                style={{ border: '1px solid var(--border-soft)', color: 'var(--text-muted)' }}
                onClick={() => { setDollars(String(amt)); setSuccess(null); }}
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

          {overBalance && (
            <p className="text-[12.5px] m-0" style={{ color: 'var(--down)' }}>
              That&apos;s more than your {formatCents(creditsCents)} balance — lower the amount or hit MAX.
            </p>
          )}
          {overOwned && (
            <p className="text-[12.5px] m-0" style={{ color: 'var(--text-faint)' }}>
              You only own {formatCents(marketValueCents)} worth — this will sell all {ownedShares.toFixed(4)} shares instead.
            </p>
          )}

          {hasAmount && (
            <div className="text-[12.5px] rounded-xl p-3 flex flex-col gap-1.5 mt-1" style={{ background: 'var(--surface-2)' }}>
              <div className={row}><span style={rowLabel}>You&apos;re {mode === 'buy' ? 'buying' : 'selling'} approximately</span><span className="num" style={{ color: 'var(--text)' }}>{estimatedShares.toFixed(4)} shares</span></div>
              <div className={row}><span style={rowLabel}>Current execution price</span><span className="num" style={{ color: 'var(--text)' }}>{formatCents(executionCents)}</span></div>
              <div className={row}><span style={rowLabel}>Estimated price after trade</span><span className="num" style={{ color: 'var(--text)' }}>{formatCents(postTradePriceCents)}</span></div>
              <div className={row}><span style={rowLabel}>Remaining cash after trade</span><span className="num" style={{ color: 'var(--text)' }}>{formatCents(Math.max(0, creditsAfterCents))}</span></div>
            </div>
          )}

          {error && <p className="text-sm" style={{ color: 'var(--down)' }}>{error}</p>}
          <button
            type="submit"
            className="text-center py-[13px] rounded-xl text-[14.5px] font-bold disabled:opacity-40"
            style={
              mode === 'buy'
                ? { background: 'var(--ember)', color: 'var(--on-ember)', boxShadow: '0 8px 24px -8px var(--ember-line)' }
                : { background: 'var(--down)', color: 'var(--on-ember)' }
            }
            disabled={!canSubmit}
          >
            Review {mode === 'buy' ? 'purchase' : 'sale'}
          </button>
          {ownedShares > 0 && mode === 'sell' && (
            <button type="button" className="next-btn-ghost text-sm py-2 rounded-[10px]" onClick={sellAll}>Sell all</button>
          )}
        </form>
      ) : (
        <div className="flex flex-col gap-3">
          <div className="text-[13px] rounded-xl border p-4 flex flex-col gap-2" style={{ borderColor: 'var(--border)' }}>
            <p className="m-0 font-semibold" style={{ color: 'var(--text)' }}>
              Confirm: {mode === 'buy' ? 'Buy' : 'Sell'} ~{estimatedShares.toFixed(4)} shares of {artistName}
            </p>
            <div className={row}><span style={rowLabel}>{mode === 'buy' ? 'Spending' : 'Selling'}</span><span className="num" style={{ color: 'var(--text)' }}>{formatCents(amountCents)}</span></div>
            <div className={row}><span style={rowLabel}>Execution price</span><span className="num" style={{ color: 'var(--text)' }}>{formatCents(executionCents)}</span></div>
            <div className={row}><span style={rowLabel}>Remaining cash after</span><span className="num" style={{ color: 'var(--text)' }}>{formatCents(Math.max(0, creditsAfterCents))}</span></div>
          </div>
          <p className="text-[11px] m-0" style={{ color: 'var(--text-faint)' }}>
            This is paper trading — NEXT Credits are virtual, and no real money changes hands.
          </p>
          {error && <p className="text-sm" style={{ color: 'var(--down)' }}>{error}</p>}
          <div className="flex gap-2">
            <button
              type="button"
              className="flex-1 text-center py-[13px] rounded-xl text-[14.5px] font-bold disabled:opacity-60"
              style={
                mode === 'buy'
                  ? { background: 'var(--ember)', color: 'var(--on-ember)', boxShadow: '0 8px 24px -8px var(--ember-line)' }
                  : { background: 'var(--down)', color: 'var(--on-ember)' }
              }
              onClick={confirmTrade}
              disabled={saving}
            >
              {saving ? 'Placing order…' : `Confirm ${mode === 'buy' ? 'purchase' : 'sale'}`}
            </button>
            <button type="button" className="next-btn-ghost px-5 rounded-xl text-[13.5px] font-semibold" onClick={() => setConfirming(false)} disabled={saving}>
              Cancel
            </button>
          </div>
        </div>
      )}

      <p className="text-[11px] leading-relaxed m-0" style={{ color: 'var(--text-faint)' }}>
        NEXT Credits are virtual — no real monetary value. Price moves ~5% per $10,000 traded on one side.
      </p>
    </div>
  );
}
