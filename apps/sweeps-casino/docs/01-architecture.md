# System Architecture — Sweeps Casino Platform

> Codename working title: **"Vaultline"** (placeholder brand name, easily
> swapped — see `docs/06-phase1-plan.md` for what "brand" means at MVP
> stage). All naming here is original and unaffiliated with any existing
> operator.

## 1. Goals and non-goals

**Goals**
- A dual-currency (GC / SC) social casino, architected so that every
  SC-adjacent feature (issuance, redemption, payments, geolocation
  enforcement) is controlled by config + feature flags and can ship
  *disabled* until legal/compliance sign-off.
- An append-only, reconcilable ledger as the source of truth for all
  balances — no code path ever writes a balance directly.
- A provider-abstraction layer so third-party game aggregators, KYC
  vendors, geolocation vendors, and payment processors can be swapped
  without touching wallet/game logic.
- A modular monolith with domain boundaries clean enough to peel into
  services later (wallet/ledger is the first candidate given its isolation
  requirements).

**Non-goals (explicitly out of scope until Phase 3 + legal approval)**
- Real-money payment processing.
- Real SC redemption/payout.
- Real KYC vendor integration.
- Real geolocation vendor integration.
- Multi-region/multi-cloud deployment.
- Native mobile apps.

## 2. High-level component diagram

```
                                   ┌─────────────────────────┐
                                   │        Cloudflare        │
                                   │   CDN / WAF / DDoS / DNS  │
                                   └────────────┬─────────────┘
                                                │
                     ┌──────────────────────────┼──────────────────────────┐
                     │                          │                          │
             ┌───────▼────────┐        ┌────────▼─────────┐      ┌─────────▼────────┐
             │   Web Frontend   │        │   Admin Frontend  │      │  WebSocket Gateway │
             │  Next.js (React) │        │   Next.js (React) │      │  (chat, live feed, │
             │  apps/frontend   │        │  apps/admin-web    │      │   balance pushes)  │
             └───────┬────────┘        └────────┬─────────┘      └─────────┬────────┘
                     │ REST/JSON (HTTPS)         │ REST/JSON                │ WSS
                     └──────────────┬─────────────┴──────────────────────────┘
                                    │
                          ┌─────────▼──────────┐
                          │   API Gateway edge   │   rate limiting, auth guard,
                          │  (NestJS HTTP layer) │   request validation, CSRF
                          └─────────┬──────────┘
                                    │
      ┌─────────────────────────────┼──────────────────────────────────────┐
      │                     NestJS Modular Monolith (apps/backend)          │
      │                                                                     │
      │  ┌───────────┐ ┌───────────┐ ┌────────────┐ ┌───────────┐          │
      │  │   AUTH     │ │   USER     │ │  WALLET/    │ │  CASINO    │       │
      │  │            │ │            │ │  LEDGER     │ │ (Originals)│       │
      │  └───────────┘ └───────────┘ └────────────┘ └───────────┘          │
      │  ┌───────────┐ ┌───────────┐ ┌────────────┐ ┌───────────┐          │
      │  │  GAME_     │ │ PROMOTIONS │ │    VIP      │ │  PAYMENTS  │       │
      │  │  PROVIDER  │ │            │ │            │ │            │       │
      │  └───────────┘ └───────────┘ └────────────┘ └───────────┘          │
      │  ┌───────────┐ ┌───────────┐ ┌────────────┐ ┌───────────┐          │
      │  │REDEMPTIONS │ │    KYC     │ │    RISK     │ │ COMPLIANCE │       │
      │  └───────────┘ └───────────┘ └────────────┘ └───────────┘          │
      │  ┌───────────┐ ┌───────────┐ ┌────────────┐                        │
      │  │   ADMIN    │ │NOTIFICATIONS│ │  SUPPORT   │                       │
      │  └───────────┘ └───────────┘ └────────────┘                        │
      └───────────┬───────────────────────────────┬───────────────────────┘
                  │                               │
        ┌─────────▼─────────┐           ┌─────────▼─────────┐
        │   PostgreSQL (RDS)  │           │   Redis (cache +    │
        │  primary + replica  │           │   BullMQ job queue)  │
        └─────────────────────┘           └─────────────────────┘
                  │
        ┌─────────▼─────────┐
        │  S3-compatible      │   KYC documents, CMS media,
        │  object storage      │   provably-fair seed archive
        └─────────────────────┘

  External provider boundary (all behind adapter interfaces, all mocked in Phase 1):
  ┌────────────┐ ┌────────────┐ ┌────────────┐ ┌────────────┐ ┌────────────┐
  │ Game        │ │ Live Casino │ │ KYC vendor  │ │ Geolocation │ │  Payment    │
  │ aggregators │ │ providers   │ │             │ │ vendor      │ │  processor  │
  └────────────┘ └────────────┘ └────────────┘ └────────────┘ └────────────┘
```

