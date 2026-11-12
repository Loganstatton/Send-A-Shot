'use client';
import { LocalDateTime } from '@/components/LocalTime';
import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';

export type QueueRow = {
  id: number; artistId: number; artistName: string; kind: string; kindLabel: string; message: string; fromOwner: boolean;
  reporterName: string | null; reporterEmail: string | null; createdAt: string;
};

export default function ArtistRequestQueue({ rows }: { rows: QueueRow[] }) {
  if (rows.length === 0) return <p className="text-sm" style={{ color: 'var(--text-muted)' }}>Nothing waiting.</p>;
  return <ul className="space-y-4">{rows.map((r) => <QueueItem key={r.id} row={r} />)}</ul>;
}

function QueueItem({ row }: { row: QueueRow }) {
  const router = useRouter();
  const [note, setNote] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function decide(decision: 'resolved' | 'rejected') {
    if (row.kind === 'opt_out' && decision === 'resolved' && !window.confirm(`Remove ${row.artistName} from NEXT? Nobody will be able to newly back them.`)) return;
    setBusy(true);
    setError(null);
    const res = await fetch(`/api/artist-requests/${row.id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ decision, note }) });
    const data = await res.json().catch(() => ({}));
    setBusy(false);
    if (!res.ok) { setError(data.error ?? 'Could not save.'); return; }
    router.refresh();
  }

  const noteId = `request-note-${row.id}`;
  return (
    <li className="card space-y-2">
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <div className="font-semibold">
          {row.kindLabel} — <Link className="underline" href={`/artists/${row.artistId}`}>{row.artistName}</Link>
          {row.fromOwner && <span className="badge text-xs ml-2">from the verified artist</span>}
        </div>
        <span className="text-xs" style={{ color: 'var(--text-faint)' }}><LocalDateTime iso={row.createdAt} /></span>
      </div>
      <p className="text-sm whitespace-pre-wrap">{row.message}</p>
      <p className="text-xs" style={{ color: 'var(--text-faint)' }}>From {row.reporterName ?? 'deleted account'}{row.reporterEmail ? ` <${row.reporterEmail}>` : ''}</p>
      <label htmlFor={noteId} className="label">Note to the requester (required)</label>
      <textarea id={noteId} className="input min-h-[50px]" value={note} onChange={(e) => setNote(e.target.value)} maxLength={1000} />
      {error && <p role="alert" className="text-sm" style={{ color: 'var(--down)' }}>{error}</p>}
      <div className="flex gap-2">
        <button className="btn btn-primary" disabled={busy} onClick={() => decide('resolved')}>{row.kind === 'opt_out' ? 'Remove from NEXT' : 'Resolve'}</button>
        <button className="btn" disabled={busy} onClick={() => decide('rejected')}>Reject</button>
      </div>
    </li>
  );
}
