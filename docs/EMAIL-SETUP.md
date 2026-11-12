# Email setup (verification and password resets)

NEXT sends four kinds of email: **verify** (after signup), **reset**
(forgot password), **digest** (opt-in notification summaries) and **ops**
(alerts to admins when a scheduled job fails). Until the steps below are
done, **none are delivered**. Players can still sign up and play, but a
player who forgets their password cannot get back in.

## Provider: Resend (recommended)

- Already built into the app (`lib/email.ts`); no code changes needed.
- Free plan: 3,000 emails/month, at most 100/day, one sending domain. A
  100-person beta needs roughly 100 verification emails at launch plus a
  handful of resets a day, so it fits.
- Paid plan, only if the beta outgrows it: about $20/month for 50,000
  emails. Not needed now.

Alternatives considered:

| Provider | Free allowance | First paid tier | Notes |
|---|---|---|---|
| **Resend** | 3,000/mo, 100/day | ~$20/mo for 50k | Already integrated; simple API |
| Postmark | 100/mo | ~$15/mo for 10k | Excellent deliverability; free tier too small |
| Amazon SES | none ongoing | ~$0.10–0.16 per 1,000 | Cheapest at volume; AWS account, sandbox approval, more setup |
| Brevo | 300/day | ~$9/mo for 5k | Generous free tier; marketing-oriented |

Prices are from 2026 comparison sources. The provider's own sign-up screen
shows the exact current price before anything is charged.

## What you need: a domain

Email providers only deliver reliably from a domain you control, with
SPF/DKIM records proving the mail is really yours. You can't send from
`onrender.com`, and sending "from" a Yahoo or Gmail address through a
provider is rejected by those mailbox providers.

- **If you already own a domain**, use it (e.g. send from
  `hello@yourdomain.com`; a subdomain like `mail.yourdomain.com` keeps it
  separate from any other email you use).
- **If not**, a `.com` costs about $10–12/year at cost-price registrars
  (e.g. Cloudflare Registrar). **This is a purchase and needs your approval.**
  The same domain can later point at the site instead of
  `send-a-shot.onrender.com`.

## Steps (about 15 minutes, plus DNS propagation)

1. Create a free account at resend.com.
2. **Domains → Add domain** → enter your domain. Resend shows 3–4 DNS
   records (SPF, DKIM, optionally DMARC). Add them at your domain's DNS
   provider. Verification usually completes within an hour.
3. **API Keys → Create** with "Sending access" only. Copy it.
4. In Render → `Send-A-Shot` service → **Environment**, add:
   - `RESEND_API_KEY` = the key from step 3
   - `EMAIL_FROM` = `NEXT <hello@yourdomain.com>` (an address on the
     verified domain)
   - `APP_URL` = `https://send-a-shot.onrender.com` (already set; links in
     emails use it)
5. Save. Render redeploys (about 2 minutes).
6. Sign in as admin → **Admin → Email** → **Send me a test email**. If it
   arrives (check spam the first time), verification and reset emails work.

Optional settings: `EMAIL_DAILY_LIMIT` (default 100, Resend's free daily
cap) and `EMAIL_PRIORITY_RESERVE` (default 30): notification digests pause
when fewer than 30 sends are left in the day, so account emails always go
through.

## How delivery is protected

- Each send is retried up to 3 times (network errors, timeouts, rate
  limits, provider outages) under one idempotency key, so a retry can never
  deliver the same email twice.
- Permanent errors (bad address, unverified domain) are not retried. They
  show on the admin Email page with the provider's reason.
- Every outcome is recorded in `email_log` (kept 90 days; deleted with the
  player's account) and summarised on **Admin → Email**.
- "Resend verification" is limited to 3 per hour per player, so nobody can
  use up the day's sending allowance.
- With email not configured, production logs only the subject. A reset link
  is a live credential and is never written to logs.
