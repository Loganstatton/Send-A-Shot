# Deployment, operations and recovery

How Send-A-Shot (Scout + NEXT) is hosted, how to ship a change, how to roll
one back, and how to get data back when something goes wrong.

## Architecture

```
            browser
               │ HTTPS
   ┌───────────▼────────────┐        ┌──────────────────────────────┐
   │ Render web service      │        │ Render Postgres               │
   │ Next.js (npm run start) │──SQL──▶│ send-a-shot-db (Postgres 16)  │
   │ any number of instances │ private│ schema "public"  → production │
   └─────────────────────────┘ network│ schema "staging" → staging    │
                                      └──────────────────────────────┘
   GitHub Actions (daily) ──HTTPS──▶ /api/discovery/*, /api/admin/backup
```

- **All state lives in Postgres.** The web service keeps nothing on its own
  disk, so a restart, redeploy, or a second instance never loses or splits
  data. (Before 2026-11 the app used a SQLite file on the web service's disk;
  on Render's free plan that disk is wiped on every restart, which is what
  kept deleting accounts.)
- **Schema changes are code.** `lib/db-schema.ts` holds an ordered list of
  migrations. On the first query after it starts, each app process applies
  any that the database hasn't recorded yet (in `schema_migrations`), one at
  a time under a Postgres advisory lock, each in its own transaction. To
  change the schema, **append** a new migration; never edit one that has
  shipped.
- **Staging and production share one database server but not data.** Each
  uses its own Postgres schema (`DATABASE_SCHEMA`). Nothing in staging can
  read or write production rows.

## Environments

| | Production | Staging |
|---|---|---|
| Render service | `Send-A-Shot` (srv-da3oo0rm8hqs73ci1rg0) | `send-a-shot-staging` (srv-dbqfsp5g1s2s73e7ekq0) |
| URL | https://send-a-shot.onrender.com | https://send-a-shot-staging.onrender.com |
| Deploys from | `main` | `claude/artist-discovery-venture-yom2f3` |
| `DATABASE_SCHEMA` | `public` (default) | `staging` |
| Who can sign up | anyone | only with `SIGNUP_INVITE_CODE` |

