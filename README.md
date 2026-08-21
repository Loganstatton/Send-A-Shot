# Scout — Early Artist Discovery MVP

A small full-stack Next.js app for tracking emerging, unsigned musicians early —
before labels, managers, or big creators notice them — and scoring their
breakout potential so outreach decisions are systematic instead of "I kinda
like her voice."

This is Phase 1 of the artist-discovery-venture idea: prove the scouting and
scoring loop works before spending money on development deals, contracts, or
a licensable data product.

## Features
- Roster of tracked artists with stage pipeline: Watchlist → Contacted →
  Development → Portfolio Artist → Flagship (or Passed)
- Per-artist metrics: followers, monthly listeners, 30-day growth %,
  engagement rate, platform links
- Weighted **Breakout Score** (0–100) built from 8 scout-rated categories:
  music/talent, growth velocity, engagement quality, original-song response,
  brand/personality, content consistency, commercial potential, professionalism
- Dashboard sorted by Breakout Score with an outreach recommendation
  (🔥 Immediate outreach / 👀 Watch closely / 📊 Monitor / Pass)
- Per-artist activity log for outreach tracking (note / outreach sent /
  response received / meeting / stage change) — stage changes are logged
  automatically
- Automatic score history: every create/update snapshots the Breakout Score,
  stage, and metrics, shown as a sparkline + table on each artist's page —
  this is what lets you later check whether the scoring model actually works
- Multi-user accounts: sign up, log in, and every artist shows who added it
  (`Added by ...`); log entries are attributed to whoever is logged in — no
  one can post as someone else
- Three roles — **Public** (NEXT paper-trading, no Scout access), **Internal**
  (Scout tools: edit artists, deals, notes), **Admin** (Internal + manage
  roles at `/admin/users`). New signups always start Public; internal/admin
  is only ever granted by an admin or the `ADMIN_EMAILS` bootstrap, never
  self-selected
- Deals & revenue ledger per artist: log agreements (development deal,
  management, development investment, other) with a commission % and an
  optional upfront investment amount, then log revenue (streaming,
  sponsorship, shows, merch) linked to an agreement — commission is computed
  and frozen at entry time, and an investment shows recoup progress
  (`Recouped $X of $Y`). This is a ledger for tracking negotiated terms and
  totals, not a payout-accounting engine — real splits are whatever the
  actual contract and accountant say
- SQLite (via better-sqlite3) with auto-seeding of a few example artists
- Optional Soundcharts integration: search an artist by name to auto-fill
  photo, country, follower count, and 30-day growth %, plus a one-click
  re-sync once linked — bio, genre, and platform links stay manual, since
  Soundcharts' artist-metadata endpoint doesn't return those on this plan,
  confirmed against real responses (see setup below)
- Optional Discovery Engine: a scheduled scan searches Soundcharts for
  smaller artists (under 250K Spotify followers) showing unusual growth
  (≥4% in 7 days or ≥8% in 30 days) and drops them into a private
  **New Candidates** queue at `/discovery` — Approve turns one into a real,
  editable artist (pre-filled, but never auto-scored — a human still rates
  the eight Breakout Score categories), Watch keeps it in view, Pass drops
  it for good. Nothing reaches NEXT without that human review (see setup
  below)

## Quick Start
```bash
# Node 18+ recommended
npm i

# Recommended: set a persistent session secret so logins survive restarts
echo "SESSION_SECRET=$(openssl rand -hex 32)" > .env.local

npm run dev
# open http://localhost:3000, then sign up for an account
```

If you skip `SESSION_SECRET`, the app generates a fallback secret at
`data/.session-secret` on first run so sessions still work — but that file
is dev-only and gitignored; set a real `SESSION_SECRET` for any deployment
that isn't a single local process.

Sign-up is open to anyone who can reach the app, but new accounts always
start as **Public** (NEXT paper-trading only — no access to Scout's internal
tools or artist edit rights). To grant yourself Scout/Admin access the first
time, set `ADMIN_EMAILS` (comma-separated) before signing up:

```bash
echo "ADMIN_EMAILS=you@example.com" >> .env.local
```

That email is promoted to Admin automatically on next login. From there, use
**Admin → Manage users** in the app to grant Internal (Scout) or Admin access
to anyone else — that's the only way roles change; public users can never
self-select internal access.

### Optional: Soundcharts integration (live metrics)

Set these to enable searching Soundcharts by artist name from the Add Artist
form and a "Sync from Soundcharts" button on artists already linked:

```bash
echo "SOUNDCHARTS_APP_ID=your-app-id" >> .env.local
echo "SOUNDCHARTS_API_KEY=your-api-key" >> .env.local
```

Confirmed against real responses: this fills in photo, country, follower
count, and 30-day growth %. Bio, genre, and platform links (Spotify,
Instagram, TikTok, YouTube) stay manual — Soundcharts' artist-metadata
endpoint simply doesn't return them on this plan, even for major artists.
Without these env vars set, the Soundcharts panel shows a clear "not
configured" error instead of failing silently — everything else in the app
works the same either way.

### Optional: Discovery Engine (finds artists for you)

Uses the same Soundcharts credentials above, plus one more:

```bash
echo "CRON_SECRET=$(openssl rand -hex 32)" >> .env.local
```

`POST /api/discovery/scan` searches Soundcharts for smaller, fast-growing
artists and adds any it finds to the **New Candidates** queue (internal
nav). It can be triggered two ways:
- **Manually** — the "Run scan now" button on `/discovery`, while logged in
  as Internal/Admin. Works immediately, no extra setup.
