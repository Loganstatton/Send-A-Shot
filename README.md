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
- Optional scheduled sync: the same re-sync as above, run automatically
  across every linked artist on a daily schedule (or on demand from the
  dashboard) — the market's numbers stop depending on someone remembering
  to click the per-artist button (see setup below)
- Optional Discovery Engine: two independent scheduled scans feed one
  private **New Candidates** queue at `/discovery` — Approve turns a
  candidate into a real, editable artist (pre-filled, but never
  auto-scored — a human still rates the eight Breakout Score categories),
  Watch keeps it in view, Pass drops it for good. Nothing reaches NEXT
  without that human review (see setup below):
  - **Soundcharts source**: searches for smaller artists (under 250K
    Spotify followers) showing unusual growth (≥4% in 7 days or ≥8% in 30
    days). Uses `/top/artists`, which Soundcharts documents as
    plan-restricted — see the Soundcharts plan audit below if this 403s.
  - **YouTube source**: searches recent Music-category uploads across
    several genres for small channels with disproportionate momentum (a
    video earning far more views than its channel's subscriber count would
    predict), scores them with a transparent **Momentum Score**, and
    attempts a best-effort Soundcharts name match to enrich the result —
    never required, and never calls the restricted `/top/artists` endpoint.

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

### Optional: Automated Soundcharts sync (no manual button needed)

Uses the same Soundcharts credentials above, plus the `CRON_SECRET` from the
Discovery Engine section below (shared by both scheduled endpoints — set it
up once).

`POST /api/soundcharts/sync` refreshes every already-linked artist's stats
(followers, 30-day growth %, photo, location, platform links — whatever
Soundcharts actually returns) in one pass, the same data the per-artist
"Sync from Soundcharts" button pulls, just for the whole roster at once. It
can be triggered two ways:
- **Manually** — the "Sync all now" button on the Scout dashboard (`/`),
  while logged in as Internal/Admin.
- **On a schedule** — point the same external scheduler used for the
  Discovery Engine at this endpoint too:
  ```
  POST https://<your-app>/api/soundcharts/sync
  Header: x-cron-secret: <the CRON_SECRET value>
  ```
  once a day. Without `CRON_SECRET` set, only the manual button works — an
  artist's numbers just sit until someone clicks it, same as before.

An artist's `name` is deliberately never touched by the automated sync (only
by the manual button, which a human reviews before saving) — a background
job silently renaming someone is the wrong default. Unlinked artists (no
Soundcharts UUID) are untouched either way; their stats stay manual-entry.

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

### Optional: YouTube Discovery source

Soundcharts' `/top/artists` — the endpoint the Soundcharts source above
needs to find artists nobody searched for by name — is documented as
restricted to specific plans, and doesn't require an upgrade to work
around: this source finds candidates on YouTube instead, and still uses
Soundcharts (search + artist-by-uuid, both already used elsewhere in this
app) only to *enrich* a candidate afterward — never to find one.

```bash
echo "YOUTUBE_API_KEY=your-youtube-data-api-v3-key" >> .env.local
```

