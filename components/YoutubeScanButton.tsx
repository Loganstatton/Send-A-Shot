'use client';
import { useState } from 'react';

export default function YoutubeScanButton() {
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
          r.notOfficialRelease > 0 && `${r.notOfficialRelease} not tagged as an official release`,
          r.belowMinViews > 0 && `${r.belowMinViews} too few views`,
          r.noSubscriberCount > 0 && `${r.noSubscriberCount} no subscriber count`,
          r.subscriberOutOfBand > 0 && `${r.subscriberOutOfBand} channel size outside band`,
        ].filter(Boolean);
        if (parts.length > 0) text += ` Rejected: ${parts.join(', ')}.`;
      }
      setResult(text);
      // router.refresh() doesn't reliably bust Next's client-side route
      // cache right after a POST — the New Candidates list was staying
      // stale until a manual navigation away and back. A full reload
      // guarantees fresh data; delayed briefly so this result text is
      // actually readable before the page reloads out from under it.
      setTimeout(() => window.location.reload(), 2500);
    } catch (err: any) {
      setResult(err.message ?? 'Scan failed.');
      setRunning(false);
    }
  }

  return (
    <div className="flex items-center gap-3 flex-wrap">
      <button type="button" className="btn text-sm" disabled={running} onClick={run}>
        {running ? 'Scanning…' : '🎥 Run YouTube scan now'}
      </button>
      {result && <span className="num text-sm" style={{ color: 'var(--text-muted)' }}>{result}</span>}
    </div>
  );
}