## 3. Domain modules (modular monolith)

Each module below is a NestJS module with its own controllers, services,
DTOs, and Prisma repository access, communicating with other modules only
through injected service interfaces (never reaching into another module's
Prisma models directly). This is the seam future service extraction will
cut along.

| Module | Responsibility | Owns tables |
|---|---|---|
| `AUTH` | Registration, login, sessions, 2FA, password reset, device/login history | `users` (auth fields), `sessions`, `devices`, `login_events` |
| `USER` | Profile, preferences, responsible-play controls, self-exclusion | `profiles`, `responsible_play_controls` |
| `WALLET` | GC/SC balances derived from ledger, transaction posting API, idempotency | `wallets`, `ledger_entries` |
| `CASINO` | Game catalog, lobby sections, favorites, recently played, Originals game engines | `games`, `game_categories`, `favorites`, `recently_played`, `game_rounds` |
| `GAME_PROVIDER` | Provider abstraction, session/launch tokens, callback authentication, idempotent settlement | `game_providers`, `provider_sessions`, `provider_transactions` |
| `PROMOTIONS` | Generic promo engine (daily bonus, challenges, raffles, promo codes, AMOE) | `promotions`, `promotion_claims`, `amoe_requests` |
| `VIP` | Levels, progression metrics, rank-up rewards | `vip_levels`, `vip_progress`, `vip_rewards` |
| `PAYMENTS` | Abstract payment provider, GC purchase flow (flagged off) | `payment_methods`, `payments` |
| `REDEMPTIONS` | SC redemption workflow (flagged off) | `redemptions`, `redemption_audit` |
| `KYC` | Verification status machine, document intake abstraction | `kyc_records`, `kyc_documents` |
| `RISK` | Rule evaluation, signals, outcomes | `risk_events`, `risk_rules` |
| `COMPLIANCE` | Jurisdiction status table, versioned config, feature flags, age rules | `jurisdictions`, `compliance_config_versions`, `feature_flags` |
| `ADMIN` | RBAC, admin users/roles, audit log | `admin_users`, `admin_roles`, `audit_logs` |
| `NOTIFICATIONS` | In-app/email/SMS/push dispatch, opt-outs | `notifications`, `notification_preferences` |
| `SUPPORT` | Tickets | `support_tickets`, `support_messages` |

## 4. Ledger architecture (the core of the system)

See `docs/02-database-schema.md §Ledger` for the full table design. Summary
of the invariants every module must respect:

1. **`wallets.balance` is a materialized cache, never authoritative.** The
   authoritative value is `SUM(ledger_entries.amount)` for that
   `wallet_id`. A nightly (and on-demand) reconciliation job recomputes
   balances from the ledger and alerts if the cached value drifts.
2. **Every balance change is one `ledger_entries` row.** Rows are
   immutable — no `UPDATE`/`DELETE` in application code (enforced with a
   Postgres trigger that rejects both). Reversals are new rows
   (`type = REFUND` / `ROLLBACK`), never edits.
3. **Every ledger entry carries `balance_before` and `balance_after`** for
   that wallet, computed inside the same DB transaction under a row lock
   (`SELECT ... FOR UPDATE` on the wallet row) so concurrent plays cannot
   interleave and produce an inconsistent running balance.
