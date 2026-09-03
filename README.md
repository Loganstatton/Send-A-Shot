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
  confirmed against real responses (see setup below). Monthly listeners
  and engagement rate stay manual too, but for a different reason: no
  Soundcharts plan, and no other API, exposes either of those for
  Spotify — the form says so next to each field
- Optional scheduled sync: the same re-sync as above, run automatically
  across every linked artist on a daily schedule (or on demand from the
  dashboard) — the market's numbers stop depending on someone remembering
  to click the per-artist button (see setup below)
- Deezer top-song sync: automatically finds and fills in an artist's most
  popular track link and a 30-second preview clip — free, keyless, nothing
  to configure (Deezer's public catalog endpoints need no API key or app
  registration), independent of whether Soundcharts is configured or
  linked, and never overwrites a value once set (by sync or by hand) —
  clear the field to have it filled again (see setup below)
- Optional Discovery Engine: a scheduled scan feeds a private
  **New Candidates** queue at `/discovery` — Approve turns a candidate
  into a real, editable artist (pre-filled, but never auto-scored — a
  human still rates the eight Breakout Score categories), Watch keeps it
  in view, Pass drops it for good. Nothing reaches NEXT without that
  human review (see setup below):
  - **YouTube source** (the active one): searches recent Music-category
    uploads across several genres for small channels with disproportionate
    momentum (a video earning far more views than its channel's subscriber
    count would predict), scores them with a transparent **Momentum
    Score**, and attempts a best-effort Soundcharts name match to enrich
    the result — never required.
  - **Soundcharts source**: exists in the codebase (`/top/artists`,
    documented as plan-restricted) but isn't wired into the UI — finding
    candidates this way needs Soundcharts' $250/mo Growth plan, which
    isn't worth it for this (see setup below). Soundcharts stays fully in
    use for the *other* thing it does (Add Artist search-and-fill,
    per-artist stats sync) — just not for finding artists nobody searched
    for by name.

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
Soundcharts UUID) are untouched either way; their stats stay manual-entry —
that's what the photo backfill below is for.

### Photo backfill (for artists the sync above can never reach)

`/api/soundcharts/sync` above only re-syncs artists **already linked** to a
Soundcharts UUID. An artist that never got linked in the first place — a
rate limit or transient error during Add Artist / Bulk Add's on-create
lookup, or one added before Soundcharts was configured — sits with no
photo forever, since the regular sync has no way to discover them. This is
the search-and-link step that's missing: it searches Soundcharts by name
for every artist still missing both a photo and a UUID, links the best
match, and fills in whatever Soundcharts returns — same as the manual
per-artist Soundcharts search box, just for the whole roster at once.

- **Manually** — the "Backfill missing photos" button on the Scout
  dashboard (`/`).
- **On a schedule** — point the same external scheduler at:
  ```
  POST https://<your-app>/api/soundcharts/backfill
  Header: x-cron-secret: <the CRON_SECRET value>
  ```
  (reuses the same `CRON_SECRET` and Soundcharts credentials as the sync
  above)

Requests are paced ~300ms apart with one automatic retry per artist, since
a large batch fired back-to-back is exactly what can trip Soundcharts' rate
limit in the first place. A genuine "no Soundcharts listing" result backs
off for 14 days before being re-checked, same as the video backfill below.

### Deezer top-song + photo sync

Independent of Soundcharts — doesn't need it configured, doesn't need an
artist linked to it. This exists because `top_song_url` never had *any*
API source before (Soundcharts' own metadata endpoint doesn't return
platform identifiers on this plan — see above), and now also covers
`photo_url` as a **free, uncapped alternative** to Soundcharts for
artists that ran into its monthly call quota (Soundcharts' legacy/free
tier caps out at 1,000 calls/month — easy to hit in one large Bulk Add
batch). The same Deezer artist-search call already made for the top song
also returns a real photo, so this fills whichever of the two fields is
still missing, in one request. Deezer photos are never as good a match as
Soundcharts (lower resolution, and Deezer's own catalog occasionally
mismatches a same-named artist) — treat this as a solid fallback, not a
reason to drop Soundcharts entirely.

