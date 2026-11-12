import crypto from 'crypto';
import { db } from './pg';

// Invite-only beta. Each invite code works once, carries a label saying who
// it's for, and records which account used it. SIGNUP_MODE=invite makes a
// code required to sign up; BETA_USER_CAP (default 100) is the most
// accounts invites can create. The older single shared code
// (SIGNUP_INVITE_CODE, used on staging) still works alongside.

const ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'; // no 0/O, 1/I/L
export const MAX_BATCH = 100;
export const MAX_OUTSTANDING = 300;

export function inviteOnly(): boolean {
  return process.env.SIGNUP_MODE === 'invite' || Boolean(process.env.SIGNUP_INVITE_CODE);
}

export function betaUserCap(): number {
  const n = Number(process.env.BETA_USER_CAP);
  return Number.isInteger(n) && n > 0 ? n : 100;
}

export function normalizeInviteCode(raw: string): string {
  return raw.toUpperCase().replace(/[^A-Z0-9]/g, '');
}

function newCode(): string {
  const bytes = crypto.randomBytes(8);
  const chars = [...bytes].map((b) => ALPHABET[b % ALPHABET.length]).join('');
  return `${chars.slice(0, 4)}-${chars.slice(4)}`;
}

export type Invite = {
  id: number; code: string; label: string | null; createdAt: string;
  usedAt: string | null; usedByUserId: number | null; usedByName: string | null; revokedAt: string | null;
};

export async function inviteSummary() {
  const row = (await db.prepare(`SELECT
      COUNT(*) FILTER (WHERE revoked_at IS NULL) AS issued,
      COUNT(*) FILTER (WHERE used_at IS NOT NULL) AS used,
      COUNT(*) FILTER (WHERE used_at IS NULL AND revoked_at IS NULL) AS open,
      COUNT(*) FILTER (WHERE revoked_at IS NOT NULL) AS revoked
    FROM beta_invites`).get()) as Record<string, number>;
  return { issued: Number(row.issued), used: Number(row.used), open: Number(row.open), revoked: Number(row.revoked), cap: betaUserCap(), inviteOnly: inviteOnly() };
}

export async function createInvites(createdBy: number, count: number, label: string | null): Promise<{ ok: true; codes: string[] } | { ok: false; error: string }> {
  if (!Number.isInteger(count) || count < 1 || count > MAX_BATCH) return { ok: false, error: `Create between 1 and ${MAX_BATCH} at a time.` };
  const cleanLabel = label?.trim().slice(0, 120) || null;
  const { open } = await inviteSummary();
  if (open + count > MAX_OUTSTANDING) return { ok: false, error: `There are already ${open} unused invites — revoke some before making more (limit ${MAX_OUTSTANDING}).` };
  const now = new Date().toISOString();
  const codes: string[] = [];
  await db.transaction(async () => {
    while (codes.length < count) {
      const code = newCode();
      const r = await db.prepare('INSERT INTO beta_invites (code, label, created_by, created_at) VALUES (?, ?, ?, ?) ON CONFLICT (code) DO NOTHING').run(code, cleanLabel, createdBy, now);
      if (r.changes > 0) codes.push(code);
    }
  });
  return { ok: true, codes };
}

export async function listInvites(): Promise<Invite[]> {
  const rows = (await db.prepare(`SELECT i.id, i.code, i.label, i.created_at, i.used_at, i.used_by_user_id, u.name AS used_by_name, i.revoked_at
    FROM beta_invites i LEFT JOIN users u ON u.id = i.used_by_user_id ORDER BY i.created_at DESC, i.id DESC`).all()) as any[];
  return rows.map((r) => ({ id: Number(r.id), code: r.code, label: r.label, createdAt: r.created_at, usedAt: r.used_at, usedByUserId: r.used_by_user_id == null ? null : Number(r.used_by_user_id), usedByName: r.used_by_name, revokedAt: r.revoked_at }));
}

export type InviteCheck = { ok: true; id: number } | { ok: false; error: string };

/** Is this code usable right now? (Doesn't use it up.) */
export async function checkInvite(rawCode: string): Promise<InviteCheck> {
  const code = normalizeInviteCode(rawCode);
  if (!code) return { ok: false, error: 'Enter your invite code.' };
  const row = (await db.prepare("SELECT id, used_at, revoked_at FROM beta_invites WHERE REPLACE(code, '-', '') = ?").get(code)) as { id: number; used_at: string | null; revoked_at: string | null } | undefined;
  if (!row || row.revoked_at) return { ok: false, error: 'That invite code is not valid.' };
  if (row.used_at) return { ok: false, error: 'That invite code has already been used.' };
  const { used, cap } = await inviteSummary();
  if (used >= cap) return { ok: false, error: 'The beta is full right now — thanks for your interest.' };
  return { ok: true, id: Number(row.id) };
}

/**
 * Use up an invite for a new account. Call inside the signup transaction:
 * the row lock makes two simultaneous signups with one code impossible, and
 * the cap is re-checked under the same lock.
 */
export async function claimInvite(inviteId: number, userId: number): Promise<boolean> {
  await db.prepare('SELECT pg_advisory_xact_lock(4207131)').get();
  const { used, cap } = await inviteSummary();
  if (used >= cap) return false;
  const r = await db.prepare('UPDATE beta_invites SET used_by_user_id = ?, used_at = ? WHERE id = ? AND used_at IS NULL AND revoked_at IS NULL').run(userId, new Date().toISOString(), inviteId);
  return r.changes === 1;
}

export async function revokeInvite(id: number): Promise<boolean> {
  const r = await db.prepare('UPDATE beta_invites SET revoked_at = ? WHERE id = ? AND used_at IS NULL AND revoked_at IS NULL').run(new Date().toISOString(), id);
  return r.changes === 1;
}
