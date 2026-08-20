import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import bcrypt from 'bcryptjs';
import { getUserById } from './db';
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

// Server-only: read + verify the session cookie and load the user.
export async function getSessionUser(): Promise<User | null> {
  const token = cookies().get(SESSION_COOKIE)?.value;
  if (!token) return null;
  const payload = verify(token);
  if (!payload) return null;
  return getUserById(payload.uid) ?? null;
}

// For server components/pages: redirect to /login if not authenticated.
export async function requireUser(): Promise<User> {
  const user = await getSessionUser();
  if (!user) redirect('/login');
  return user;
}

export function hashPassword(password: string): Promise<string> {
  return bcrypt.hash(password, 10);
}

export function verifyPassword(password: string, hash: string): Promise<boolean> {
  return bcrypt.compare(password, hash);
}
