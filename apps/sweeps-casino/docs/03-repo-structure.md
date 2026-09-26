# Repository Structure

The casino platform lives entirely under `apps/sweeps-casino/` in this
repo, alongside the pre-existing, untouched `Scout` app at repo root
(`app/`, `components/`, `lib/`, root `package.json`, etc.). The two apps
share nothing — no shared `node_modules`, no shared Prisma client, no
imports across the boundary — so Scout's deploy/dev workflow is
unaffected. If this product outgrows the monorepo, `apps/sweeps-casino/`
can be `git subtree split` into its own repository without history loss.

```
Send-A-Shot/
├── app/, components/, lib/, scripts/, ...   ← Scout (untouched)
├── package.json                             ← Scout (untouched)
│
└── apps/
    └── sweeps-casino/
        ├── docs/
        │   ├── 01-architecture.md
        │   ├── 02-database-schema.md
        │   ├── 03-repo-structure.md         ← this file
        │   ├── 04-screen-map.md
        │   ├── 05-api-design.md
        │   └── 06-phase1-plan.md
        │
        ├── backend/                          NestJS modular monolith
        │   ├── prisma/
        │   │   ├── schema.prisma
        │   │   ├── migrations/
        │   │   └── seed.ts
        │   ├── src/
        │   │   ├── main.ts
        │   │   ├── app.module.ts
        │   │   ├── common/                   guards, interceptors, filters, decorators
        │   │   │   ├── guards/
        │   │   │   │   ├── jwt-auth.guard.ts
        │   │   │   │   ├── roles.guard.ts
        │   │   │   │   ├── compliance.guard.ts
        │   │   │   │   └── feature-flag.guard.ts
        │   │   │   ├── interceptors/
        │   │   │   ├── filters/
        │   │   │   └── decorators/
        │   │   ├── config/                   typed env/config module
        │   │   ├── prisma/                   PrismaService (DI-wrapped client)
        │   │   ├── libs/
        │   │   │   ├── provably-fair/        HMAC seed/result primitives, shared by all Originals
        │   │   │   └── money/                fixed-point currency helpers (no floats)
        │   │   ├── modules/
        │   │   │   ├── auth/
        │   │   │   ├── user/
        │   │   │   ├── wallet/               ledger posting API — the only writer of ledger_entries
        │   │   │   ├── casino/
        │   │   │   │   ├── catalog/          games, categories, favorites, recently-played
        │   │   │   │   └── originals/
        │   │   │   │       ├── dice/
        │   │   │   │       ├── mines/
        │   │   │   │       └── plinko/
        │   │   │   ├── game-provider/        adapter interfaces + mock + registry
        │   │   │   ├── promotions/
        │   │   │   ├── vip/
        │   │   │   ├── payments/             adapter interface + mock (flagged off)
        │   │   │   ├── redemptions/          (flagged off)
        │   │   │   ├── kyc/                  adapter interface + mock
        │   │   │   ├── risk/
        │   │   │   ├── compliance/           jurisdictions, feature flags, config versions
        │   │   │   ├── admin/                RBAC, audit log, admin-facing endpoints per domain
        │   │   │   ├── notifications/
        │   │   │   ├── support/
        │   │   │   └── realtime/             WS gateway (chat, activity feed, wallet push)
        │   │   └── jobs/                     BullMQ processors (reconciliation, notifications, VIP period reset)
        │   ├── test/
        │   │   ├── unit/
        │   │   ├── integration/
        │   │   └── e2e/
        │   ├── .env.example
        │   ├── Dockerfile
        │   ├── nest-cli.json
        │   ├── package.json
        │   └── tsconfig.json
        │
        ├── frontend/                         Next.js 14 App Router
        │   ├── app/
        │   │   ├── (auth)/
        │   │   │   ├── login/
        │   │   │   ├── register/
        │   │   │   └── forgot-password/
        │   │   ├── (main)/                   authenticated shell: sidebar + topbar + chat panel
        │   │   │   ├── page.tsx              Casino Home
        │   │   │   ├── casino/
        │   │   │   │   ├── originals/[slug]/
        │   │   │   │   ├── slots/
        │   │   │   │   ├── live-casino/
        │   │   │   │   ├── table-games/
        │   │   │   │   ├── game-shows/
        │   │   │   │   └── search/
        │   │   │   ├── rewards/
        │   │   │   │   ├── promotions/
        │   │   │   │   ├── daily-bonus/
        │   │   │   │   ├── vip-club/
        │   │   │   │   ├── challenges/
        │   │   │   │   └── raffles/
        │   │   │   ├── social/
        │   │   │   │   ├── chat/
        │   │   │   │   └── leaderboards/
        │   │   │   └── account/
        │   │   │       ├── wallet/
        │   │   │       ├── transactions/
        │   │   │       ├── redemptions/
        │   │   │       ├── profile/
        │   │   │       ├── responsible-play/
        │   │   │       ├── security/
        │   │   │       └── support/
        │   │   ├── provably-fair/            public verification page
        │   │   └── legal/                    terms, privacy, sweepstakes rules (CMS-backed)
        │   ├── components/
        │   │   ├── layout/                   Sidebar, Topbar, MobileNav, ChatPanel
        │   │   ├── casino/                   GameTile, GameRow, GameGrid, SkeletonTile
        │   │   ├── wallet/                   CurrencySwitcher, BalancePill, WalletModal
        │   │   ├── rewards/
        │   │   ├── ui/                        design-system primitives (Button, Card, Modal, Tabs...)
        │   │   └── admin/
        │   ├── lib/
        │   │   ├── api-client.ts             typed fetch wrapper against backend OpenAPI types
        │   │   ├── ws-client.ts
        │   │   └── hooks/
        │   ├── styles/
        │   │   └── globals.css               design tokens (see docs/01 §Branding notes)
        │   ├── public/
        │   ├── .env.example
        │   ├── Dockerfile
        │   ├── next.config.js
        │   ├── tailwind.config.ts
        │   ├── package.json
        │   └── tsconfig.json
        │
        ├── admin-web/                        Phase 1: folded into frontend under /admin behind RBAC
        │                                      route guard; split into its own Next.js app in Phase 2
        │                                      once admin traffic/deploy cadence diverges from player-facing.
        │
        ├── docker-compose.yml                postgres, redis, backend, frontend (local/staging parity)
        ├── .env.example                      compose-level shared vars
        └── README.md                         quickstart for this app specifically
```

## Conventions

- **No cross-app imports.** `apps/sweeps-casino` never imports from Scout's
  root `app/`/`lib/`, and vice versa. If code needs sharing later, it goes
  in an explicit `apps/sweeps-casino/packages/shared` — not a reach across
  app boundaries.
- **Module boundary discipline in the backend.** A module may only access
  another module's data through that module's exported service — never by
  importing another module's Prisma model directly. This is what keeps the
  "modular monolith → services" extraction path open (spec §33).
- **`libs/provably-fair` and `libs/money` are dependency-free of Nest**
  (plain TypeScript) so they can be unit-tested in isolation and reused by
  a future standalone verification CLI or a peeled-out service.
- **Admin endpoints live inside each domain module** (e.g.
  `modules/wallet/admin-wallet.controller.ts`) rather than one giant admin
  module, guarded by `@Roles(...)` + `RolesGuard`, so wallet-admin logic
  stays next to wallet logic. `modules/admin/` itself only owns
  RBAC/roles/audit-log plumbing and the admin dashboard aggregate
  endpoints.
