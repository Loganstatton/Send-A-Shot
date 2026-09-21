# Phase 1 Implementation Plan

## Purpose

Phase 1 proves the hard part — identity, jurisdiction gating, a
reconcilable two-currency ledger, server-authoritative games, and admin
control — end to end, with **no real money movement anywhere**. Every
external dependency (KYC, geolocation, payments, redemption payout) is a
mock provider implementing the real adapter interface, so swapping in a
live vendor in Phase 2/3 is a binding change, not a rewrite.

This plan describes what ships in *this engineering effort*. It is
intentionally narrower than the full 50-section spec — see
`docs/01-architecture.md §1` for the explicit non-goals, and the "Phase"
column in `docs/04-screen-map.md` / `docs/05-api-design.md` for what's
real vs. stubbed on a per-screen/per-endpoint basis.

## What ships

**Backend (NestJS + Prisma + PostgreSQL)**
- Modules: `auth`, `user`, `wallet`, `casino` (catalog + Originals: Dice,
  Mines, Plinko), `promotions` (generic engine + daily bonus), `vip`
  (foundation), `compliance` (jurisdictions + feature flags + config
  versioning), `kyc` (mock), `payments` (mock, flagged off),
  `redemptions` (flagged off), `risk` (schema + manual admin actions,
  no automated rule engine yet), `admin` (RBAC + audit log + per-domain
  admin endpoints), `notifications` (in-app only, log-only email/SMS/push).
- Full Prisma schema for every entity in `docs/02-database-schema.md`,
  including tables that Phase 1 doesn't populate yet (e.g. `chat_messages`,
  `leaderboard_snapshots`), so Phase 2 is additive migrations, not schema
  surgery.
- Ledger: append-only `ledger_entries`, idempotency keys, row-locked
  balance posting, reconciliation job.
- Provably fair primitive (`libs/provably-fair`) shared by all three
  Originals, plus the public verification endpoint.
- Jurisdiction guard wired into registration and every SC-adjacent
  endpoint, reading live from the `jurisdictions` table (seeded
  conservatively — see below).

**Frontend (Next.js + Tailwind)**
- Original design system (dark, charcoal/graphite base, restrained
  metallic-teal accent — see `styles/globals.css` tokens; not a Stake.us
  visual clone).
- Persistent sidebar + topbar + mobile bottom nav, currency switcher with
  an unmistakable GC/SC visual state.
- Casino Home lobby with horizontally-scrollable sections, skeleton
  loaders, cursor-paginated game grids.
- Dice, Mines, Plinko playable end-to-end against the real backend, GC
  only (SC path exists in code, gated by `originals.sc_enabled=false`).
- Wallet, transactions, daily bonus, VIP dashboard, profile, security,
  responsible play, support — all real UI against real endpoints.
- Admin panel (folded into the same Next.js app under `/admin`,
  RBAC-route-guarded, never linked from player nav): dashboard, user
  search/detail, ledger/reconciliation view, game management, promotions
  manager, VIP config, compliance center, KYC queue, risk queue, roles,
  audit log.

**Infra**
- `docker-compose.yml`: Postgres, Redis, backend, frontend — one command
  local bring-up.
- Seed script creating the demo users from spec §47 (`PLAYER`,
  `VIP_PLAYER`, `SUPPORT_ADMIN`, `COMPLIANCE_ADMIN`, `SUPER_ADMIN`) with
  sandbox GC/SC balances, a seeded jurisdiction table, seeded VIP ladder,
  seeded daily-bonus promotion, and the three Originals as catalog rows.
- `.env.example` at both `backend/` and `frontend/`.
- GitHub Actions CI: lint, typecheck, unit + integration tests on push.

**Tests**
- Wallet/ledger: duplicate bet, duplicate win callback, rollback,
  insufficient balance, concurrent plays on the same wallet (row-lock
  correctness), idempotency-key replay.
- Provably fair: deterministic result recomputation matches `/verify`.
- Jurisdiction guard: registration blocked in `BLOCKED`/
  `REGISTRATION_DISABLED` states, SC endpoints blocked in
  `SC_DISABLED`/`GC_ONLY`.
- Promotion claim: double-claim prevention, expired promo rejection.

## What does not ship (by design, per spec §§ "feature-flag everything
SC-adjacent until compliance approval")

- Real payment processing, real payout/redemption, real KYC vendor, real
  geolocation vendor — mocked, adapter-swappable.
- AWS/Terraform/Cloudflare deployment — Phase 1 runs via Docker Compose
  locally/staging; IaC is a Phase 2/3 concern once there's a real cloud
  target and budget owner.
- Live casino, third-party slots/table games — the provider abstraction
  exists and is unit-tested against a mock adapter, but there is no real
  aggregator to integrate against yet.
- Real-time chat and leaderboards UI (schema + WS gateway plumbing exist;
  UI is a stub screen).
- 2FA/passkey UI (TOTP library and schema wired; enrollment screen is
  Phase 2).
- Automated risk rule engine (schema + manual admin action exist; rule
  evaluation logic is Phase 2).
- CMS admin UI for banners/legal pages (Phase 1 banners/legal content are
  static seed JSON editable by a developer, not yet a marketing-safe CMS).

## Jurisdiction seed default

Phase 1 seeds **every US state to `REGISTRATION_DISABLED`** except a small
demo allowlist (`DEMO_ALLOWED_STATES` env var, defaults to a couple of
non-production test states) set to `ALLOWED`. This is a deliberately
conservative default so the platform cannot accidentally appear "open for
business" anywhere — every state's real status is something compliance
sets explicitly through `/admin/compliance`, never something the code
assumes.

## Definition of done for Phase 1

1. `docker compose up` brings up a working stack; seed script populates
   demo accounts.
2. A `PLAYER` demo user can: register (in an allowed demo state) → verify
   email (mock) → log in → see GC/SC balances → claim daily bonus → play
   Dice/Mines/Plinko with GC and see balance update in real time → view
   transaction history → view VIP progress.
3. A `SUPER_ADMIN` demo user can: log into `/admin` → see dashboard
   metrics → find the `PLAYER` user → view their full ledger → adjust a
   balance with an audit-logged reason → toggle a jurisdiction status →
   toggle a feature flag.
4. Reconciliation job runs clean (no drift) after a batch of concurrent
   simulated plays in the test suite.
5. `npm run build` and `npm test` pass in both `backend/` and `frontend/`.
6. Nothing in the diff touches Scout's existing files.

## Path to Phase 2 (not built now, sequenced here for continuity)

1. Real geolocation vendor behind `GeolocationProvider`.
2. Real KYC vendor behind `KycProvider`; enable `kyc.required_for_redemption`.
3. Crash, Limbo, Blackjack, Roulette, Keno Originals.
4. First real third-party game aggregator behind `GameProviderAdapter`.
5. Chat + leaderboards UI on top of existing schema/gateway.
6. Automated risk rule engine.
7. CMS admin UI.
8. AMOE management UI.

## Path to Phase 3 (explicitly gated on legal/business approval, not an
engineering task)

Payment processor integration, redemption/payout provider integration,
enabling any real jurisdiction, RNG/security audit of the provably-fair
implementation, penetration test, load test, disaster-recovery test,
compliance review — per spec §46. None of this is scheduled by this
codebase; it's unlocked by feature flags that stay off until counsel and
the relevant vendors sign off.
