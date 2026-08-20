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
- SQLite (via better-sqlite3) with auto-seeding of a few example artists

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

Sign-up is currently open to anyone who can reach the app (no invite system
yet) — fine for an internal tool behind your own network/auth, not for a
public deployment. See Roadmap.

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
- Contracts, revenue tracking, or payments
- Automated social-metrics ingestion (metrics are entered manually for now —
  a future phase would pull follower counts, growth, and engagement directly
  from TikTok/Instagram/Spotify APIs)
- Invite-only signup, roles/permissions, or password reset (any authenticated
  user can currently view/edit/delete any artist — fine for a small trusted
  team, not for a larger org)

## Project Structure
```
app/                 # Next.js app router
  page.tsx           # dashboard
  artists/new/       # add-artist form
  artists/[id]/      # artist detail + edit form
  login/, signup/    # auth pages
  api/artists/       # REST API (list/create/get/update/delete)
    [id]/log/        # activity log entries (outreach, notes, stage changes)
    [id]/history/    # score/metric snapshots over time
  api/auth/          # signup/login/logout
components/          # Header, ArtistForm, ScoreBadge, ActivityLog, ScoreHistory, AuthForm
lib/                 # sqlite db, types, scoring logic, auth/session helpers
data/                # sqlite file + fallback session secret live here
```

## Next Steps (Roadmap)
- Automated metrics ingestion from TikTok/Instagram/YouTube/Spotify
- Contract/revenue-share tracking once artists move into Development/Portfolio
- Crowdsourced scouting with finder's-fee attribution
- Reminders/follow-up scheduling on top of the activity log
- Invite-only signup, roles/permissions (e.g. only the creator or an admin
  can delete an artist), and password reset