Database: Render Postgres `send-a-shot-db` (dpg-dbq8bue7bikc73d95vk0-a),
plan Basic-256mb, 1 GB disk, Oregon (same region as the web services, so
they connect over Render's private network).

The Vercel project (`next`, next-cyan-zeta.vercel.app) is **not** wired to
this database. Render's database only accepts connections from Render's
private network unless its IP allow-list is opened; Vercel's servers have no
fixed IPs. Either retire the Vercel deployment (recommended — one URL, one
place to look) or open the database to `0.0.0.0/0` (password + TLS still
required) and set `DATABASE_URL` to the **external** URL with `DATABASE_SSL=1`.

## Environment variables

| Variable | Required | What it does |
|---|---|---|
| `DATABASE_URL` | **yes** | Postgres connection string. On Render use the database's **Internal** URL. |
| `DATABASE_SCHEMA` | no | Postgres schema to use (default `public`). Staging uses `staging`. |
| `DATABASE_SSL` | no | `1` to require TLS — needed for any connection over the public internet (the External URL). |
| `DATABASE_POOL_MAX` | no | Max connections per app process (default 10). Basic-256mb allows ~100 total. |
| `SESSION_SECRET` | no | Key that signs login cookies and emailed links. If unset, the app generates one once and keeps it in the database (`app_settings`). Changing it signs everyone out. |
| `ADMIN_EMAILS` | no | Comma-separated emails promoted to admin on their next request. |
| `SIGNUP_INVITE_CODE` | no | If set, signup requires this code (use for staging and for a closed beta). |
| `APP_URL` | recommended | Public base URL used in emailed links. |
| `CRON_SECRET` | for scheduled jobs | Shared secret the GitHub Actions workflow sends to the job endpoints. |
| `RESEND_API_KEY`, `EMAIL_FROM` | for email | Verification / password-reset / digest email. Without them email is skipped. |
| `YOUTUBE_API_KEY`, `SOUNDCHARTS_*` | optional | Discovery and enrichment sources — see README. |

Secrets go in Render's **Environment** tab for each service, never in the
repository.

## Shipping a change

1. Push to the staging branch. Render builds and deploys staging
   automatically (`autoDeploy`). Migrations, if any, run against the
   `staging` schema on first request.
2. Check staging: `/api/health` returns `{"ok":true,"db":"connected"}`; sign
   in, open Discover / an artist / Portfolio, place a small trade.
3. Before a change that adds a migration, take a production snapshot
   (`/admin/backups` → **Back up now**, then **Download** it).
4. Open a pull request into `main`, wait for tests, merge. Render deploys
   production automatically.
5. Check production `/api/health` and the same smoke path.

Local checks before pushing: `npm test` (runs against a local Postgres —
`npm run db:dev` starts one), `npx tsc --noEmit`, `npm run build`.

## Rolling back

- **Code-only change:** Render dashboard → service → **Events** → pick the
  last good deploy → **Rollback**. Takes about a minute. Data is untouched.
- **Change that added a migration:** migrations only ever *add* (tables,
  columns, indexes), so the previous code keeps working against the newer
  schema — roll back the code as above. Don't try to "un-migrate" by hand.
- **Change that damaged data:** restore the snapshot you took in step 3
  (see below), then roll back the code.

## Backups and restore

Two independent layers:

1. **Snapshots (built into the app).** A consistent export of every table,
   taken as of a single instant, gzipped, and stored in the `db_snapshots`
   table. Taken daily by the GitHub Actions workflow and on demand at
   `/admin/backups`; the newest 14 are kept.
   - **Download** any snapshot from `/admin/backups` — this is the copy that
     survives losing the database entirely. Do this before risky changes and
     periodically (weekly is reasonable at beta scale) and keep it somewhere
     else (your own drive / cloud storage).
   - **Restore** from `/admin/backups`: type the snapshot's name to confirm.
     The app first snapshots the current state ("before a restore"), then
     replaces every table in one transaction — if anything fails, nothing
     changes. To undo a restore, restore the "before a restore" snapshot.
2. **Render's own database backups.** Render takes daily backups of paid
   Postgres instances; check the database's **Recovery** tab for what the
   current plan offers (point-in-time recovery is on higher plans). This
   covers the case where the database server itself is lost.

**Disaster recovery from a downloaded file** (database gone or unusable):

```bash
# 1. Create a new Render Postgres; point the web service's DATABASE_URL at it
#    and let the app start once (it creates the tables).
# 2. From any machine allowed to reach the new database (use its External URL):
DATABASE_URL='postgresql://…' DATABASE_SSL=1 node scripts/restore-db.js snapshot-….json.gz --yes
```

`scripts/backup-db.js` does the reverse (write a snapshot file from any
database URL). Both run the same code the admin page uses
(`lib/snapshot-core.js`), and both are tested end to end.

Restoring a snapshot that predates a later migration works: columns are
matched by name and new columns take their defaults.

## Monitoring

- **Health:** `GET /api/health` (no auth) checks the database connection
  and that migrations have run. Point an uptime monitor at it, and set it as
  the Render service's health check path so a broken deploy is never put in
  front of users.
- **Errors:** `/admin/errors` lists server and client errors (stored in the
  database); Render's log stream has the full stack traces.
- **Scheduled jobs:** the GitHub Actions run fails visibly on any non-2xx;
  failed sync/discovery runs also email admins when email is configured.
- **Database:** Render dashboard → database → **Metrics** (connections,
  storage). At 1 GB, storage is the first limit you'd reach; Render can grow
  the disk without downtime.

## Costs (as of 2026-11)

| Item | Plan | Monthly |
|---|---|---|
| Postgres `send-a-shot-db` | Basic-256mb + 1 GB | about $6.30 |
| Production web service | Free | $0 — but it sleeps after 15 min idle; the first visit after that takes ~30–60 s to wake. Starter ($7/mo) keeps it awake. |
| Staging web service | Free | $0 (sleeping is fine for staging) |

## Known limits

- Free web services sleep when idle (see above). Data is safe either way;
  it's only the wake-up delay.
- Snapshots live in the same database they protect until you download one.
- The local dev database (`npm run db:dev`) is for development only:
  trust auth, loopback only.