Get a key from the [Google Cloud Console](https://console.cloud.google.com/)
— enable the "YouTube Data API v3" on a project, then create an API key.
`CRON_SECRET` (above) is reused for this source's scheduler too.

`POST /api/discovery/scan-youtube` searches recent Music-category uploads
across six genre buckets (hip-hop/rap, pop, R&B, country, rock/alternative,
electronic), pulls real view/like/comment/subscriber counts for what it
finds, and scores each one with a transparent **Momentum Score** — the
same 0–100, weighted, tunable-ceiling shape as the Breakout Score itself
(see `lib/youtube-momentum.ts`), built to reward *disproportionate*
momentum (a small channel's video earning far more views than its
subscriber count would predict) rather than just raw view count. A
candidate that clears the score threshold gets a best-effort Soundcharts
name match attempted (search + `/artist/{uuid}`, confirmed-working
endpoints only) to pull in follower/growth data — improves the candidate,
never required for it to exist. Every candidate's explanation is visible
on `/discovery`, e.g. *"142K views in 6 days • 8.4K channel subscribers •
11.2% like rate"*.

Triggered the same two ways as the Soundcharts source:
- **Manually** — the "Run YouTube scan now" button on `/discovery`.
- **On a schedule** — point the same external scheduler at:
  ```
  POST https://<your-app>/api/discovery/scan-youtube
  Header: x-cron-secret: <the CRON_SECRET value>
  ```
  A daily scan is enough; there's no need to run this more often.

**Quota**: the YouTube Data API's daily quota is limited, and its `search`
call is far more expensive (100 units) than fetching stats (1 unit per
batched call of up to 50 ids) — this source calls `search` once per genre
(not once per candidate), then batches every video/channel stats lookup
found across all genres into as few calls as possible. A default scan
(6 genres × 15 results) costs roughly `6 × 100 + 2 = 602` quota units
against a typical 10,000/day default quota. All of the following are
env-configurable if you need to tune scan size, cost, or which genres run:

| Env var | Default | Effect |
|---|---|---|
| `YOUTUBE_SCAN_GENRES` | all six | Comma list of genre keys to scan (`hip-hop-rap,pop,rnb,country,rock-alternative,electronic`) |
| `YOUTUBE_MAX_RESULTS_PER_GENRE` | 15 | Search results pulled per genre per scan |
| `YOUTUBE_PUBLISHED_WITHIN_DAYS` | 14 | How recent an upload has to be to be considered |
| `YOUTUBE_MIN_SUBSCRIBERS` / `YOUTUBE_MAX_SUBSCRIBERS` | 200 / 100,000 | Channel size band — the upper bound is what keeps this "smaller channels," not already-famous artists |
| `YOUTUBE_MOMENTUM_THRESHOLD` | 40 | Minimum Momentum Score (0–100) to become a candidate |
| `YOUTUBE_MAX_CANDIDATES_PER_RUN` | 25 | Caps both the Soundcharts-enrichment calls and how many new candidates one scan can add |

A channel that hides its subscriber count, or a video with likes/comments
disabled, is never scored as if that number were 0 — the affected factor
is left out of the Momentum Score and its weight rescaled across whatever
data actually came back, and a channel with no subscriber count at all is
skipped outright (there's no baseline to judge "disproportionate" against).
If every genre search fails in one run (bad key, YouTube outage), the run
is recorded as failed with the real error instead of silently reporting
zero candidates found — a genuinely quiet day and a broken integration
should never look the same. Without `YOUTUBE_API_KEY` set, the scan button
shows a clear "not configured" error; the rest of the app (including the
Soundcharts source) works the same either way.

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

Six of these eight categories are still a human Scout's own 0–10 rating —
music quality, personality, professionalism and the like aren't things a
number can judge. **Audience Growth Velocity** and **Engagement Quality**
are the exception: they're computed automatically from an artist's real
30-day follower growth % and engagement rate % (whether entered by hand or
filled in by Soundcharts sync), so there's no slider for them anymore. See
`growthVelocityScore()`/`engagementQualityScore()` in `lib/scoring.ts`.

Score bands: 85–100 immediate outreach, 70–84 watch closely, 55–69 monitor,
below 55 pass. See `lib/scoring.ts`.

## What This MVP Does Not Include
- Full CRM tooling (email sequences, reminders/follow-up scheduling)
- Real payments/invoicing, or actual payout-waterfall accounting (recoup-then-
  commission sequencing, taxes, etc.) — the deals/revenue ledger tracks
  commitments and totals, it does not move money
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
  api/soundcharts/   # search + fetch-by-uuid + sync-all (session or CRON_SECRET)
  api/discovery/     # scan-soundcharts + scan-youtube triggers (session or
                     # CRON_SECRET) + candidate actions, feeding one queue
components/          # Header, ArtistForm, ScoreBadge, ActivityLog, ScoreHistory,
                     # DealsAndRevenue, InvestmentLedger, TradePanel, RoleManager,
                     # StatTile, Sparkline, FollowUpList, AuthForm, SoundchartsSearch,
                     # SyncAllButton, DiscoveryQueue, DiscoveryScanButton,
                     # YoutubeScanButton
lib/                 # sqlite db, types, scoring logic, NEXT pricing engine,
                     # auth/role helpers, money formatting, soundcharts client,
                     # discovery-source abstraction + Soundcharts/YouTube
                     # discovery filtering + scoring logic
data/                # sqlite file + fallback session secret live here
```

## Next Steps (Roadmap)
- Populate the market with a real, curated set of emerging artists across
  genres by running the Discovery Engine's two sources (Soundcharts +
  YouTube — see setup above) and working through the Approve/Watch/Pass
  queue — the actual precondition for a meaningful closed beta
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
