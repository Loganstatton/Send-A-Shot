// Password gate. Edge-runtime compatible (Web Crypto only) so it can run in
// middleware. Disabled entirely when APP_PASSWORD is not set.

export const AUTH_COOKIE = 'sienna_session';
export const SESSION_DAYS = 30;

export function authEnabled(): boolean {
  return !!process.env.APP_PASSWORD;
}

function secret(): string {
  return process.env.SESSION_SECRET || `sienna:${process.env.APP_PASSWORD ?? ''}`;
}

async function hmac(message: string): Promise<string> {
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey('raw', enc.encode(secret()), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const sig = await crypto.subtle.sign('HMAC', key, enc.encode(message));
  return Array.from(new Uint8Array(sig), (b) => b.toString(16).padStart(2, '0')).join('');
}

function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

/** Token = "<expiryMs>.<hmac(expiry)>". Changing APP_PASSWORD or SESSION_SECRET logs everyone out. */
export async function createSessionToken(): Promise<string> {
  const exp = Date.now() + SESSION_DAYS * 86400_000;
  return `${exp}.${await hmac(`${exp}:${process.env.APP_PASSWORD}`)}`;
}

export async function verifySessionToken(token: string | undefined): Promise<boolean> {
  if (!token) return false;
  const [expStr, sig] = token.split('.');
  const exp = Number(expStr);
  if (!exp || exp < Date.now() || !sig) return false;
  return safeEqual(sig, await hmac(`${exp}:${process.env.APP_PASSWORD}`));
}

export async function checkPassword(input: string): Promise<boolean> {
  const expected = process.env.APP_PASSWORD ?? '';
  // Compare HMACs so timing doesn't leak the password length.
  return safeEqual(await hmac(`pw:${input}`), await hmac(`pw:${expected}`));
}
