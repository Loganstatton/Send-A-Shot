import crypto from 'crypto';
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import bcrypt from 'bcryptjs';
import { db, getArtist, getUserById, setUserRole } from './db';
import { perRequest } from './request-cache';
import { Artist, User } from './types';

export const SESSION_COOKIE = 'scout_session';
const SESSION_MAX_AGE_SEC = 30 * 24 * 60 * 60; // 30 days

// The key every session cookie and emailed action link is signed with.
// SESSION_SECRET, when set, is used as-is. Otherwise the app generates one
// the first time it's needed and keeps it in the database (app_settings),
// so every instance — and every restart and redeploy — signs and verifies
// with the same key. (It used to be kept in a local file, which a host with
// no persistent disk wipes on every restart: everyone was signed out, and
// every emailed link broke, each time the server restarted.)
let cachedSecret: string | null = null;
async function getSecret(): Promise<string> {
  if (process.env.SESSION_SECRET) return process.env.SESSION_SECRET;
  if (cachedSecret) return cachedSecret;
  // Insert-if-absent then read back: when several instances start at once,
  // exactly one candidate is stored and all of them end up reading it.
  const candidate = crypto.randomBytes(32).toString('hex');
  await db.query(
    "INSERT INTO app_settings (key, value, created_at) VALUES ('session_secret', $1, $2) ON CONFLICT (key) DO NOTHING",
    [candidate, new Date().toISOString()]
  );
  const { rows } = await db.query("SELECT value FROM app_settings WHERE key = 'session_secret'");
  cachedSecret = rows[0].value as string;
  return cachedSecret;
}

function base64url(input: Buffer | string) {
  return Buffer.from(input).toString('base64url');
}

async function sign(payload: object): Promise<string> {
  const body = base64url(JSON.stringify(payload));
  const sig = crypto.createHmac('sha256', await getSecret()).update(body).digest('base64url');
  return `${body}.${sig}`;
}

async function verify(token: string): Promise<{ uid: number; exp: number } | null> {
  const [body, sig] = token.split('.');
  if (!body || !sig) return null;
  const expected = crypto.createHmac('sha256', await getSecret()).update(body).digest('base64url');
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

export async function setSessionCookie(userId: number) {
  const token = await sign({ uid: userId, exp: Math.floor(Date.now() / 1000) + SESSION_MAX_AGE_SEC });
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
async function maybeBootstrapAdmin(user: User): Promise<User> {
  if (user.role === 'admin') return user;
  const adminEmails = (process.env.ADMIN_EMAILS ?? '')
    .split(',')
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean);
  if (!adminEmails.includes(user.email.toLowerCase())) return user;
  return await setUserRole(user.id, 'admin') ?? user;
}

// Server-only: read + verify the session cookie and load the user.
export const getSessionUser = perRequest(async (): Promise<User | null> => {
  const token = cookies().get(SESSION_COOKIE)?.value;
  if (!token) return null;
  const payload = await verify(token);
  if (!payload) return null;
  const user = await getUserById(payload.uid);
  if (!user) return null;
  return await maybeBootstrapAdmin(user);
});

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

// Artist Dashboard pages (app/next/my-artist) — only the user whose
// artist_claims request was approved for THIS artist (artists.claimed_by_user_id,
// set by reviewArtistClaim) may see it. Bounced to /next rather than an
// error page, same reasoning as requireInternal: that's genuinely where a
// non-owner belongs, not a dead end.
export async function requireArtistOwner(artistId: number): Promise<{ user: User; artist: Artist }> {
  const user = await requireUser();
  const artist = await getArtist(artistId);
  if (!artist || artist.claimed_by_user_id !== user.id) redirect('/next');
  return { user, artist };
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

export async function createActionToken(userId: number, purpose: ActionPurpose, ttlSec: number, currentPasswordHash?: string): Promise<string> {
  const payload: ActionPayload = { uid: userId, purpose, exp: Math.floor(Date.now() / 1000) + ttlSec };
  if (purpose === 'reset-password' && currentPasswordHash) payload.fp = fingerprint(currentPasswordHash);
  return await sign(payload);
}

export async function verifyActionToken(token: string, purpose: ActionPurpose, currentPasswordHash?: string): Promise<{ uid: number } | null> {
  const [body, sig] = token.split('.');
  if (!body || !sig) return null;
  const expected = crypto.createHmac('sha256', await getSecret()).update(body).digest('base64url');
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