No setup, no environment variables, nothing to sign up for — Deezer's
public catalog endpoints (artist search, an artist's top track) are plain
GET requests that need no API key or app registration. This runs after an
earlier Spotify-based version of this feature turned out to be a dead
end: Spotify's Client Credentials flow started returning 403 Forbidden on
every catalog call for newly-created developer apps, with no working fix
available and no clear resolution from Spotify's own support channels —
see git history if you're curious. Deezer needs none of that, and its
preview clips are more reliably available than Spotify's had become
anyway.

This lookup happens two ways:
- **Immediately, once, when an artist enters the roster** — adding an artist
  by hand (`/artists/new`) or Approving a Discovery candidate both trigger
  a one-time best-effort lookup right away, so the top song shows up
  without a separate trip to the dashboard. Never blocks or fails the
  creation itself — any failure just leaves the field empty for the batch
  sync to retry later.
- **In a batch, for anyone still missing one** — `POST /api/deezer/sync`
  looks up every artist still missing a `top_song_url` **or** a
  `photo_url` (by searching Deezer for their name) and fills in whichever
  is missing — a link to their top track plus a 30-second preview clip,
  and/or a photo. Triggered the same two ways as the other sync jobs:
  - **Manually** — the "Sync Deezer top songs" button on the Scout
    dashboard (`/`).
  - **On a schedule** — point the same external scheduler at:
    ```
    POST https://<your-app>/api/deezer/sync
    Header: x-cron-secret: <the CRON_SECRET value>
    ```
    (reuses the same `CRON_SECRET` as the other scheduled syncs)

Once `top_song_url` is filled — by either path, or typed in by a Scout —
it's never silently overwritten again; it's a curatorial choice of which
song represents the artist, not a stat that should keep refreshing out
from under someone. Clear the field to have sync fill it again.

The batch sync's result — both the button's own text and the dashboard's
"Last Deezer sync" line — distinguishes *why* an artist wasn't updated:
**no Deezer match** (the calls succeeded but genuinely found nothing —
expected for this repo's own demo/seed artists, since they aren't real
people) versus an **actual lookup error** (a real API call failed — worth
investigating, since a real artist unexpectedly getting no match usually
means this, not a genuine absence from Deezer).

### Featured video on NEXT's Artist Detail hero

Every NEXT Artist Detail page plays a `featured_video_id` (a YouTube video)
behind the hero if one's set, falling back to `photo_url`, then to a plain
gradient+initial. Artists that came in through the YouTube discovery
scan already have one — the video that got them flagged carries straight
over on Approve. Manually added artists didn't, until now: they had no
video source to pull from at all, so the hero just sat blank unless a
Scout went and pasted a YouTube link into the "Featured video" field by
hand.

Same two-path shape as the Deezer top-song lookup above. The actual
lookup tries the cheap route first: if Soundcharts already found this
artist's YouTube channel (`youtube_url`, from its platformIdentifiers),
it reads that channel's uploads directly — `channels.list` +
`playlistItems.list`, 2 quota units total. Only when there's no known
channel does it fall back to `search.list` (`"<artist name> official
video"`, preferring a hit whose channel name actually matches the artist
over an unrelated top-relevance result like a reaction video or cover) —
**100 units**, YouTube's own listed cost for that endpoint, against a
10,000/day free quota. That's the one to watch: adding artists in bulk
(see Bulk Add below) without a known channel for each can burn through a
day's quota in well under a hundred artists.
- **Immediately, once, when an artist enters the roster** — adding an
  artist by hand (`/artists/new`) triggers a one-time best-effort lookup,
  same as the Deezer one. Never blocks or fails the creation itself.
- **In a batch, for anyone still missing one** — `POST /api/youtube/sync-videos`
  looks up every artist still missing a `featured_video_id` and fills one
  in. Triggered the same two ways as the other sync jobs:
  - **Manually** — the "Backfill missing videos" button on the Scout
    dashboard (`/`).
  - **On a schedule** — point the same external scheduler at:
    ```
    POST https://<your-app>/api/youtube/sync-videos
    Header: x-cron-secret: <the CRON_SECRET value>
    ```
    (reuses the same `CRON_SECRET` as the other scheduled syncs; needs
    `YOUTUBE_API_KEY` configured, same as the discovery scan)

Once `featured_video_id` is filled — by either path, or typed in by a
Scout — it's never silently overwritten; clear the field to have sync
fill it again.

### Optional: Discovery Engine (finds artists for you)

**YouTube is the only active discovery source.** Soundcharts *can* also
find candidates this way — searching `/top/artists` for smaller,
fast-growing artists — but that endpoint needs Soundcharts' $250/mo
Growth plan, which isn't worth it just for discovery. That source's code
(`app/api/discovery/scan`, the Soundcharts branch of `lib/discovery.ts`)
is still in the repo and still tested, but it has no button and nothing
schedules it — a deliberate cost decision, not a bug. If that plan is
ever worth it later, wiring the button back in is a small change.
Soundcharts stays fully in use for the *other* thing it does: Add Artist
search-and-fill and per-artist stats sync (see above) — those endpoints
work fine on the current plan.

```bash
echo "CRON_SECRET=$(openssl rand -hex 32)" >> .env.local
```

**A scheduler is already set up for you** — `.github/workflows/discovery-scan.yml`
runs the YouTube scan, Deezer sync, video backfill, photo backfill, and
Soundcharts sync once a day via GitHub Actions, free, nothing to sign up for. It just needs the same
`CRON_SECRET` value in two places:
1. Set `CRON_SECRET` in Render's Environment tab (the value above).
2. Add a repository secret with the *same* value: repo Settings → Secrets
   and variables → Actions → New repository secret → name it
   `CRON_SECRET`.

That's it — no need to set up a third-party cron service or Render's own
cron tier unless you'd rather. Trigger a run manually any time from the
repo's Actions tab (the workflow also supports `workflow_dispatch`)
instead of waiting for the daily schedule.

### YouTube Discovery source

Finds candidates on YouTube, and separately uses Soundcharts (search +
artist-by-uuid, both already used elsewhere in this app) only to *enrich*
a candidate afterward — never to find one, so this never touches the
restricted `/top/artists` endpoint.

```bash
echo "YOUTUBE_API_KEY=your-youtube-data-api-v3-key" >> .env.local
```

Get a key from the [Google Cloud Console](https://console.cloud.google.com/)
— enable the "YouTube Data API v3" on a project, then create an API key.
`CRON_SECRET` (above) is reused for this source's scheduler too.

`POST /api/discovery/scan-youtube` searches recent Music-category uploads
across six genre buckets (hip-hop/rap, pop, R&B, country, rock/alternative,
electronic), pulls real view/like/comment/subscriber counts for what it
finds, and qualifies a candidate with three simple, individually
inspectable checks — an official-release title pattern, a minimum view
count, and a channel-size band (see `passesCheapGates` in
`lib/youtube-momentum.ts`). For anything that qualifies, it also reads the
video's top comments for genuine "how is this not viral" / "underrated" /
"this deserves to blow up" sentiment (a curated keyword match, not NLP —
see `HYPE_PHRASES`, freely tunable). None of this — views, subscribers,
views/day, like rate, comment rate, comment sentiment — is combined into a
score; the raw numbers are shown to a Scout on `/discovery` as-is, and the
Approve/Watch/Pass call is theirs, not a formula's. A candidate that
qualifies gets a best-effort Soundcharts name match attempted (search +
`/artist/{uuid}`, confirmed-working endpoints only) to pull in
follower/growth data — improves the candidate, never required for it to
exist. Every candidate's explanation is visible on `/discovery`, e.g.
*"142K views in 6 days • 8.4K channel subscribers • 11.2% like rate • 💬
'how is this not viral??' (412 likes)"* — up to two real example comments
are captured when the sentiment is there, one inline in that explanation
and a second shown just below it. Ranking within a scan (which qualifying
candidates fill the `YOUTUBE_MAX_CANDIDATES_PER_RUN` cap) is by upload
recency, newest first — a simple tiebreak, not a ranking derived from
views/subscribers/rates.

Triggered two ways:
- **Manually** — the "Run YouTube scan now" button on `/discovery`.
- **On a schedule** — point the same external scheduler at:
  ```
  POST https://<your-app>/api/discovery/scan-youtube
  Header: x-cron-secret: <the CRON_SECRET value>
  ```
  A daily scan is enough; there's no need to run this more often.

**Quota**: the YouTube Data API's daily quota is limited, and its `search`
call is far more expensive (100 units, a *flat* cost regardless of how
many results are requested, up to YouTube's own 50-per-call cap) than
fetching stats or comments (1 unit per call — batched up to 50 ids per
call for stats; comments can only be fetched one video at a time, so 1
unit per candidate) — this source calls `search` once per genre (not once
per candidate), defaults to pulling YouTube's max of 50 results per call
since that costs nothing extra on top of the flat 100, batches every
video/channel stats lookup found across all genres into as few calls as
possible, and only fetches comments for a candidate that *already* cleared
the free view-count and subscriber-band checks — never for every search
hit. A default scan (6 genres × 50 results = 600 units for search) plus
roughly 1 unit per candidate that survives the free gates for comments
(typically well under 100) stays a small fraction of a typical 10,000/day
default quota. All of the following are env-configurable if you need to
tune scan size, cost, or which genres run:

| Env var | Default | Effect |
|---|---|---|
| `YOUTUBE_SCAN_GENRES` | all six | Comma list of genre keys to scan (`hip-hop-rap,pop,rnb,country,rock-alternative,electronic`) |
| `YOUTUBE_MAX_RESULTS_PER_GENRE` | 50 (YouTube's own max per call) | Search results pulled per genre per scan — free to max out, since `search` is priced per call, not per result |
| `YOUTUBE_PUBLISHED_WITHIN_DAYS` | 14 | How recent an upload has to be to be considered |
| `YOUTUBE_MIN_SUBSCRIBERS` / `YOUTUBE_MAX_SUBSCRIBERS` | 200 / 100,000 | Channel size band — the upper bound is what keeps this "smaller channels," not already-famous artists |
| `YOUTUBE_COMMENTS_PER_CANDIDATE` | 20 | Top comments read (by relevance) per candidate for hype-sentiment detection — context for the reviewing Scout, not a qualification gate |
| `YOUTUBE_MAX_CANDIDATES_PER_RUN` | 25 | Caps both the Soundcharts-enrichment calls and how many new candidates one scan can add |
| `YOUTUBE_DAILY_QUOTA_BUDGET` | 10,000 (YouTube's free-tier daily grant) | Self-imposed daily budget, tracked across discovery scans, the video backfill, and on-create lookups alike — a call that would exceed it is skipped locally (no request ever leaves the server) rather than left to fail with YouTube's own `quotaExceeded` error. See "Sync health" under `/admin` for live usage. Raise this only after Google approves a real increased-quota grant. |

A channel that hides its subscriber count is skipped outright — there's no
baseline to judge a small channel's reach against without one — and a video
with likes/comments disabled just leaves that raw number blank for the
Scout rather than being treated as a real 0.
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

## Operations

**Health check** — `GET /api/health` is unauthenticated and checks real
database connectivity (not just "the process is up"). Point an external
uptime monitor (UptimeRobot, Render's own health check, etc.) at it.

**Error monitoring** — self-hosted, since this app has no third-party APM
account (Sentry, etc.) configured. Every uncaught page-render exception
(`app/error.tsx`, `app/next/error.tsx`, `app/global-error.tsx`) and every
unexpected route-handler exception logged via `lib/error-log.ts`'s
`logServerError` lands in the `error_reports` table, reviewable at
`/admin/errors` (admin only). `console.error` still fires alongside every
write — Render's own log capture is the fallback if the DB write itself
somehow fails.

**Cron/job monitoring** — the daily GitHub Actions workflow
(`.github/workflows/discovery-scan.yml`) already fails its own run on any
non-2xx response, which shows up in the repo's Actions tab. On top of that,
a failed sync or discovery run now emails every current admin (best-effort,
via the existing `RESEND_API_KEY`/`EMAIL_FROM` setup — see
`lib/ops-alerts.ts`) so a broken daily job doesn't go unnoticed until
someone happens to check `/admin/sync`.

**Database backups and restore** — the whole app is one SQLite file
(`data/app.db`), so "backup" means a consistent point-in-time copy of it.
`lib/db-backup.ts`'s `runBackup()` uses SQLite's own `VACUUM INTO` (crash-
consistent even in WAL mode, unlike a raw file copy) to write into
`data/backups/`, keeping the most recent 14 and pruning older ones. The
daily GitHub Actions workflow triggers this automatically via
`POST /api/admin/backup` (same `CRON_SECRET` auth as the sync endpoints);
an admin can also trigger one on demand from `/admin/backups`.

These backups live on the SAME persistent disk as the live database —
they protect against a bad migration or an accidental delete, **not**
against losing the disk itself. True off-site backup (S3, etc.) needs real
storage credentials this app doesn't have configured; that's a follow-up
once those exist.

To restore, **stop the app first** (restoring into a live database out
from under a running server risks the app reading a half-swapped file),
then from the server's disk:
```bash
node scripts/restore-db.js latest          # picks the newest file in data/backups
node scripts/restore-db.js /path/to/app-2026-01-01T00-00-00-000-ab12cd.db
```
`restore-db.js` always copies whatever's currently live to
`data/pre-restore-<timestamp>.db` before overwriting, so a wrong or aborted
restore is never unrecoverable. `npm run backup` runs the same backup
logic as a one-off CLI command (useful for local dev, or a shell with
direct disk access rather than going through the web route).

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
.github/workflows/   # discovery-scan.yml — daily GitHub Actions cron for
                     # scan-youtube + deezer/sync + youtube/sync-videos +
                     # soundcharts/backfill + soundcharts/sync + db backup
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
    [id]/agreements/ # deal terms (type, status, commission %, investment)
    [id]/revenue/    # revenue entries, optionally linked to an agreement
    [id]/investments/# categorized spend ledger (marketing/studio/video/etc)
  api/next/          # NEXT trade endpoint (any logged-in user)
  api/admin/         # role management (admin only)
  api/auth/          # signup/login/logout
  api/soundcharts/   # search + fetch-by-uuid + sync-all (session or CRON_SECRET)
  api/deezer/        # top-song sync (session or CRON_SECRET) — free, keyless
  api/discovery/     # scan (Soundcharts — coded but unwired, see setup) +
                     # scan-youtube (active) triggers (session or CRON_SECRET)
                     # + candidate actions, feeding one queue
components/          # Header, ArtistForm, ScoreBadge, ActivityLog, ScoreHistory,
                     # DealsAndRevenue, InvestmentLedger, TradePanel, RoleManager,
                     # StatTile, Sparkline, FollowUpList, AuthForm, SoundchartsSearch,
                     # SyncAllButton, DeezerSyncButton, DiscoveryQueue,
                     # YoutubeScanButton
lib/                 # sqlite db, types, scoring logic, NEXT pricing engine,
                     # auth/role helpers, money formatting, soundcharts + deezer
                     # clients, discovery-source abstraction + Soundcharts/
                     # YouTube discovery filtering + scoring logic
data/                # sqlite file + fallback session secret live here
```

## Next Steps (Roadmap)
- Populate the market with a real, curated set of emerging artists across
  genres by running the Discovery Engine's YouTube source (see setup
  above) and working through the Approve/Watch/Pass queue — the actual
  precondition for a meaningful closed beta
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
