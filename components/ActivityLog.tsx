'use client';
import { useEffect, useState } from 'react';
import { LOG_TYPE_LABELS, LOG_TYPES, LogEntry, LogType } from '@/lib/types';

const TYPE_CLASSES: Record<LogType, string> = {
  note: 'bg-neutral-500/20 border-neutral-500/40 text-neutral-300',
  outreach: 'bg-sky-500/20 border-sky-500/40 text-sky-300',
  response: 'bg-emerald-500/20 border-emerald-500/40 text-emerald-300',
  meeting: 'bg-violet-500/20 border-violet-500/40 text-violet-300',
  status_change: 'bg-amber-500/20 border-amber-500/40 text-amber-300',
};

export default function ActivityLog({ artistId }: { artistId: number }) {
  const [entries, setEntries] = useState<LogEntry[] | null>(null);
  const [type, setType] = useState<LogType>('note');
  const [message, setMessage] = useState('');
  const [author, setAuthor] = useState('');
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
        body: JSON.stringify({ type, message, author: author || undefined }),
      });
      setMessage('');
      await load();
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete(id: number) {
    await fetch(`/api/artists/${artistId}/log/${id}`, { method: 'DELETE' });
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
          <input
            className="input w-auto flex-1 min-w-[120px]"
            placeholder="Your name (optional)"
            value={author}
            onChange={(e) => setAuthor(e.target.value)}
          />
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
        {entries === null && <p className="text-sm text-neutral-500">Loading…</p>}
        {entries?.length === 0 && <p className="text-sm text-neutral-500">No activity logged yet.</p>}
        {entries?.map((entry) => (
          <div key={entry.id} className="flex items-start justify-between gap-3 border-t border-neutral-800 pt-2">
            <div className="min-w-0">
              <div className="flex items-center gap-2 flex-wrap">
                <span className={`badge ${TYPE_CLASSES[entry.type]}`}>{LOG_TYPE_LABELS[entry.type]}</span>
                <span className="text-xs text-neutral-500">
                  {new Date(entry.created_at).toLocaleString()}
                  {entry.author ? ` · ${entry.author}` : ''}
                </span>
              </div>
              <p className="text-sm text-neutral-200 mt-1 break-words">{entry.message}</p>
            </div>
            <button
              type="button"
              className="text-neutral-500 hover:text-red-300 text-sm shrink-0"
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
