'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';

export default function SoundchartsPhotoBackfillButton() {
  const router = useRouter();
  const [running, setRunning] = useState(false);
  const [result, setResult] = useState<string | null>(null);

  async function run() {
    setRunning(true);
    setResult(null);
    try {
      const res = await fetch('/api/soundcharts/backfill', { method: 'POST' });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? 'Backfill failed');
      let text = `Checked ${data.checked}, updated ${data.updated}.`;
      if (data.noMatch > 0) text += ` ${data.noMatch} no photo match.`;
      if (data.errors > 0) text += ` ${data.errors} lookup error${data.errors === 1 ? '' : 's'}${data.lastError ? ` (${data.lastError})` : ''}.`;
      if (data.checked === 0 && data.updated === 0) {
        if (data.inBackoff > 0) {
          text += ` ${data.inBackoff} artist(s) were already checked recently with no match and are excluded until their recheck window opens — nothing new to check right now.`;
        } else {
          text += ` Every artist already has a photo (or has been checked) — nothing to do right now.`;
        }
      }
      setResult(text);
      router.refresh();
    } catch (err: any) {
      setResult(err.message ?? 'Backfill failed.');
    } finally {
      setRunning(false);
    }
  }

  return (
    <div className="flex items-center gap-3 flex-wrap">
      <button type="button" className="btn text-sm" disabled={running} onClick={run}>
        {running ? 'Backfilling…' : '🖼️ Backfill missing photos'}
      </button>
      {result && <span className="num text-sm" style={{ color: 'var(--text-muted)' }}>{result}</span>}
    </div>
  );
}
