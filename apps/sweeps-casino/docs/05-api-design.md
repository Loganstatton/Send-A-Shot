# API Design

REST + JSON over HTTPS, versioned under `/api/v1`. WebSocket namespaces
listed separately at the end. Auth: `Authorization: Bearer <access JWT>`
except the auth endpoints themselves. All mutating endpoints that touch
money/game state require an `Idempotency-Key` header, stored against
`(user/wallet, key)` per `docs/02-database-schema.md`.

Every response envelope:
```json
{ "data": { ... }, "meta": { "requestId": "..." } }
```
Errors:
```json
{ "error": { "code": "INSUFFICIENT_BALANCE", "message": "...", "requestId": "..." } }
```

## Auth — `/api/v1/auth`

| Method | Path | Notes |
|---|---|---|
| POST | `/register` | body: email, password, username, dob, stateOfRecord. Runs age + jurisdiction check before creating the user. |
| POST | `/login` | returns access token (short-lived) + sets httpOnly refresh cookie; if 2FA enabled, returns `{ challenge: "TOTP", challengeToken }` instead |
| POST | `/login/2fa` | body: challengeToken, code |
| POST | `/refresh` | rotates refresh token, reuse of a revoked token revokes the session family |
| POST | `/logout` | revokes current session |
| POST | `/verify-email` | body: token |
| POST | `/forgot-password` | |
| POST | `/reset-password` | body: token, newPassword |
| GET | `/sessions` | list active sessions/devices for current user |
| DELETE | `/sessions/:id` | revoke a specific session |

Rate-limited (per IP + per email) on `/login`, `/register`,
`/forgot-password`.

## User — `/api/v1/me`

| Method | Path | Notes |
|---|---|---|
| GET | `/me` | profile + kycStatus + vip summary + feature flags relevant to this user |
| PATCH | `/me/profile` | display name, avatar, chat anonymization, marketing opt-in |
| POST | `/me/password` | change password (requires current password) |
| GET | `/me/responsible-play` | current limits/exclusion state |
| PATCH | `/me/responsible-play` | set limits/cooling-off; **self-exclusion is POST-only, one-directional** (see below) |
| POST | `/me/responsible-play/self-exclude` | body: durationDays \| permanent — cannot be undone by this endpoint |
| POST | `/me/responsible-play/close-account` | |

## Wallet — `/api/v1/wallet`

| Method | Path | Notes |
|---|---|---|
| GET | `/wallet` | both wallets: `{ gc: {balance}, sc: {balance, eligible, locked} }` |
| GET | `/wallet/transactions?currency=&type=&cursor=` | paginated ledger history |
| GET | `/wallet/transactions/:id` | single ledger entry detail |

Wallet is **never** exposed with a raw "set balance" endpoint — the only
way a balance changes is through a domain action (game round, promo
claim, admin adjustment, payment, redemption), each of which posts
ledger entries via the internal `WalletService.postEntries()` API, which
is not directly reachable from any controller. Balances are computed,
not set.

## Casino catalog — `/api/v1/casino`

| Method | Path | Notes |
|---|---|---|
| GET | `/casino/sections` | home lobby sections (Recently Played, Favorites, Originals, Trending, ...), each paginated |
| GET | `/casino/games?category=&provider=&tag=&sort=&cursor=` | catalog browse/search, cursor-paginated |
| GET | `/casino/games/:slug` | game detail |
| POST | `/casino/favorites/:gameId` / DELETE | toggle favorite |
| GET | `/casino/recently-played` | |

## Originals — `/api/v1/casino/originals/:game`

`:game` ∈ `dice`, `mines`, `plinko` in Phase 1.

| Method | Path | Notes |
|---|---|---|
| GET | `/casino/originals/:game/config` | min/max bet, house edge, current hashed server seed |
| POST | `/casino/originals/:game/play` | **Idempotency-Key required.** Body: currency, betAmount, game-specific params (e.g. dice target/direction). Server computes result via `libs/provably-fair`, posts `BET` + `WIN`/nothing ledger entries atomically, returns round result + new balance. |
| GET | `/casino/originals/:game/history` | this user's past rounds for this game |
| GET | `/casino/originals/seeds` | current active seed pair (hash only) + rotation history |
| POST | `/casino/originals/seeds/rotate` | body: newClientSeed (optional); reveals previous server seed |
| PATCH | `/casino/originals/seeds/client-seed` | change client seed without rotating server seed |

