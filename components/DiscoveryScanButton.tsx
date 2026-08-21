'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';

export default function DiscoveryScanButton() {
  const router = useRouter();
  const [running, setRunning] = useState(false);
  const [result, setResult] = useState<string | null>(null);

  async function run() {
    setRunning(true);
    setResult(null);
    try {
      const res = await fetch('/api/discovery/scan', { method: 'POST' });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? 'Scan failed');
      setResult(`Searched ${data.searchedCount}, found ${data.candidatesFound} new candidate${data.candidatesFound === 1 ? '' : 's'}.`);
      router.refresh();
    } catch (err: any) {
      setResult(err.message ?? 'Scan failed.');
    } finally {
      setRunning(false);
    }
  }

  return (
    <div className="flex items-center gap-3 flex-wrap">
      <button type="button" className="btn btn-primary text-sm" disabled={running} onClick={run}>
        {running ? 'Scanning…' : 'Run scan now'}
      </button>
      {result && <span className="text-sm text-neutral-400">{result}</span>}
    </div>
  );
}
