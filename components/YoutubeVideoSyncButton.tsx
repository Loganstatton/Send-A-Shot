'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';

export default function YoutubeVideoSyncButton() {
  const router = useRouter();
  const [running, setRunning] = useState(false);
  const [result, setResult] = useState<string | null>(null);

  async function run() {
    setRunning(true);
    setResult(null);
    try {
      const res = await fetch('/api/youtube/sync-videos', { method: 'POST' });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? 'Sync failed');
      let text = `Checked ${data.checked}, updated ${data.updated}.`;
      if (data.noMatch > 0) text += ` ${data.noMatch} no video match.`;
      if (data.errors > 0) text += ` ${data.errors} lookup error${data.errors === 1 ? '' : 's'}${data.lastError ? ` (${data.lastError})` : ''}.`;
      setResult(text);
      router.refresh();
    } catch (err: any) {
      setResult(err.message ?? 'Sync failed.');
    } finally {
      setRunning(false);
    }
  }

  return (
    <div className="flex items-center gap-3 flex-wrap">
      <button type="button" className="btn text-sm" disabled={running} onClick={run}>
        {running ? 'Syncing…' : '📹 Backfill missing videos'}
      </button>
      {result && <span className="num text-sm" style={{ color: 'var(--text-muted)' }}>{result}</span>}
    </div>
  );
}
