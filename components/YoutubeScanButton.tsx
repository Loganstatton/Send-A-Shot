'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';

export default function YoutubeScanButton() {
  const router = useRouter();
  const [running, setRunning] = useState(false);
  const [result, setResult] = useState<string | null>(null);

  async function run() {
    setRunning(true);
    setResult(null);
    try {
      const res = await fetch('/api/discovery/scan-youtube', { method: 'POST' });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? 'Scan failed');
      let text = `Searched ${data.searchedCount}, found ${data.candidatesFound} new candidate${data.candidatesFound === 1 ? '' : 's'}.`;
      if (data.insertFailedCount > 0) {
        text += ` ${data.insertFailedCount} qualified but failed to save${data.lastInsertError ? ` (${data.lastInsertError})` : ''}.`;
      }
      const r = data.rejectionBreakdown;
      if (r && data.candidatesFound === 0) {
        const parts = [
          r.belowMinViews > 0 && `${r.belowMinViews} too few views`,
          r.noSubscriberCount > 0 && `${r.noSubscriberCount} no subscriber count`,
          r.subscriberOutOfBand > 0 && `${r.subscriberOutOfBand} channel size outside band`,
          r.belowMomentumThreshold > 0 && `${r.belowMomentumThreshold} below momentum threshold${r.bestRejectedMomentumScore != null ? ` (best: ${r.bestRejectedMomentumScore}/100)` : ''}`,
        ].filter(Boolean);
        if (parts.length > 0) text += ` Rejected: ${parts.join(', ')}.`;
      }
      setResult(text);
      router.refresh();
    } catch (err: any) {
      setResult(err.message ?? 'Scan failed.');
    } finally {
      setRunning(false);
    }
  }

  return (
    <div className="flex items-center gap-3 flex-wrap">
      <button type="button" className="btn text-sm" disabled={running} onClick={run}>
        {running ? 'Scanning…' : '🎥 Run YouTube scan now'}
      </button>
      {result && <span className="text-sm text-neutral-400">{result}</span>}
    </div>
  );
}
