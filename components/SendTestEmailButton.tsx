'use client';
import { useState } from 'react';

export default function SendTestEmailButton({ to, disabled }: { to: string; disabled: boolean }) {
  const [state, setState] = useState<'idle' | 'sending' | 'done'>('idle');
  const [message, setMessage] = useState<string | null>(null);

  async function send() {
    setState('sending');
    setMessage(null);
    const res = await fetch('/api/admin/email-test', { method: 'POST' }).catch(() => null);
    const data = res ? await res.json().catch(() => ({})) : {};
    setMessage(res?.ok ? `Sent to ${to} — check that inbox (and spam).` : (data.error ?? 'Could not send.'));
    setState('done');
  }

  return (
    <div className="flex items-center gap-3 flex-wrap">
      <button type="button" className="btn text-sm" onClick={send} disabled={disabled || state === 'sending'}>
        {state === 'sending' ? 'Sending…' : 'Send me a test email'}
      </button>
      {disabled && <span className="text-xs" style={{ color: 'var(--text-faint)' }}>Available once email is set up.</span>}
      {message && <span role="status" className="text-sm">{message}</span>}
    </div>
  );
}