## Provably fair — `/api/v1/provably-fair`

| Method | Path | Notes |
|---|---|---|
| POST | `/verify` | body: serverSeed, clientSeed, nonce, game → recomputes and returns the deterministic result, for public/independent verification |

## Promotions — `/api/v1/promotions`

| Method | Path | Notes |
|---|---|---|
| GET | `/promotions?type=&status=active` | eligible promotions for current user (jurisdiction/VIP/KYC filters applied server-side) |
| GET | `/promotions/:id` | detail incl. terms |
| POST | `/promotions/:id/claim` | **Idempotency-Key required.** Validates eligibility (age of account, jurisdiction, KYC, VIP level, claim limits, max participants) then posts ledger entries |
| GET | `/promotions/daily-bonus` | today's streak state |
| POST | `/promotions/daily-bonus/claim` | shorthand for the daily-bonus promotion claim |
| POST | `/promotions/codes/redeem` | body: code |
| GET | `/promotions/claims` | this user's claim history |

## VIP — `/api/v1/vip`

| Method | Path | Notes |
|---|---|---|
| GET | `/vip/me` | current level, progress, next level, benefits, lifetime activity |
| GET | `/vip/levels` | public level ladder (names/benefits, not internal point formulas) |
| GET | `/vip/rewards` | this user's issued VIP reward history |
| POST | `/vip/rewards/:id/claim` | for rewards that require manual claim vs. auto-grant |

## Payments — `/api/v1/payments` (all return `403 FEATURE_DISABLED` while `payments.purchases_enabled=false`)

| Method | Path |
|---|---|
| GET | `/payments/packages` |
| POST | `/payments/checkout` |
| GET | `/payments/history` |
| POST | `/payments/webhook/:providerId` — signature-verified, idempotent on `(providerId, provider_payment_ref)`, always live even while purchases are disabled so provider retries during integration testing don't fail loudly |

## Redemptions — `/api/v1/redemptions` (all except GET return `403 FEATURE_DISABLED` while `redemptions.enabled=false`)

| Method | Path | Notes |
|---|---|---|
| GET | `/redemptions/eligibility` | reports which gate is blocking (KYC/jurisdiction/balance/flag) even when disabled, so UI can explain state |
| POST | `/redemptions` | create a redemption request; runs eligibility → jurisdiction → KYC → risk checks server-side, in that order, and returns the specific failing check |
| GET | `/redemptions` | this user's history |
| GET | `/redemptions/:id` | |
| POST | `/redemptions/:id/cancel` | only while `status=PENDING` |

## KYC — `/api/v1/kyc`

| Method | Path | Notes |
|---|---|---|
| GET | `/kyc/status` | |
| POST | `/kyc/start` | initiates verification via the active `KycProvider` (mock in P1) |
| POST | `/kyc/documents` | multipart upload → stored to S3-compatible storage, never returned as a public URL |
| POST | `/kyc/webhook/:providerId` | signature-verified provider callback |

## AMOE — `/api/v1/amoe`

| Method | Path |
|---|---|
| POST | `/amoe/requests` |
| GET | `/amoe/requests` (own) |

## Notifications — `/api/v1/notifications`

| Method | Path |
|---|---|
| GET | `/notifications?unread=true` |
| POST | `/notifications/:id/read` |
| GET/PATCH | `/notifications/preferences` |

## Support — `/api/v1/support`

| Method | Path |
|---|---|
| GET | `/support/faq` |
| POST | `/support/tickets` |
| GET | `/support/tickets` |
| GET | `/support/tickets/:id` |
| POST | `/support/tickets/:id/messages` |

## Activity feed — `/api/v1/activity`

| Method | Path | Notes |
|---|---|---|
| GET | `/activity?tab=all\|big-wins\|lucky-wins\|mine&cursor=` | REST fallback/initial page; live updates via WS |

