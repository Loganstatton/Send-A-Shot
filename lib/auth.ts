import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import bcrypt from 'bcryptjs';
import { getUserById, setUserRole } from './db';
import { DATA_DIR } from './data-dir';
import { User } from './types';

export const SESSION_COOKIE = 'scout_session';
const SESSION_MAX_AGE_SEC = 30 * 24 * 60 * 60; // 30 days

// Falls back to a secret persisted in data/.session-secret if SESSION_SECRET
// isn't set, so the app still works out of the box. This file is generated
// once and read by every module instance/route bundle — Next.js dev (and
// some serverless setups) can instantiate lib/auth.ts more than once per
// process, and an in-memory-only fallback would give each instance its own
// secret, silently invalidating sessions signed by another instance. Set
// SESSION_SECRET in .env.local for real deployments instead of relying on this.
const FALLBACK_SECRET_FILE = path.join(DATA_DIR, '.session-secret');
let cachedSecret: string | null = null;
function getSecret(): string {
  if (process.env.SESSION_SECRET) return process.env.SESSION_SECRET;
  if (cachedSecret) return cachedSecret;

  try {
    cachedSecret = fs.readFileSync(FALLBACK_SECRET_FILE, 'utf8').trim();
    if (cachedSecret) return cachedSecret;
  } catch {
    // no fallback file yet
  }

  cachedSecret = crypto.randomBytes(32).toString('hex');
  try {
    fs.mkdirSync(path.dirname(FALLBACK_SECRET_FILE), { recursive: true });
    fs.writeFileSync(FALLBACK_SECRET_FILE, cachedSecret, { mode: 0o600 });
  } catch {
    // best effort — worst case each instance regenerates its own secret
  }
  console.warn(
    '[auth] SESSION_SECRET is not set — generated a fallback secret at data/.session-secret. ' +
    'Set SESSION_SECRET in .env.local for real deployments.'
  );
  return cachedSecret;
}

function base64url(input: Buffer | string) {
  return Buffer.from(input).toString('base64url');
}

function sign(payload: object): string {
  const body = base64url(JSON.stringify(payload));
  const sig = crypto.createHmac('sha256', getSecret()).update(body).digest('base64url');
  return `${body}.${sig}`;
}

function verify(token: string): { uid: number; exp: number } | null {
  const [body, sig] = token.split('.');
  if (!body || !sig) return null;
  const expected = crypto.createHmac('sha256', getSecret()).update(body).digest('base64url');
  const sigBuf = Buffer.from(sig);
  const expectedBuf = Buffer.from(expected);
  if (sigBuf.length !== expectedBuf.length || !crypto.timingSafeEqual(sigBuf, expectedBuf)) return null;
  try {
    const payload = JSON.parse(Buffer.from(body, 'base64url').toString('utf8'));
    if (typeof payload.uid !== 'number' || typeof payload.exp !== 'number') return null;
    if (payload.exp < Date.now() / 1000) return null;
    return payload;
  } catch {
    return null;
  }
}

export function setSessionCookie(userId: number) {
  const token = sign({ uid: userId, exp: Math.floor(Date.now() / 1000) + SESSION_MAX_AGE_SEC });
  cookies().set(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    maxAge: SESSION_MAX_AGE_SEC,
  });
}

export function clearSessionCookie() {
  cookies().delete(SESSION_COOKIE);
}

// Bootstrap mechanism for the very first admin(s): comma-separated emails in
// ADMIN_EMAILS get upgraded to 'admin' on their next session check. This is
// the only automatic role grant — every other promotion goes through the
// admin-only /admin/users panel (setUserRole). Existing accounts are never
// auto-upgraded just by having signed up earlier; only being named in this
// env var does it.
function maybeBootstrapAdmin(user: User): User {
  if (user.role === 'admin') return user;
  const adminEmails = (process.env.ADMIN_EMAILS ?? '')
    .split(',')
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean);
  if (!adminEmails.includes(user.email.toLowerCase())) return user;
  return setUserRole(user.id, 'admin') ?? user;
}

