'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';

// Restoring replaces the whole database, so it takes a deliberate second
// step: the admin has to type the snapshot's own file name. The server
// checks the same thing — this isn't only a UI guard.
export default function RestoreBackupButton({ fileName }: { fileName: string }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [typed, setTyped] = useState('');
  const [working, setWorking] = useState(false);
  const [message, setMessage] = useState<{ tone: 'ok' | 'error'; text: string } | null>(null);

  async function restore() {
    setWorking(true);
    setMessage(null);
    try {
      const res = await fetch(`/api/admin/backup/${encodeURIComponent(fileName)}/restore`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ confirm: typed }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? 'Restore failed.');
      setMessage({ tone: 'ok', text: `Restored ${data.rowCount.toLocaleString()} rows. The state from just before is saved as ${data.safetySnapshot}.` });
      setOpen(false);
      setTyped('');
      router.refresh();
    } catch (err: any) {
      setMessage({ tone: 'error', text: err.message ?? 'Restore failed.' });
    } finally {
      setWorking(false);
    }
  }

  if (!open) {
    return (
      <div className="flex flex-col items-end gap-1">
        <button type="button" className="text-xs underline" style={{ color: 'var(--text-muted)' }} onClick={() => setOpen(true)}>
          Restore…
        </button>
        {message && <p className="text-xs m-0 max-w-[320px] text-right" style={{ color: message.tone === 'ok' ? 'var(--up)' : 'var(--down)' }}>{message.text}</p>}
      </div>
    );
  }

  return (
    <div className="flex flex-col items-end gap-1.5 text-xs">
      <label htmlFor={`confirm-${fileName}`} className="text-right max-w-[320px]" style={{ color: 'var(--text-muted)' }}>
        This replaces everything in the database with this snapshot. Type its file name to confirm:
      </label>
      <input
        id={`confirm-${fileName}`}
        className="input text-xs w-[320px] max-w-full"
        value={typed}
        onChange={(e) => setTyped(e.target.value)}
        placeholder={fileName}
        autoComplete="off"
        spellCheck={false}
      />
      <div className="flex gap-2">
        <button type="button" className="btn text-xs" disabled={working} onClick={() => { setOpen(false); setTyped(''); }}>
          Cancel
        </button>
        <button type="button" className="btn btn-primary text-xs" disabled={working || typed !== fileName} onClick={restore}>
          {working ? 'Restoring…' : 'Restore this snapshot'}
        </button>
      </div>
      {message && <p className="m-0" style={{ color: 'var(--down)' }}>{message.text}</p>}
    </div>
  );
}
