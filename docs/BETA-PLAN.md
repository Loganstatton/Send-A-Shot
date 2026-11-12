# Invite-only beta: 100 real players

## Before the first invite goes out (gates)

Don't invite anyone until all of these are true:

| # | Gate | How to check | Status |
|---|---|---|---|
| 1 | Site always on (no 1-minute wake-up) | Render → Send-A-Shot → Instance type = Starter | **Needs your approval ($7/mo)** |
| 2 | Health check on | Render → Settings → Health Check Path = `/api/health` | Your step (free) |
| 3 | Email delivers | Admin → Email → "Send me a test email" arrives | Needs a domain + Resend key (docs/EMAIL-SETUP.md) |
| 4 | Password reset works end to end | Forgot password on a test account → link arrives → new password works | After gate 3 |
| 5 | Daily backups + encrypted off-site copy | GitHub → Actions → "Daily discovery scan" has a `database-backup-…` artifact | **Done**: verified 2026-11-12 |
| 6 | Backup key saved | `BACKUP_ENCRYPTION_KEY` (Render → Environment) copied into your password manager | Your step |
| 7 | Uptime alerts | UptimeRobot monitor on `/api/health` emails you | Your step (free), after gate 1 |
| 8 | Signup is invite-only | Render → Environment → `SIGNUP_MODE=invite`; Admin → Invites shows "Invite-only" | Your step, when ready |
| 9 | Legal review of Terms/Privacy (at least age, privacy, virtual credits) | docs/LEGAL-REVIEW-PACKET.md | With counsel |

## Sending invites

1. **Admin → Invites → Create**: one code per person, labelled with who it's
   for (e.g. "Jordan K. — music club"). Up to 100 at a time.
2. Copy each link (`…/signup?invite=CODE`). The link fills the code in for
   them. Or **Download CSV** to mail-merge from a spreadsheet.
3. Each code works once. A code can be revoked while unused. Signups stop
   at 100 accounts (`BETA_USER_CAP`; change it in Render if you want a
   different size).
4. Invite in waves (e.g. 20, then 30, then 50) so problems surface with
   fewer people affected.

Suggested invite message:

> You're invited to the NEXT beta: a free game where you back emerging
> music artists early with virtual credits and see whose picks hold up.
> No real money, nothing to buy. Your personal invite (works once):
> <link>
> Tell us what's confusing: there's a feedback link at the bottom of every page.

## During the beta

- **Feedback:** players use "Send feedback (beta)" in the footer. Read it
  on Admin → Beta feedback. The **NEXT Pro survey** (/next/pro) collects
  what people would pay for. Nothing is for sale.
- **Health:** Admin → Errors (crashes), Admin → Email (failed emails),
  Admin → Sync health (daily jobs), plus UptimeRobot alerts.
- **Metrics** (Scout → Metrics): signups by source, daily/weekly active
  players, challenge participation, "understood the game" rate.

## What we're trying to learn (exit criteria)

| Question | Signal | Healthy |
|---|---|---|
| Do people understand it? | Feedback "understood: yes" | ≥ 70% |
| Do they come back? | Weekly active ÷ joined, week 3 | ≥ 30% |
| Do they discover artists? | Players who back ≥ 3 artists | ≥ 50% |
| Is it social? | Players in a league | ≥ 25% |
| Would anyone pay? | Pro survey "definitely/probably" at $7.99 | ≥ 15%, plus a clear top feature |
| Is it reliable? | Errors/day, failed emails, uptime | ~0 errors, 0 failed resets, ≥ 99.5% uptime |

## Keep intact

The stock-style artist trading (virtual credits, buy/sell, prices,
portfolio, leaderboards) is unchanged by the beta work. Invites only
affect who can create an account.
