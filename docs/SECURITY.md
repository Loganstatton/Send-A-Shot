# Security review — NEXT + Scout

Last reviewed: November 2026. This covers what was checked, what was fixed,
and what is still open. It is not a substitute for an independent
penetration test before a large public launch.

## What was checked, and the result

| Area | Result |
|---|---|
| **Authorization on every API route** | Every route under `app/api` checks for a session or role (`getSessionUser` / `getInternalUser` / `getAdminUser`), or a shared `CRON_SECRET` for scheduled jobs. Exceptions are only the auth endpoints themselves and `/api/health`. Public players get 401/403 on staff/admin endpoints (tested). |
| **Pages** | Staff pages use `requireInternal`/`requireAdmin`; login-only pages also get a real 307 to `/login` from `proxy.ts` when there is no session cookie. |
| **Account enumeration** | Login returns the same message and status for "wrong password" and "no such account", and now takes the same time (a dummy password check runs when the email is unknown). Password reset gives the same answer either way. **Signup** still says when an email is already registered — unavoidable without an email-first signup flow; it is rate-limited only by the general request volume. |
| **Brute force** | **Fixed.** Failed logins are limited to 8 per email and 30 per network address per 15 minutes (429 with `Retry-After`). Successful logins never count. Password-reset emails are limited to 3 per address per hour. Emails and addresses are stored only as SHA-256 hashes (`login_attempts`, pruned after a day). |
| **Sessions** | HMAC-signed, `httpOnly`, `SameSite=Lax`, `Secure` in production, 30-day expiry (checked server-side). **Fixed:** tokens now carry a `session_version`; changing or resetting the password signs out every other device, and Settings has "Log out of all other devices". |
| **CSRF** | `SameSite=Lax` cookies aren't sent on cross-site POSTs. **Added** an Origin check in `proxy.ts`: any browser POST/PATCH/PUT/DELETE to `/api` whose Origin isn't this site is refused (403). Server-to-server calls (no Origin) are unaffected. |
| **Injection** | All SQL uses bound parameters (`?` / `@name` → `$n`); the few interpolated fragments are fixed column lists or internally generated placeholder lists. Tested: SQL-like input is treated as data. React escapes all output; tested that script-like input renders as text. |
| **Clickjacking / headers** | **Added** for every response: `Content-Security-Policy: frame-ancestors 'none'; object-src 'none'; base-uri 'self'; form-action 'self'`, `X-Frame-Options: DENY`, `X-Content-Type-Options: nosniff`, `Referrer-Policy`, `Permissions-Policy`, `Strict-Transport-Security`; `X-Powered-By` removed. |
| **Passwords and tokens** | bcrypt hashes; reset tokens expire in 1 hour and stop working once the password changes; email-verification tokens expire in 24 hours. |
| **Secrets** | `SESSION_SECRET`, `DATABASE_URL`, `CRON_SECRET`, API keys live only in Render environment variables (never in the repo). If `SESSION_SECRET` is unset, a random one is generated and stored in the database. |
| **Audit trail** | **Added** `/admin/audit`: role changes, backups and restores, artist-claim and artist-request decisions, collection publish/unpublish/delete. Artist field edits were already logged per field. |
| **Dependencies** | `npm audit`: 0 known vulnerabilities (including dev tools) as of this review. |

## Still open (recommended before a large launch)

1. **No script-src Content-Security-Policy.** A strict script policy needs per-request nonces with Next.js; the directives that are safe today are enforced.
2. **Signup reveals registered emails** (see above).
3. **Rate limits trust `x-forwarded-for`.** Correct on Render (it sets the header); if hosting changes, re-check.
4. **Email verification is not required to play.** Combined with "one account per person" email normalisation and the market-integrity flags this limits — but does not stop — multi-account abuse. Requiring verification before trading is a product decision.
5. **No independent penetration test** has been done.
