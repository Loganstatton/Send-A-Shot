'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';

export default function SpotifySyncButton() {
  const router = useRouter();
  const [running, setRunning] = useState(false);
  const [result, setResult] = useState<string | null>(null);

  async function run() {
    setRunning(true);
    setResult(null);
    try {
      const res = await fetch('/api/spotify/sync', { method: 'POST' });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? 'Sync failed');
      setResult(`Checked ${data.checked}, updated ${data.updated}${data.failed > 0 ? `, ${data.failed} no match/failed` : ''}.`);
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
        {running ? 'Syncing…' : '🎵 Sync Spotify top songs'}
      </button>
      {result && <span className="text-sm text-neutral-400">{result}</span>}
    </div>
  );
}
