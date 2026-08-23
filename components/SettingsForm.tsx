'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { User } from '@/lib/types';

export default function SettingsForm({ user }: { user: User }) {
  const router = useRouter();

  // Profile
  const [name, setName] = useState(user.name);
  const [avatarUrl, setAvatarUrl] = useState(user.avatar_url ?? '');
  const [avatarFailed, setAvatarFailed] = useState(false);
  const [showPositionsPublicly, setShowPositionsPublicly] = useState(user.show_positions_publicly);
  const [profileSaving, setProfileSaving] = useState(false);
  const [profileMessage, setProfileMessage] = useState<string | null>(null);
  const [profileError, setProfileError] = useState<string | null>(null);

  // Email verification
  const [resending, setResending] = useState(false);
  const [resendMessage, setResendMessage] = useState<string | null>(null);

  // Password
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [passwordSaving, setPasswordSaving] = useState(false);
  const [passwordMessage, setPasswordMessage] = useState<string | null>(null);
  const [passwordError, setPasswordError] = useState<string | null>(null);

  // Delete account
  const [deleting, setDeleting] = useState(false);
  const [confirmingDelete, setConfirmingDelete] = useState(false);

  async function saveProfile(e: React.FormEvent) {
    e.preventDefault();
    setProfileSaving(true);
    setProfileError(null);
    setProfileMessage(null);
    try {
      const res = await fetch('/api/account', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, avatar_url: avatarUrl || null, show_positions_publicly: showPositionsPublicly }),
      });
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error ?? 'Save failed.');
      setProfileMessage('Saved.');
      router.refresh();
    } catch (err: any) {
      setProfileError(err.message ?? 'Save failed.');
    } finally {
      setProfileSaving(false);
    }
  }

  async function resendVerification() {
    setResending(true);
    setResendMessage(null);
    try {
      const res = await fetch('/api/auth/resend-verification', { method: 'POST' });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error ?? 'Could not resend.');
      setResendMessage(data.delivered === false ? 'Email is not configured on this server yet — check server logs for the link.' : 'Verification email sent.');
    } catch (err: any) {
      setResendMessage(err.message ?? 'Could not resend.');
    } finally {
      setResending(false);
    }
  }

  async function changePassword(e: React.FormEvent) {
    e.preventDefault();
    setPasswordSaving(true);
    setPasswordError(null);
    setPasswordMessage(null);
    try {
      const res = await fetch('/api/account/password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ currentPassword, newPassword }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error ?? 'Could not change password.');
      setPasswordMessage('Password updated.');
      setCurrentPassword('');
      setNewPassword('');
    } catch (err: any) {
      setPasswordError(err.message ?? 'Could not change password.');
    } finally {
      setPasswordSaving(false);
    }
  }

  async function deleteAccount() {
    setDeleting(true);
    try {
      const res = await fetch('/api/account', { method: 'DELETE' });
      if (!res.ok) throw new Error('Could not delete account.');
      router.push('/login');
      router.refresh();
    } catch {
      setDeleting(false);
    }
  }

  return (
    <div className="max-w-lg mx-auto space-y-6">
      <h1 className="text-xl font-semibold">Settings</h1>

      <form onSubmit={saveProfile} className="card space-y-3">
        <h2 className="font-semibold text-neutral-100">Profile</h2>
        <div className="flex items-center gap-3">
          {avatarUrl && !avatarFailed ? (
            // eslint-disable-next-line @next/next/no-img-element -- arbitrary user-entered URL, not a next/image candidate.
            <img src={avatarUrl} alt="" onError={() => setAvatarFailed(true)} className="w-12 h-12 rounded-full object-cover border border-neutral-700" />
          ) : (
            <div className="w-12 h-12 rounded-full flex items-center justify-center bg-neutral-800 border border-neutral-700 font-semibold text-neutral-300">
              {name.trim().charAt(0).toUpperCase() || '?'}
            </div>
          )}
          <div className="flex-1">
            <label className="label">Avatar URL</label>
            <input className="input" value={avatarUrl} onChange={(e) => { setAvatarUrl(e.target.value); setAvatarFailed(false); }} placeholder="https://…" />
          </div>
        </div>
        <div>
          <label className="label">Name</label>
          <input className="input" value={name} onChange={(e) => setName(e.target.value)} required />
        </div>
        <div className="text-sm text-neutral-500">
          Email: {user.email}{' '}
          {user.email_verified_at ? (
            <span className="text-green-400">— verified</span>
          ) : (
            <>
              <span className="text-amber-400">— not verified</span>{' '}
              <button type="button" onClick={resendVerification} disabled={resending} className="underline text-neutral-400">
                {resending ? 'Sending…' : 'Resend verification email'}
              </button>
            </>
          )}
        </div>
        {resendMessage && <p className="text-xs text-neutral-400">{resendMessage}</p>}
        <label className="flex items-start gap-2.5 text-sm text-neutral-300">
          <input
            type="checkbox"
            checked={showPositionsPublicly}
            onChange={(e) => setShowPositionsPublicly(e.target.checked)}
            className="mt-0.5"
          />
          <span>
            Show my current NEXT positions on my public Scout Profile
            <span className="block text-xs text-neutral-500 mt-0.5">
              Off by default. Your rank, return %, and Founding Believer history are always visible to other
              Scouts — this only controls whether your live holdings (shares, value, P&amp;L per artist) are too.
            </span>
          </span>
        </label>
        {profileError && <div className="text-sm text-red-300">{profileError}</div>}
        {profileMessage && <div className="text-sm text-green-400">{profileMessage}</div>}
        <button type="submit" className="btn btn-primary" disabled={profileSaving}>
          {profileSaving ? 'Saving…' : 'Save profile'}
        </button>
      </form>

      <form onSubmit={changePassword} className="card space-y-3">
        <h2 className="font-semibold text-neutral-100">Change password</h2>
        <div>
          <label className="label">Current password</label>
          <input type="password" className="input" value={currentPassword} onChange={(e) => setCurrentPassword(e.target.value)} required />
        </div>
        <div>
          <label className="label">New password</label>
          <input type="password" className="input" value={newPassword} onChange={(e) => setNewPassword(e.target.value)} minLength={8} required />
        </div>
        {passwordError && <div className="text-sm text-red-300">{passwordError}</div>}
        {passwordMessage && <div className="text-sm text-green-400">{passwordMessage}</div>}
        <button type="submit" className="btn btn-primary" disabled={passwordSaving}>
          {passwordSaving ? 'Saving…' : 'Change password'}
        </button>
      </form>

      <div className="card space-y-3" style={{ borderColor: 'var(--down, #f87171)' }}>
        <h2 className="font-semibold text-red-300">Delete account</h2>
        <p className="text-sm text-neutral-400">
          Permanently deletes your account, NEXT holdings, trade history, and Watchlist. This can't be undone.
        </p>
        {!confirmingDelete ? (
          <button type="button" className="btn" onClick={() => setConfirmingDelete(true)}>
            Delete my account
          </button>
        ) : (
          <div className="flex items-center gap-2">
            <button type="button" className="btn" style={{ color: '#f87171' }} onClick={deleteAccount} disabled={deleting}>
              {deleting ? 'Deleting…' : 'Yes, permanently delete my account'}
            </button>
            <button type="button" className="btn" onClick={() => setConfirmingDelete(false)} disabled={deleting}>
              Cancel
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
