'use client';
import { useEffect, useState } from 'react';
import { LOG_TYPE_LABELS, LOG_TYPES, LogEntry, LogType } from '@/lib/types';

const TYPE_STYLE: Record<LogType, React.CSSProperties> = {
  note: { background: 'var(--surface-2)', borderColor: 'var(--border)', color: 'var(--text-muted)' },
  outreach: { background: 'var(--accent-dim)', borderColor: 'var(--accent-line)', color: 'var(--accent)' },
  response: { background: 'var(--up-dim)', borderColor: 'var(--up)', color: 'var(--up)' },
  meeting: { background: 'oklch(70% 0.15 300 / 0.14)', borderColor: 'oklch(70% 0.15 300 / 0.4)', color: 'oklch(78% 0.12 300)' },
  status_change: { background: 'var(--fire-dim)', borderColor: 'var(--fire-line)', color: 'var(--fire)' },
};

function todayISO() {
  return new Date().toISOString().slice(0, 10);
}

function followUpBadge(followUpAt: string): { label: string; style: React.CSSProperties } {
  const overdue = followUpAt < todayISO();
  return overdue
    ? { label: `Overdue ${followUpAt}`, style: { background: 'var(--down-dim)', borderColor: 'var(--down)', color: 'var(--down)' } }
    : { label: `Follow up ${followUpAt}`, style: { background: 'var(--fire-dim)', borderColor: 'var(--fire-line)', color: 'var(--fire)' } };
}

export default function ActivityLog({ artistId }: { artistId: number }) {
  const [entries, setEntries] = useState<LogEntry[] | null>(null);
  const [type, setType] = useState<LogType>('note');
  const [message, setMessage] = useState('');
  const [followUpAt, setFollowUpAt] = useState('');
  const [saving, setSaving] = useState(false);

  async function load() {
    const res = await fetch(`/api/artists/${artistId}/log`);
    setEntries(await res.json());
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [artistId]);

  async function handleAdd(e: React.FormEvent) {
    e.preventDefault();
    if (!message.trim()) return;
    setSaving(true);
    try {
      await fetch(`/api/artists/${artistId}/log`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ type, message, follow_up_at: followUpAt || undefined }),
      });
      setMessage('');
      setFollowUpAt('');
      await load();
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete(id: number) {
    await fetch(`/api/artists/${artistId}/log/${id}`, { method: 'DELETE' });
    await load();
  }

  async function handleClearFollowUp(id: number) {
    await fetch(`/api/artists/${artistId}/log/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ follow_up_at: null }),
    });
    await load();
  }

  return (
    <div className="card space-y-4">
      <h2 className="font-semibold text-lg">Activity log</h2>

      <form onSubmit={handleAdd} className="space-y-2">
        <div className="flex gap-2 flex-wrap">
          <select className="input w-auto" value={type} onChange={(e) => setType(e.target.value as LogType)}>
            {LOG_TYPES.map((t) => (
              <option key={t} value={t}>{LOG_TYPE_LABELS[t]}</option>
            ))}
          </select>
          <div className="flex items-center gap-2">
            <label className="text-xs whitespace-nowrap" style={{ color: 'var(--text-faint)' }}>Follow up on</label>
            <input
              type="date"
              className="input w-auto"
              value={followUpAt}
              onChange={(e) => setFollowUpAt(e.target.value)}
            />
          </div>
        </div>
        <textarea
          className="input min-h-[70px]"
          placeholder="What happened? e.g. 'Sent an intro DM about her original music.'"
          value={message}
          onChange={(e) => setMessage(e.target.value)}
        />
        <button type="submit" className="btn btn-primary" disabled={saving || !message.trim()}>
          {saving ? 'Adding…' : 'Add entry'}
        </button>
      </form>

      <div className="space-y-2">
        {entries === null && <p className="text-sm" style={{ color: 'var(--text-faint)' }}>Loading…</p>}
        {entries?.length === 0 && <p className="text-sm" style={{ color: 'var(--text-faint)' }}>No activity logged yet.</p>}
        {entries?.map((entry) => (
          <div key={entry.id} className="flex items-start justify-between gap-3 pt-2" style={{ borderTop: '1px solid var(--border-soft)' }}>
            <div className="min-w-0">
              <div className="flex items-center gap-2 flex-wrap">
                <span className="badge" style={TYPE_STYLE[entry.type]}>{LOG_TYPE_LABELS[entry.type]}</span>
                <span className="num text-xs" style={{ color: 'var(--text-faint)' }}>
                  {new Date(entry.created_at).toLocaleString()}
                  {entry.author ? ` · ${entry.author}` : ''}
                </span>
                {entry.follow_up_at && (
                  <span className="badge" style={followUpBadge(entry.follow_up_at).style}>
                    📅 {followUpBadge(entry.follow_up_at).label}
                    <button
                      type="button"
                      className="ml-1 hover:opacity-70"
                      onClick={() => handleClearFollowUp(entry.id)}
                      aria-label="Mark follow-up done"
                    >
                      ✓
                    </button>
                  </span>
                )}
              </div>
              <p className="text-sm mt-1 break-words" style={{ color: 'var(--text)' }}>{entry.message}</p>
            </div>
            <button
              type="button"
              className="text-sm shrink-0 hover:opacity-80"
              style={{ color: 'var(--text-faint)' }}
              onClick={() => handleDelete(entry.id)}
              aria-label="Delete entry"
            >
              ✕
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}
