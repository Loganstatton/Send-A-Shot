# Hosting plan: persistent storage, backups, uptime

Status as of 2026-11-12, read from the Render API.

| Piece | Today | Monthly |
|---|---|---|
| Production web service `Send-A-Shot` | **Free** instance: sleeps after 15 min idle, ~1 min to wake, shares a 750-hour/month pool with every other free service in the workspace | $0 |
| Staging web service `send-a-shot-staging` | Free | $0 |
| Database `send-a-shot-db` | Postgres 16, **Basic-256mb**, 1 GB disk; 3-day point-in-time recovery included on paid databases (Hobby workspace) | ~$6.30 ($6 + 1 GB × $0.30) |
| Workspace | Hobby | $0 |
| **NEXT total today** | | **≈ $6.30** |

Also in the same Render workspace but **not part of NEXT** (not counted
above, not touched): `sienna-studio` (paid instance + 1 GB disk) and
`sweeps-casino-backend` (free). The free one draws on the same 750-hour pool.

## The problems

1. **Uptime.** The live site sleeps after 15 quiet minutes, so the next
   visitor waits about a minute. The daily GitHub Actions job also has to
   wake it. With several free services sharing 750 hours a month, an
   always-awake free service can drain the pool; when it runs out, **every
   free service is suspended until the 1st of the next month**.
2. **Off-site backups.** Render's 3-day point-in-time recovery covers "the
   database server died". The app's daily snapshots cover "a bad change
   deleted rows". But every snapshot lives inside the same database, so
   losing the whole Render account or database would lose them too.
3. **No health check.** Render can't tell a running-but-broken deploy from a
   healthy one.

## Recommendation: stay on Render, upgrade one thing

| Item | Plan | Monthly |
|---|---|---|
| Production web service | Free → **Starter** (always on, 512 MB) | **$7.00** (new) |
| Database | Basic-256mb + 1 GB storage (no change) | $6.30 (already paying) |
| Staging | stays Free (sleeping is fine for testing) | $0 |
| Workspace | stays Hobby | $0 |
| Off-site encrypted backups | GitHub Actions artifact, 30-day retention | $0 |
| Uptime monitoring | UptimeRobot free (5-minute checks, email alerts) | $0 |
| Email | Resend free plan (see EMAIL-SETUP.md) | $0 |
| **NEXT total** | | **≈ $13.30/month (+$7.00 vs today)** |

Optional extras, not recommended yet:

- Custom domain (needed for email anyway, see EMAIL-SETUP.md): ~$10–12/year (≈ $1/month). **Needs your approval.**
- Render Professional workspace, for 7-day instead of 3-day point-in-time recovery: +$25/month. The daily encrypted off-site copies (30 days) already cover longer history.
- Bigger database (Basic-1gb): only when the 256 MB instance shows memory pressure. Not needed for a 100-person beta.

### Alternatives compared

| Option | Approx. monthly | Backups | Why not now |
|---|---|---|---|
| **Render Starter + current DB** | **$13.30** | 3-day PITR + daily encrypted off-site | Recommended: no migration |
| DigitalOcean App Platform + Managed Postgres | ~$20 ($5 app + $15 DB) | Daily backups, 7-day PITR | More expensive and needs a full migration |
| Railway Hobby | $5 minimum + usage (~$5–15) | Limited/manual | Weaker backups; unpredictable bill |
| Fly.io app + Managed Postgres | ~$40+ | PITR | Most expensive |
| Neon (DB) + Render Starter (app) | $7 + Neon usage | PITR on paid Neon plans | Moves the database for no real saving |

Sources: Render's documentation and 2026 pricing comparisons. Render's own
upgrade screen shows the exact price before you confirm. I couldn't open
render.com directly from this session, so check that screen.

## Done in code (free, no approval needed)

- **Encrypted off-site backups.** The daily job now also fetches that day's
  snapshot encrypted (AES-256-GCM) **on the server** and keeps it as a
  GitHub Actions artifact for 30 days. The repository is public, so only
  ciphertext ever leaves Render. If the key isn't set, the server refuses
  and nothing is stored. Restore: download the artifact →
  `node scripts/decrypt-backup.js file.enc` → `node scripts/restore-db.js`.
- **Health endpoint** `/api/health` already checks the database (503 if
  unreachable).

## Your steps

1. **Approve the Starter upgrade ($7/month)** → Render → `Send-A-Shot` →
   Settings → Instance type → Starter.
2. **Health check** (free) → same Settings page → Health Check Path:
   `/api/health`.
3. **Backup key** (free) → Render → `Send-A-Shot` → Environment → add
   `BACKUP_ENCRYPTION_KEY`: a long random value (I can set one for you).
   **Save a copy in your password manager.** Without it, nobody can read
   the off-site backups, including you.
4. **Uptime monitor** (free) → uptimerobot.com → New monitor → HTTPS →
   `https://send-a-shot.onrender.com/api/health`, every 5 minutes, alert to
   your email. Do this after step 1: on the free plan, pinging every 5
   minutes keeps the service awake around the clock and uses up the shared
   free-hours pool.