// Server-only: read + verify the session cookie and load the user.
export async function getSessionUser(): Promise<User | null> {
  const token = cookies().get(SESSION_COOKIE)?.value;
  if (!token) return null;
  const payload = verify(token);
  if (!payload) return null;
  const user = getUserById(payload.uid);
  if (!user) return null;
  return maybeBootstrapAdmin(user);
}

// For server components/pages: redirect to /login if not authenticated.
export async function requireUser(): Promise<User> {
  const user = await getSessionUser();
  if (!user) redirect('/login');
  return user;
}

// Scout tool pages (dashboard, screener, artist edit/notes/deals) — internal
// staff and admins only. Public NEXT users get redirected to /next instead
// of an error page, since that's where they actually belong.
export async function requireInternal(): Promise<User> {
  const user = await requireUser();
  if (user.role === 'public') redirect('/next');
  return user;
}

// Admin-only pages (role management). Non-admins get bounced to wherever
// requireInternal/requireUser would otherwise send them.
export async function requireAdmin(): Promise<User> {
  const user = await requireUser();
  if (user.role !== 'admin') redirect(user.role === 'internal' ? '/' : '/next');
  return user;
}

// API-route-friendly variants: return null instead of redirecting (redirect()
// isn't meaningful for a fetch() caller — route handlers should 401/403 JSON).
export async function getInternalUser(): Promise<User | null> {
  const user = await getSessionUser();
  return user && user.role !== 'public' ? user : null;
}

export async function getAdminUser(): Promise<User | null> {
  const user = await getSessionUser();
  return user && user.role === 'admin' ? user : null;
}

export function hashPassword(password: string): Promise<string> {
  return bcrypt.hash(password, 10);
}

export function verifyPassword(password: string, hash: string): Promise<boolean> {
  return bcrypt.compare(password, hash);
}

// Short-lived, single-purpose tokens for email verification and password
// reset — same signing primitive as the session cookie (HMAC + timing-safe
// compare), just a different payload shape and a much shorter TTL. Stateless
// by design: no separate token table to clean up.
//
// A password-reset token additionally embeds a fingerprint of the user's
// CURRENT password hash. That makes it self-invalidating for free — once
// the password actually changes, any old reset link's fingerprint no
// longer matches and verification fails, without needing to track
// "used" tokens anywhere.
type ActionPurpose = 'verify-email' | 'reset-password';
type ActionPayload = { uid: number; purpose: ActionPurpose; exp: number; fp?: string };

function fingerprint(value: string): string {
  return crypto.createHash('sha256').update(value).digest('base64url').slice(0, 16);
}

export function createActionToken(userId: number, purpose: ActionPurpose, ttlSec: number, currentPasswordHash?: string): string {
  const payload: ActionPayload = { uid: userId, purpose, exp: Math.floor(Date.now() / 1000) + ttlSec };
  if (purpose === 'reset-password' && currentPasswordHash) payload.fp = fingerprint(currentPasswordHash);
  return sign(payload);
}

export function verifyActionToken(token: string, purpose: ActionPurpose, currentPasswordHash?: string): { uid: number } | null {
  const [body, sig] = token.split('.');
  if (!body || !sig) return null;
  const expected = crypto.createHmac('sha256', getSecret()).update(body).digest('base64url');
  const sigBuf = Buffer.from(sig);
  const expectedBuf = Buffer.from(expected);
  if (sigBuf.length !== expectedBuf.length || !crypto.timingSafeEqual(sigBuf, expectedBuf)) return null;

  let payload: ActionPayload;
  try {
    payload = JSON.parse(Buffer.from(body, 'base64url').toString('utf8'));
  } catch {
    return null;
  }
  if (typeof payload.uid !== 'number' || payload.purpose !== purpose || typeof payload.exp !== 'number') return null;
  if (payload.exp < Date.now() / 1000) return null;
  if (purpose === 'reset-password') {
    if (!payload.fp || !currentPasswordHash || payload.fp !== fingerprint(currentPasswordHash)) return null;
  }
  return { uid: payload.uid };
}
