// "Where to go after logging in" — only ever a path on this site. Anything
// else (an absolute URL, a protocol-relative //host, a backslash trick) is
// dropped, so a crafted /login?next=... link can't bounce someone to
// another website after they sign in.
export function safeReturnPath(value: string | null | undefined, fallback = '/next'): string {
  if (!value || typeof value !== 'string') return fallback;
  if (!value.startsWith('/') || value.startsWith('//') || value.includes('\\')) return fallback;
  if (/[\u0000-\u001f]/.test(value)) return fallback;
  if (value === '/login' || value === '/signup' || value.startsWith('/login?') || value.startsWith('/signup?')) return fallback;
  return value;
}

export function withReturnPath(base: '/login' | '/signup', returnTo: string | null | undefined): string {
  const safe = safeReturnPath(returnTo, '');
  return safe ? `${base}?next=${encodeURIComponent(safe)}` : base;
}