4. **Idempotency keys.** Every mutating wallet operation (bet, win,
   refund, provider callback, promo claim, daily bonus claim) requires a
   caller-supplied idempotency key. The `(wallet_id, idempotency_key)`
   pair is unique-constrained; a retried request with the same key returns
   the original result instead of double-posting. This is what makes
   "duplicate WIN callback only credits once" a database guarantee, not an
   application convention.
5. **Currency isolation.** `ledger_entries.currency` is `GC` or `SC`.
   There is no transaction type that debits one currency and credits the
   other — the schema has no foreign key path that would allow it, and a
   check constraint enforces `currency` consistency between the entry and
   its wallet.
6. **Escrow pattern for game rounds.** A bet does not simply decrement the
   player wallet; it posts a `BET` entry (player wallet, negative) and the
   round is tracked in `game_rounds` with a `status`. The settling `WIN`/
   `REFUND` entry references the same `game_round_id`. This makes a round
   auditable end-to-end and lets reconciliation compute "total wagered vs.
   total returned" per round type.

## 5. Provider abstraction layers

Three parallel adapter interfaces, all defined in `packages/shared` (or
`libs/` in Nest terms) as TypeScript interfaces, with a `mock` and (later)
`live` implementation registered via DI token:

```ts
interface GameProviderAdapter {
  getGames(): Promise<ProviderGame[]>;
  launchGame(params: LaunchParams): Promise<LaunchSession>;
  validateSession(token: string): Promise<SessionValidation>;
  processTransaction(tx: ProviderTxRequest): Promise<ProviderTxResult>; // idempotent
  processWin(tx: ProviderTxRequest): Promise<ProviderTxResult>;         // idempotent
  rollbackTransaction(txId: string): Promise<ProviderTxResult>;
  getBalance(userId: string, currency: 'GC' | 'SC'): Promise<number>;
}

interface KycProvider {
  startVerification(userId: string, payload: KycPayload): Promise<KycSession>;
  getStatus(sessionId: string): Promise<KycStatus>;
  handleWebhook(payload: unknown, signature: string): Promise<KycWebhookResult>;
}

interface GeolocationProvider {
  resolve(ip: string, deviceSignal?: DeviceSignal): Promise<GeoResult>; // state, vpnRisk
}

interface PaymentProvider {
  createPayment(req: CreatePaymentRequest): Promise<PaymentIntent>;
  confirmPayment(id: string): Promise<PaymentResult>;
  refundPayment(id: string, amount?: number): Promise<RefundResult>;
  handleWebhook(payload: unknown, signature: string): Promise<PaymentWebhookResult>;
  getPaymentStatus(id: string): Promise<PaymentStatus>;
}
```

Phase 1 ships `MockGameProvider` (backs the Originals via the internal
`CASINO` module directly — Originals are "first-party," not routed through
the external adapter, since we author them), `MockKycProvider`,
`MockGeolocationProvider` (reads an admin-settable header/query override in
non-prod, defaults to an allowed state), and `MockPaymentProvider`
(simulates success/decline without touching money). Swapping in a real
vendor later is a new class implementing the interface plus a DI binding
change — no controller/service code changes.

## 6. Provably fair design (Originals)

- `server_seed` generated server-side per active seed pair, only its
  SHA-256 hash shown to the player before play.
- `client_seed` player-editable, defaults to a random value.
- `nonce` increments per bet under that seed pair.
- Result derivation: `HMAC_SHA256(server_seed, `${client_seed}:${nonce}`)`
  → bytes sliced/mapped into the game's outcome space (e.g. dice roll
  0.00–100.00, mine positions, plinko path). Implementation lives in
  `libs/provably-fair` so every Original (Dice, Mines, Plinko now; Crash,
  Limbo, Roulette, Blackjack, Keno in Phase 2) shares one audited
  primitive instead of reimplementing HMAC math per game.