- **On a schedule** — Render's web service has no built-in cron, so "every
  day" means pointing an external scheduler at the endpoint. Any scheduler
  works (a Render Cron Job, a GitHub Actions workflow on a schedule, a free
  service like cron-job.org) — have it send:
  ```
  POST https://<your-app>/api/discovery/scan
  Header: x-cron-secret: <the CRON_SECRET value>
  ```
  once a day. Without `CRON_SECRET` set, only the manual button works — the
  automatic path simply doesn't exist yet, nothing breaks.

A candidate never touches NEXT or gets a Breakout Score on its own —
Approve just creates a normal, editable artist (stage: Watchlist, score
sliders at 0) so a human still rates it, same as adding one by hand.

## Breakout Score weights

| Category | Weight |
|---|---|
| Music / Talent | 25 |
| Audience Growth Velocity | 15 |
| Engagement Quality | 15 |
| Original-Song Response | 15 |
| Brand / Personality | 10 |
| Content Consistency | 10 |
| Commercial Potential | 5 |
| Professionalism / Work Ethic | 5 |

Score bands: 85–100 immediate outreach, 70–84 watch closely, 55–69 monitor,
below 55 pass. See `lib/scoring.ts`.

## What This MVP Does Not Include
- Full CRM tooling (email sequences, reminders/follow-up scheduling)
- Real payments/invoicing, or actual payout-waterfall accounting (recoup-then-
  commission sequencing, taxes, etc.) — the deals/revenue ledger tracks
  commitments and totals, it does not move money
- Scheduled re-sync of *existing* artists' stats — the Discovery Engine
  finds new artists on a schedule, but an already-tracked artist's numbers
  still only refresh via the manual "Sync from Soundcharts" button
- A data-driven NEXT Score — it's still 100% the eight hand-rated
  categories; live growth/engagement numbers aren't blended in yet
- Invite-only signup or password reset — public signup is open (accounts
  just default to the harmless Public/NEXT role), and any Internal/Admin user
  can currently view/edit/delete any artist and any agreement — fine for a
  small trusted Scout team, not for a larger org
- **NEXT**: the public paper-trading product, live at `/next`. Every user
  (any role) gets $10,000 in virtual NEXT Credits and a portfolio. Each
  artist has a **NEXT Score** (the Breakout Score — predicts breakout
  likelihood, moves on artist performance data) and a separate **NEXT
  Price** (what the community currently pays — starts from a transparent
  score-based formula, then moves purely on paper buy/sell demand: ~5% per
  $10,000 traded on one side). They're allowed to diverge on purpose — a
  high score at a low price is "undervalued." Buy/sell by dollar amount,
  average-cost P&L, full transaction history, portfolio value/return.
  Public artist pages show only public-safe fields (name, genre, location,
  public socials, growth metrics, score, price) — never Scout's notes,
  stage, or scout attribution

## Project Structure
```
app/                 # Next.js app router
  page.tsx           # Scout dashboard (internal)
  screener/          # Scout portfolio/ROI screener (internal)
  artists/new/       # add-artist form (internal)
  artists/[id]/      # artist detail + edit form (internal)
  discovery/         # New Candidates queue — Approve/Watch/Pass (internal)
  admin/users/       # role management (admin only)
  next/              # NEXT: public market feed, artist stock pages, portfolio
  login/, signup/    # auth pages
  api/artists/       # Scout REST API (internal/admin only)
    [id]/log/        # activity log entries (outreach, notes, stage changes)
    [id]/history/    # score/metric snapshots over time
    [id]/agreements/ # deal terms (type, status, commission %, investment)
    [id]/revenue/    # revenue entries, optionally linked to an agreement
    [id]/investments/# categorized spend ledger (marketing/studio/video/etc)
  api/next/          # NEXT trade endpoint (any logged-in user)
  api/admin/         # role management (admin only)
  api/auth/          # signup/login/logout
  api/soundcharts/   # search + fetch-by-uuid (internal only)
  api/discovery/     # scan trigger (session or CRON_SECRET) + candidate actions
components/          # Header, ArtistForm, ScoreBadge, ActivityLog, ScoreHistory,
                     # DealsAndRevenue, InvestmentLedger, TradePanel, RoleManager,
                     # StatTile, Sparkline, FollowUpList, AuthForm, SoundchartsSearch,
                     # DiscoveryQueue, DiscoveryScanButton
lib/                 # sqlite db, types, scoring logic, NEXT pricing engine,
                     # auth/role helpers, money formatting, soundcharts client,
                     # discovery filtering logic
data/                # sqlite file + fallback session secret live here
```

## Next Steps (Roadmap)
- Blend live Soundcharts numbers into part of the Breakout Score
  (e.g. Audience Growth Velocity, Engagement Quality) instead of every
  category being a hand-moved slider — human judgment stays for the parts
  a number can't capture (music quality, personality, professionalism)
- Scheduled re-sync of already-tracked artists' stats, not just new-candidate
  discovery
- Populate the market with a real, curated set of emerging artists across
  genres — the actual precondition for a meaningful closed beta
- A closed beta with real users and the retention/engagement metrics to
  match (return rate, listens-before-buy, trades/user, leaderboard views,
  how often someone backs a genuinely small artist) — before any
  monetization or real-money work is worth considering
- Momentum alerts on NEXT ("Artist X +52% listeners in 7D")
- Prediction markets — the remaining gamification item on top of NEXT's core
  trading loop (leaderboards and Founding Believer already shipped)
- Crowdsourced scouting with finder's-fee attribution
- Reminders/follow-up scheduling on top of the activity log
- Invite-only signup and password reset
- Finer-grained permissions within Internal/Admin (e.g. only the creator or
  an admin can delete an artist/agreement)
- Real payout-waterfall logic (recoup-then-commission sequencing) if the
  simple ledger stops being enough
