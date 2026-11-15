'use client';
import { useState } from 'react';
import { formatCents } from '@/lib/format';

type Preview = {
  ok: boolean; reason?: string; error?: string; listed: boolean; priceCents: number; oldDepthCents: number; newDepthCents: number;
  maxAllowedDepthCents: number; recommendedDepthCents: number; topUpCents: number; feePoolCents: number;
  fromFeePoolCents: number; fromLiquidityCents: number; owedBeforeCents: number; owedAfterCents: number;
  holders: { count: number; valueBeforeCents: number; valueAfterCents: number; smallestChangePct: number; largestChangePct: number };
};

// Depth changes are previewed, then approved by a signed-in admin. Nothing changes until "Approve".
export function DepthControl({ artistId, depthCents, maxAllowedDepthCents }: { artistId: number; depthCents: number; maxAllowedDepthCents: number }) {
  const [credits, setCredits] = useState(String(Math.floor(maxAllowedDepthCents / 100)));
  const [preview, setPreview] = useState<Preview | null>(null);
  const [note, setNote] = useState('');
  const [status, setStatus] = useState<string | null>(null);
  const cents = Math.round(Number(credits) * 100);

  async function load() {
    setStatus(null);
    const r = await fetch(`/api/admin/market/depth?artistId=${artistId}&depthCents=${cents}`);
    setPreview(await r.json());
  }
  async function approve() {
    const r = await fetch('/api/admin/market/depth', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ artistId, newDepthCents: cents, note }) });
    const b = await r.json();
    setStatus(r.ok ? `Applied: depth ${formatCents(b.oldDepthCents)} → ${formatCents(b.newDepthCents)}, reserve +${formatCents(b.topUpCents)}.` : `Not applied: ${b.error}`);
    if (r.ok) setPreview(null);
  }
  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2 flex-wrap text-sm">
        <label htmlFor={`depth-${artistId}`}>New depth (Credits)</label>
        <input id={`depth-${artistId}`} className="input w-36" inputMode="decimal" value={credits} onChange={(e) => { setCredits(e.target.value); setPreview(null); }} />
        <button type="button" className="btn" onClick={load}>Preview</button>
        <span style={{ color: 'var(--text-faint)' }}>now {formatCents(depthCents)} · max this week {formatCents(maxAllowedDepthCents)}</span>
      </div>
      {preview && (
        <div className="rounded-lg px-3 py-2 text-sm space-y-1" style={{ border: '1px solid var(--line)' }}>
          {preview.error || !preview.ok ? (
            <p className="m-0" style={{ color: 'var(--down)' }}>Not allowed: {preview.error ?? preview.reason}</p>
          ) : (
            <>
              <p className="m-0">Price stays {formatCents(preview.priceCents)}; nobody&apos;s shares change.</p>
              <p className="m-0">Owed to holders {formatCents(preview.owedBeforeCents)} → {formatCents(preview.owedAfterCents)}. Reserve top-up {formatCents(preview.topUpCents)}: {formatCents(preview.fromFeePoolCents)} from the fee pool (has {formatCents(preview.feePoolCents)}), {formatCents(preview.fromLiquidityCents)} as disclosed liquidity.</p>
              <p className="m-0">{preview.holders.count} holder(s): total value {formatCents(preview.holders.valueBeforeCents)} → {formatCents(preview.holders.valueAfterCents)} (each +{preview.holders.smallestChangePct.toFixed(2)}% to +{preview.holders.largestChangePct.toFixed(2)}%; nobody loses).</p>
              <div className="flex items-center gap-2 flex-wrap">
                <input className="input flex-1 min-w-40" placeholder="Reason (kept in the record)" value={note} onChange={(e) => setNote(e.target.value)} />
                <button type="button" className="btn btn-primary" onClick={approve}>Approve depth change</button>
              </div>
            </>
          )}
        </div>
      )}
      {status && <p className="text-sm m-0" role="status">{status}</p>}
    </div>
  );
}

export function HaltControl({ artistId, halted }: { artistId: number; halted: boolean }) {
  const [state, setState] = useState(halted);
  const [busy, setBusy] = useState(false);
  async function toggle() {
    if (state && !window.confirm('Resume trading in this artist? Only do this after reviewing why it was paused.')) return;
    setBusy(true);
    const r = await fetch('/api/admin/market/halt', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ artistId, action: state ? 'resume' : 'halt' }) });
    setBusy(false);
    if (r.ok) setState(!state);
  }
  return <button type="button" className="btn" disabled={busy} onClick={toggle}>{state ? 'Resume trading' : 'Pause trading'}</button>;
}

export function ReconcileButton() {
  const [msg, setMsg] = useState<string | null>(null);
  async function run() {
    setMsg('Checking…');
    const r = await fetch('/api/admin/market/reconcile', { method: 'POST' });
    const b = await r.json();
    setMsg(b.ok ? 'All checks passed.' : `${b.issues?.length ?? '?'} issue(s) found${b.haltedArtistIds?.length ? `; paused ${b.haltedArtistIds.length} artist(s)` : ''}. Reload to see them.`);
  }
  return (
    <span className="flex items-center gap-2 flex-wrap">
      <button type="button" className="btn" onClick={run}>Run reconciliation now</button>
      {msg && <span className="text-sm" role="status">{msg}</span>}
    </span>
  );
}
