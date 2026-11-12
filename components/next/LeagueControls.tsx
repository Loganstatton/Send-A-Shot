'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';

const inputStyle: React.CSSProperties = { border: '1px solid var(--border-soft)', background: 'var(--bg)', color: 'var(--text)' };

async function post(url: string, body?: unknown, method = 'POST') {
  const res = await fetch(url, {
    method,
    headers: body ? { 'Content-Type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error ?? 'Something went wrong. Try again.');
  return data;
}

export function CreateLeagueForm() {
  const router = useRouter();
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const data = await post('/api/next/leagues', { name });
      router.push(`/next/leagues/${data.league.id}`);
    } catch (err: any) {
      setError(err.message);
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="next-card p-5 flex flex-col gap-3">
      <label htmlFor="league-name" className="font-display font-bold text-base">Start a league</label>
      <p className="m-0 text-sm" style={{ color: 'var(--text-muted)' }}>Name it, then send the invite link to your friends.</p>
      <div className="flex gap-2 flex-wrap">
        <input
          id="league-name"
          className="flex-1 min-w-[180px] rounded-[10px] px-3.5 py-2.5 text-sm outline-none"
          style={inputStyle}
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="e.g. Group chat crate diggers"
          maxLength={40}
          required
        />
        <button type="submit" className="next-btn-primary text-sm px-4 py-2.5 rounded-[10px] font-semibold" disabled={busy}>
          {busy ? 'Creating…' : 'Create league'}
        </button>
      </div>
      {error && <p role="alert" className="text-sm m-0" style={{ color: 'var(--down)' }}>{error}</p>}
    </form>
  );
}

export function JoinLeagueForm() {
  const router = useRouter();
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const data = await post('/api/next/leagues/join', { code });
      router.push(`/next/leagues/${data.leagueId}`);
    } catch (err: any) {
      setError(err.message);
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="next-card p-5 flex flex-col gap-3">
      <label htmlFor="league-code" className="font-display font-bold text-base">Join with a code</label>
      <p className="m-0 text-sm" style={{ color: 'var(--text-muted)' }}>Paste the invite code or the whole link a friend sent you.</p>
      <div className="flex gap-2 flex-wrap">
        <input
          id="league-code"
          className="flex-1 min-w-[180px] rounded-[10px] px-3.5 py-2.5 text-sm outline-none num uppercase"
          style={inputStyle}
          value={code}
          onChange={(e) => setCode(e.target.value)}
          placeholder="ABCD2345"
          autoComplete="off"
          autoCapitalize="characters"
          spellCheck={false}
          required
        />
        <button type="submit" className="next-btn-ghost text-sm px-4 py-2.5 rounded-[10px]" disabled={busy}>
          {busy ? 'Joining…' : 'Join'}
        </button>
      </div>
      {error && <p role="alert" className="text-sm m-0" style={{ color: 'var(--down)' }}>{error}</p>}
    </form>
  );
}

export function JoinLeagueButton({ code, leagueName }: { code: string; leagueName: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function join() {
    setBusy(true);
    setError(null);
    try {
      const data = await post('/api/next/leagues/join', { code });
      router.push(`/next/leagues/${data.leagueId}`);
    } catch (err: any) {
      setError(err.message);
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-col gap-2">
      <button type="button" onClick={join} className="next-btn-primary w-fit px-5 py-2.5 rounded-[10px] text-sm font-semibold" disabled={busy}>
        {busy ? 'Joining…' : `Join ${leagueName}`}
      </button>
      {error && <p role="alert" className="text-sm m-0" style={{ color: 'var(--down)' }}>{error}</p>}
    </div>
  );
}

export function LeagueInvitePanel({ leagueId, leagueName, inviteCode, isOwner }: { leagueId: number; leagueName: string; inviteCode: string; isOwner: boolean }) {
  const router = useRouter();
  const [code, setCode] = useState(inviteCode);
  const [status, setStatus] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function share() {
    const url = `${window.location.origin}/next/leagues/join/${code}`;
    try {
      if (typeof navigator.share === 'function') {
        await navigator.share({ title: `Join ${leagueName} on NEXT`, text: 'Who can find the next big artist first?', url });
        return;
      }
      await navigator.clipboard.writeText(url);
      setStatus('Invite link copied.');
    } catch (err: any) {
      if (err?.name !== 'AbortError') setStatus(`Couldn't copy — the link is ${url}`);
    }
  }

  async function reset() {
    if (!window.confirm('Make a new invite link? The current link and code will stop working. Members already in the league stay.')) return;
    setBusy(true);
    try {
      const data = await post(`/api/next/leagues/${leagueId}/invite-code`);
      setCode(data.inviteCode);
      setStatus('New invite link ready. The old one no longer works.');
      router.refresh();
    } catch (err: any) {
      setStatus(err.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="next-card p-5 flex flex-col gap-3">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div>
          <p className="m-0 text-xs font-mono uppercase tracking-[0.08em]" style={{ color: 'var(--text-faint)' }}>Invite code</p>
          <p className="m-0 num font-bold text-xl tracking-[0.12em]">{code}</p>
        </div>
        <div className="flex gap-2 flex-wrap">
          <button type="button" onClick={share} className="next-btn-primary text-sm px-4 py-2.5 rounded-[10px] font-semibold">Share invite link</button>
          {isOwner && (
            <button type="button" onClick={reset} disabled={busy} className="next-btn-ghost text-sm px-4 py-2.5 rounded-[10px]">
              {busy ? 'Resetting…' : 'Reset link'}
            </button>
          )}
        </div>
      </div>
      <p aria-live="polite" className="m-0 text-xs min-h-[1em]" style={{ color: 'var(--text-muted)' }}>{status}</p>
    </div>
  );
}

export function LeaveLeagueButton({ leagueId, isOwner, memberCount }: { leagueId: number; isOwner: boolean; memberCount: number }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function leave() {
    const message = isOwner && memberCount <= 1
      ? "You're the only member, so leaving deletes this league. Continue?"
      : isOwner
        ? 'Leave this league? The longest-standing member becomes its owner.'
        : 'Leave this league? You can rejoin later with an invite link, but your standing restarts from that day.';
    if (!window.confirm(message)) return;
    setBusy(true);
    try {
      await post(`/api/next/leagues/${leagueId}/leave`);
      router.push('/next/leagues');
      router.refresh();
    } catch (err: any) {
      setError(err.message);
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-col gap-1">
      <button type="button" onClick={leave} disabled={busy} className="next-btn-ghost w-fit text-sm px-4 py-2 rounded-[10px]">
        {busy ? 'Leaving…' : 'Leave league'}
      </button>
      {error && <p role="alert" className="text-sm m-0" style={{ color: 'var(--down)' }}>{error}</p>}
    </div>
  );
}

export function RemoveMemberButton({ leagueId, userId, name }: { leagueId: number; userId: number; name: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  async function remove() {
    if (!window.confirm(`Remove ${name} from this league?`)) return;
    setBusy(true);
    try {
      await post(`/api/next/leagues/${leagueId}/members/${userId}`, undefined, 'DELETE');
      router.refresh();
    } catch (err: any) {
      window.alert(err.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <button type="button" onClick={remove} disabled={busy} aria-label={`Remove ${name}`} className="text-xs underline underline-offset-2 shrink-0" style={{ color: 'var(--text-faint)' }}>
      {busy ? 'Removing…' : 'Remove'}
    </button>
  );
}
