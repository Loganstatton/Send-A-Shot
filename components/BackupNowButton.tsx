'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';

export default function BackupNowButton() {
  const router = useRouter();
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function run() {
    setSaving(true);
    setError(null);
    try {
      const res = await fetch('/api/admin/backup', { method: 'POST' });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? 'Backup failed.');
      router.refresh();
    } catch (err: any) {
      setError(err.message ?? 'Backup failed.');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="flex flex-col items-end gap-1.5">
      <button type="button" className="btn btn-primary text-sm" disabled={saving} onClick={run}>
        {saving ? 'Backing up…' : 'Back up now'}
      </button>
      {error && <p className="text-xs m-0" style={{ color: 'var(--down)' }}>{error}</p>}
    </div>
  );
}
