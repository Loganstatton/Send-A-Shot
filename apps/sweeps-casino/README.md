# Sweeps Casino Platform — Phase 1

A US social/sweepstakes casino platform: dual-currency (GC entertainment
coins / SC sweepstakes coins), server-authoritative provably-fair
Originals, an append-only reconcilable ledger, jurisdiction + feature-flag
gating, and an admin control panel. See `docs/` for the full design:

1. [`docs/01-architecture.md`](docs/01-architecture.md) — system architecture
2. [`docs/02-database-schema.md`](docs/02-database-schema.md) — database schema / ERD
3. [`docs/03-repo-structure.md`](docs/03-repo-structure.md) — repository structure
4. [`docs/04-screen-map.md`](docs/04-screen-map.md) — screen map
5. [`docs/05-api-design.md`](docs/05-api-design.md) — API design
6. [`docs/06-phase1-plan.md`](docs/06-phase1-plan.md) — Phase 1 implementation plan (what ships now vs. later, and why)

**This app lives entirely under `apps/sweeps-casino/` in the
`Send-A-Shot` repo, alongside the unrelated pre-existing `Scout` app at
repo root. The two share no code, no database, and no deploy path.**

## What Phase 1 actually is

No real money moves anywhere in this codebase. KYC, geolocation,
payments, and redemption payout are all mock providers implementing the
real adapter interfaces (see `docs/01-architecture.md §5`) so a real
vendor is a binding change later, not a rewrite. Every SC-adjacent
capability (SC issuance, SC gameplay, purchases, redemptions) ships
**disabled by default** via `feature_flags`, and every US jurisdiction
seeds to `REGISTRATION_DISABLED` except a small demo allowlist — see
`docs/06-phase1-plan.md` for the full "what ships / what doesn't" list.

## Quickstart (local)

```bash
cd apps/sweeps-casino
cp backend/.env.example backend/.env
cp frontend/.env.example frontend/.env

docker compose up -d postgres redis

cd backend
npm install
npx prisma migrate deploy   # or: npx prisma migrate dev, on first run
npm run seed
npm run start:dev           # http://localhost:4000/api/v1

cd ../frontend
npm install
npm run dev                 # http://localhost:3100
```

Or run the whole stack in containers: `docker compose up --build` from
`apps/sweeps-casino/`.

## Demo accounts (seeded)

| Role | Email | Password | Notes |
|---|---|---|---|
| Player | player@demo.sweeps-casino.local | DemoPass123! | Standard player, GC + SC sandbox balances |
| VIP Player | vip-player@demo.sweeps-casino.local | DemoPass123! | Pre-progressed VIP rank |
| Support Admin | support-admin@demo.sweeps-casino.local | DemoPass123! | `SUPPORT` role |
| Compliance Admin | compliance-admin@demo.sweeps-casino.local | DemoPass123! | `COMPLIANCE` role |
| Super Admin | super-admin@demo.sweeps-casino.local | DemoPass123! | `SUPER_ADMIN` role — full admin panel access |

Log into the frontend at `/login`, or the admin panel at `/admin` with
the `super-admin` account. All balances are sandbox-only.

## Tests

```bash
cd backend && npm test
```

Wallet/ledger correctness (idempotency, concurrent-play row locking,
rollback, insufficient balance) and provably-fair determinism are the
highest-priority coverage — see `docs/06-phase1-plan.md §Tests`.

## Not yet built (by design)

Real payment/KYC/geolocation/redemption-payout vendors, live casino,
third-party game aggregators, chat/leaderboard UI, automated risk rules,
CMS UI, AWS/Terraform deployment. All scoped to Phase 2/3 in
`docs/06-phase1-plan.md` and gated on legal/compliance approval where
relevant — this is an engineering plan, not a legal determination.