- On seed rotation, the previous `server_seed` is revealed and archived;
  the player (or anyone) can recompute any past round from
  `(server_seed, client_seed, nonce)` via the `/provably-fair/verify`
  endpoint and the public verification page.
- **This RNG implementation is not audited.** Phase 1 ships it for GC-only
  play behind the `originals.sc_enabled` flag defaulting to `false`. It
  must pass external security/fairness review before SC wagering on
  Originals is enabled — this is a standing TODO tracked in
  `docs/06-phase1-plan.md`, not a decision this codebase makes.

## 7. Jurisdiction & compliance enforcement path

Every request that touches money-adjacent state (registration, SC
gameplay, redemption, purchase) passes through a `ComplianceGuard`:

```
request → resolve jurisdiction (GeolocationProvider + user.stateOfRecord)
        → look up jurisdictions[state].status
        → status in {BLOCKED, REGISTRATION_DISABLED, SC_DISABLED, GC_ONLY, REDEMPTION_DISABLED, ALLOWED}
        → guard allows/denies the specific action being attempted
        → denial is logged (compliance_config_versions references which config version decided it)
```

The jurisdiction table, age minimums, and every other compliance value are
**data**, editable only by `COMPLIANCE`-role admins, versioned on every
change (`compliance_config_versions`). Nothing here is hard-coded, and
nothing here asserts legality — the software enforces whatever the
currently configured values say.

## 8. Feature flags

A `feature_flags` table (`key`, `enabled`, `rollout_meta`, `updated_by`,
`updated_at`) gates every SC-adjacent capability. Phase 1 default state:

| Flag | Default |
|---|---|
| `sc.enabled` | `false` |
| `sc.promotional_issuance_enabled` | `false` |
| `originals.sc_enabled` | `false` |
| `payments.purchases_enabled` | `false` |
| `redemptions.enabled` | `false` |
| `kyc.required_for_redemption` | `true` (config, inert while redemptions disabled) |
| `geolocation.enforcement_enabled` | `true` (mock provider active) |

Flags are read through a single `FeatureFlagService` with an in-process
Redis-backed cache (short TTL) so a flag flip in the admin panel takes
effect within seconds without a redeploy.

## 9. Real-time architecture

A single WebSocket gateway (`apps/backend` Nest Gateway, namespace-split:
`/ws/chat`, `/ws/activity`, `/ws/wallet`) backed by Redis pub/sub so it can
scale horizontally later. Wallet balance changes publish an event after
the DB transaction commits (never before) so the client never sees an
optimistic balance that could be rolled back.

## 10. Environments

`LOCAL` (docker-compose: Postgres, Redis, backend, frontend) → `DEVELOPMENT`
→ `STAGING` → `PRODUCTION`. Same Docker images promoted between
environments; only environment variables and the compliance config differ.
Real financial actions are structurally impossible outside `PRODUCTION`
because `PaymentProvider`/`KycProvider`/`GeolocationProvider` bindings for
non-prod environments are always the mock implementations at the DI
container level, not a runtime `if (env === 'prod')` branch that could be
misconfigured.

## 11. Tech stack (Phase 1 concrete choices)

| Layer | Choice |
|---|---|
| Frontend | Next.js 14 (App Router), React 18, TypeScript, Tailwind CSS |
| Backend | NestJS 10, TypeScript |
| DB | PostgreSQL 16 |
| ORM | Prisma |
| Cache/Queue | Redis + BullMQ |
| Realtime | Socket.IO (Nest Gateway) over Redis adapter |
| Auth | argon2id password hashing, JWT access + rotating refresh tokens, TOTP for 2FA |
| Object storage | S3-compatible (MinIO locally, S3 in cloud) |
| Containerization | Docker + docker-compose (local/staging parity) |
| CI | GitHub Actions |

Infrastructure-as-code (Terraform), Cloudflare WAF/CDN wiring, and cloud
deployment are Phase 2/3 concerns — see `docs/06-phase1-plan.md`. Phase 1
runs locally/staging via Docker Compose only.
