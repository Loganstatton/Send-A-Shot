'use client';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import type { Invite } from '@/lib/invites';
import { LocalDateTime } from '@/components/LocalTime';

export default function InvitesAdmin({ invites, appUrl }: { invites: Invite[]; appUrl: string }) {
  const router = useRouter();
  const [count, setCount] = useState('10');
  const [label, setLabel] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fresh, setFresh] = useState<string[]>([]);
  const [copied, setCopied] = useState<string | null>(null);
  const link = (code: string) => `${appUrl}/signup?invite=${code}`;

  async function create(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const res = await fetch('/api/admin/invites', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ count: Number(count), label }) });
    const data = await res.json().catch(() => ({}));
    setBusy(false);
    if (!res.ok) return setError(data.error ?? 'Could not create invites.');
    setFresh(data.codes);
    setLabel('');
    router.refresh();
  }

  async function revoke(id: number) {
    if (!confirm('Revoke this invite? The link will stop working.')) return;
    const res = await fetch(`/api/admin/invites/${id}`, { method: 'DELETE' });
    if (!res.ok) setError((await res.json().catch(() => ({}))).error ?? 'Could not revoke.');
    router.refresh();
  }

  async function copy(text: string, key: string) {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(key);
      setTimeout(() => setCopied(null), 1500);
    } catch {
      setError('Copy failed — select the link and copy it by hand.');
    }
  }

  return (
    <div className="space-y-6">
      <form onSubmit={create} className="card space-y-3">
        <h2 className="font-bold text-lg m-0">Create invites</h2>
        <div className="flex flex-wrap gap-3 items-end">
          <div>
            <label className="label" htmlFor="invite-count">How many</label>
            <input id="invite-count" className="input w-24" type="number" min={1} max={100} value={count} onChange={(e) => setCount(e.target.value)} required />
          </div>
          <div className="flex-1 min-w-[200px]">
            <label className="label" htmlFor="invite-label">Who they&apos;re for (optional)</label>
            <input id="invite-label" className="input" value={label} onChange={(e) => setLabel(e.target.value)} maxLength={120} placeholder="e.g. Jordan K. — college friends" />
          </div>
          <button className="btn btn-primary" disabled={busy}>{busy ? 'Creating…' : 'Create'}</button>
        </div>
        {error && <p role="alert" className="text-sm m-0" style={{ color: 'var(--down)' }}>{error}</p>}
        {fresh.length > 0 && (
          <div className="space-y-2">
            <p role="status" className="text-sm m-0" style={{ color: 'var(--up)' }}>Created {fresh.length}. Each link works once.</p>
            <button type="button" className="btn text-sm" onClick={() => copy(fresh.map(link).join('\n'), 'all')}>{copied === 'all' ? 'Copied' : `Copy all ${fresh.length} links`}</button>
          </div>
        )}
      </form>

      <div className="card space-y-2">
        <div className="flex items-center justify-between flex-wrap gap-2">
          <h2 className="font-bold text-lg m-0">All invites ({invites.length})</h2>
          <a className="btn text-sm" href="/api/admin/invites" download>Download CSV</a>
        </div>
        {invites.length === 0 ? (
          <p className="text-sm m-0" style={{ color: 'var(--text-muted)' }}>No invites yet.</p>
        ) : (
          <ul className="list-none p-0 m-0 divide-y" style={{ borderColor: 'var(--border-soft)' }}>
            {invites.map((i) => (
              <li key={i.id} className="py-2.5 flex flex-wrap items-center gap-x-4 gap-y-1.5 text-sm" style={{ borderColor: 'var(--border-soft)' }}>
                <span className="font-mono font-semibold">{i.code}</span>
                <span className="flex-1 min-w-[140px] break-words" style={{ color: 'var(--text-muted)' }}>{i.label ?? '—'}</span>
                <span className="text-xs" style={{ color: i.usedAt ? 'var(--up)' : i.revokedAt ? 'var(--text-faint)' : 'var(--text-muted)' }}>
                  {i.revokedAt ? 'Revoked' : i.usedAt ? <>Used by {i.usedByName ?? 'a deleted account'} · <LocalDateTime iso={i.usedAt} dateOnly /></> : 'Unused'}
                </span>
                {!i.usedAt && !i.revokedAt && (
                  <span className="flex gap-2">
                    <button type="button" className="btn text-xs" onClick={() => copy(link(i.code), i.code)} aria-label={`Copy invite link ${i.code}`}>{copied === i.code ? 'Copied' : 'Copy link'}</button>
                    <button type="button" className="btn text-xs" onClick={() => revoke(i.id)} aria-label={`Revoke invite ${i.code}`}>Revoke</button>
                  </span>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