## Compliance (public read) — `/api/v1/compliance`

| Method | Path |
|---|---|
| GET | `/compliance/jurisdiction-status` — resolves caller's state via geolocation, returns effective status + which features it enables |

---

## Admin API — `/api/v1/admin/*`

Every route below requires an `admin_users` session with a role whose
`permissions` include the named capability; `RolesGuard` + a
per-endpoint `@RequirePermission()` decorator enforce this, and every
mutating call writes an `audit_logs` row in the same transaction.

| Domain | Method | Path | Notes |
|---|---|---|---|
| Dashboard | GET | `/admin/dashboard` | aggregate metrics |
| Users | GET | `/admin/users?query=` | search by username/email/id/txn id |
| Users | GET | `/admin/users/:id` | full profile incl. balances, ledger, sessions, devices, kyc, risk, notes |
| Users | POST | `/admin/users/:id/adjust-balance` | `ADMIN_ADJUSTMENT` ledger entry; requires `reason` |
| Users | POST | `/admin/users/:id/status` | suspend/reinstate — cannot lift an active self-exclusion without `SUPER_ADMIN` + reason |
| Users | POST | `/admin/users/:id/notes` | |
| Ledger | GET | `/admin/ledger/reconciliation` | latest reconciliation run results |
| Ledger | POST | `/admin/ledger/reconciliation/run` | on-demand run |
| Games | GET/POST/PATCH | `/admin/games`, `/admin/games/:id` | activate, feature, reorder, tag, jurisdiction-restrict, maintenance |
| Providers | GET/POST/PATCH | `/admin/game-providers` | |
| Promotions | GET/POST/PATCH | `/admin/promotions`, `/admin/promotions/:id` | full CRUD on the generic model |
| AMOE | GET/PATCH | `/admin/amoe/requests`, `/admin/amoe/requests/:id` | approve/reject with reason |
| VIP | GET/PATCH | `/admin/vip/levels` | edit ladder, multipliers, benefits, reward config |
| Compliance | GET/PATCH | `/admin/compliance/jurisdictions` | per-state status; every PATCH appends a `compliance_config_versions` row |
| Compliance | GET/PATCH | `/admin/compliance/feature-flags` | |
| Compliance | GET | `/admin/compliance/config-history?key=` | |
| KYC | GET | `/admin/kyc/queue` | |
| KYC | POST | `/admin/kyc/:recordId/decision` | approve/reject/review-required, with reason |
| KYC | GET | `/admin/kyc/:recordId/documents/:docId/signed-url` | short-lived signed URL, permission-checked |
| Risk | GET | `/admin/risk/events` | |
| Risk | POST | `/admin/risk/events/:id/resolve` | |
| Redemptions | GET | `/admin/redemptions` | |
| Redemptions | POST | `/admin/redemptions/:id/decision` | approve/reject/processing/paid, each a `redemption_audit` row |
| Payments | GET | `/admin/payments` | payments, chargebacks, disputes |
| Roles | GET/POST/PATCH | `/admin/roles`, `/admin/admin-users` | |
| Audit log | GET | `/admin/audit-log?actor=&target=&action=&cursor=` | |
| CMS | GET/POST/PATCH | `/admin/cms/banners`, `/admin/cms/pages` | |
| Support | GET/PATCH | `/admin/support/tickets` | |

---

## WebSocket namespaces

| Namespace | Direction | Payloads |
|---|---|---|
| `/ws/wallet` | server→client | `balance.updated { currency, balance, lastEntryId }` — emitted only after the posting transaction commits |
| `/ws/activity` | server→client | `round.settled { gameId, displayName (masked per user pref), amount, multiplier, currency, tab }` |
| `/ws/chat` | bidirectional | `message.send` (client→server), `message.new` / `message.deleted` / `user.muted` (server→client) |
| `/ws/notifications` | server→client | `notification.new` |

All WS connections authenticate via the access JWT on the handshake and
join a room scoped to `userId` for private channels (`wallet`,
`notifications`) vs. a global room for `activity`/`chat`.
