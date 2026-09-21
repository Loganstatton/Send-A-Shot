# Database Schema / ERD

PostgreSQL 16, all primary keys `UUID` (`gen_random_uuid()`), all tables
`created_at timestamptz default now()`, mutable tables also
`updated_at timestamptz`. This doc is the human-readable ERD; the
executable source of truth is `apps/sweeps-casino/backend/prisma/schema.prisma`.

## Entity-relationship overview

```
users ──1:1── profiles
  │ 1:N
  ├── sessions
  ├── devices
  ├── login_events
  ├── wallets (exactly 2 per user: GC, SC)
  │      │ 1:N
  │      └── ledger_entries ◄──────────────────────┐
  ├── kyc_records                                    │
  ├── responsible_play_controls (1:1)                │
  ├── favorites (N:M via games)                      │
  ├── recently_played                                │
  ├── game_rounds ──1:N── ledger_entries (referenced)│
  ├── promotion_claims ──N:1── promotions             │
  ├── vip_progress (1:1)                              │
  ├── redemptions ──N:1── payment_methods (payout)    │
  ├── payments ──N:1── payment_methods                │
  ├── risk_events                                     │
  ├── support_tickets ──1:N── support_messages         │
  ├── notifications                                   │
  └── provably_fair_seeds                             │
                                                        │
game_providers ──1:N── games ──1:N── game_rounds ──────┘
                            │
                            ├── favorites (N:M)
                            └── recently_played

jurisdictions (standalone, referenced by state code)
compliance_config_versions (standalone, audit trail)
feature_flags (standalone)

admin_users ──N:1── admin_roles
admin_users ──1:N── audit_logs

vip_levels (standalone config) ──1:N── vip_progress
promotions (standalone config) ──1:N── promotion_claims
amoe_requests ──N:1── promotions (optional)
```

## Core tables

### `users`
| column | type | notes |
|---|---|---|
| id | uuid PK | |
| email | citext unique | |
| email_verified_at | timestamptz null | |
| password_hash | text | argon2id |
| username | text unique | |
| display_name_masked | boolean default false | activity feed privacy |
| date_of_birth | date | |
| state_of_record | char(2) null | self-declared at signup, cross-checked by geolocation |
| status | enum(`ACTIVE`,`SUSPENDED`,`SELF_EXCLUDED`,`CLOSED`) | |
| totp_secret_enc | text null | encrypted at rest |
| totp_enabled | boolean default false | |
| backup_codes_enc | text[] null | encrypted, hashed individually |
| kyc_status | enum(`UNVERIFIED`,`PENDING`,`VERIFIED`,`REJECTED`,`REVIEW_REQUIRED`,`SUSPENDED`) default `UNVERIFIED` | denormalized from `kyc_records` for fast guard checks |
| created_at, updated_at | timestamptz | |

### `profiles`
1:1 with `users`. `avatar_url`, `country`, `timezone`, `marketing_opt_in`,
`chat_display_name`, `chat_anonymized boolean`.

### `sessions`
`id`, `user_id`, `refresh_token_hash`, `user_agent`, `ip`, `device_id`,
`expires_at`, `revoked_at null`. Refresh-token rotation: each refresh
issues a new row and revokes the old one; reuse of a revoked token
revokes the entire session family (theft detection).

### `devices`
`id`, `user_id`, `fingerprint_hash`, `first_seen_at`, `last_seen_at`,
`trusted boolean`. Used by RISK for shared-device signals.

### `login_events`
`id`, `user_id`, `device_id`, `ip`, `geo_state`, `result` enum(`SUCCESS`,
`FAILED_PASSWORD`,`FAILED_2FA`,`BLOCKED_JURISDICTION`,`BLOCKED_RISK`),
`created_at`.

## Wallet / ledger (the mission-critical core)

### `wallets`
| column | type | notes |
|---|---|---|
| id | uuid PK | |
| user_id | uuid FK → users | |
| currency | enum(`GC`,`SC`) | |
| balance | numeric(18,2) | **cached**, recomputed by reconciliation job |
| balance_verified_at | timestamptz | last time `balance` matched `SUM(ledger_entries)` |
| created_at | timestamptz | |

Unique constraint `(user_id, currency)` — exactly one wallet per currency
per user, created at signup.

### `ledger_entries` (append-only, immutable)
| column | type | notes |
|---|---|---|
| id | uuid PK | |
| wallet_id | uuid FK → wallets | |
| currency | enum(`GC`,`SC`) | must match `wallets.currency` (check constraint) |
| type | enum(`BET`,`WIN`,`REFUND`,`ROLLBACK`,`BONUS`,`PROMO_GRANT`,`DAILY_BONUS`,`PURCHASE`,`REDEMPTION_HOLD`,`REDEMPTION_PAYOUT`,`REDEMPTION_REVERSAL`,`ADMIN_ADJUSTMENT`,`VIP_REWARD`) | |
| amount | numeric(18,2) | signed; debits negative, credits positive |
| balance_before | numeric(18,2) | |
| balance_after | numeric(18,2) | |
| source | enum(`GAME`,`PROMOTION`,`PAYMENT`,`REDEMPTION`,`ADMIN`,`VIP`,`SYSTEM`) | |
| idempotency_key | text | unique per `wallet_id` |
| game_round_id | uuid FK → game_rounds null | |
| payment_id | uuid FK → payments null | |
| redemption_id | uuid FK → redemptions null | |
| promotion_claim_id | uuid FK → promotion_claims null | |
| admin_actor_id | uuid FK → admin_users null | |
| metadata | jsonb | free-form context, never the source of balance truth |
| created_at | timestamptz | |

Constraints:
- `UNIQUE (wallet_id, idempotency_key)`
- Postgres `BEFORE UPDATE OR DELETE` trigger raises an exception —
  application code has no path to mutate or remove a row.
- `CHECK` trigger validates `balance_after = balance_before + amount`
  computed under the row lock at insert time.

### `game_rounds`
| column | type | notes |
|---|---|---|
| id | uuid PK | |
| user_id | uuid FK | |
| game_id | uuid FK → games | |
| currency | enum(`GC`,`SC`) | |
| status | enum(`OPEN`,`SETTLED`,`REFUNDED`,`ROLLED_BACK`) | |
| bet_amount | numeric(18,2) | |
| win_amount | numeric(18,2) null | |
| multiplier | numeric(10,4) null | |
| server_seed_hash | text | shown to player before play |
| server_seed_revealed | text null | filled on seed rotation |
| client_seed | text | |
| nonce | bigint | |
| result_payload | jsonb | game-specific outcome (dice roll, mine grid, plinko path) |
| provider_id | uuid FK → game_providers null | null for first-party Originals |
| provider_round_ref | text null | external round id for idempotency against provider callbacks |
| created_at, settled_at | timestamptz | |

`UNIQUE (provider_id, provider_round_ref)` where not null — the idempotency
guarantee against duplicate provider callbacks.

### `provably_fair_seeds`
`id`, `user_id`, `server_seed` (encrypted until revealed), `server_seed_hash`,
`client_seed`, `nonce_counter`, `active boolean`, `revealed_at null`,
`created_at`.

## Casino catalog

### `game_providers`
`id`, `code` unique (e.g. `internal-originals`, `mock-aggregator`), `name`,
`type` enum(`INTERNAL`,`AGGREGATOR`,`LIVE_DEALER`), `status`
enum(`ACTIVE`,`MAINTENANCE`,`DISABLED`), `config jsonb` (adapter-specific
credentials/endpoints, encrypted at rest).

### `games`
| column | type | notes |
|---|---|---|
| id | uuid PK | |
| provider_id | uuid FK → game_providers | |
| provider_game_id | text | id in the provider's own catalog |
| name | text | |
| slug | text unique | |
| category | enum(`ORIGINALS`,`SLOTS`,`LIVE_CASINO`,`TABLE_GAMES`,`GAME_SHOWS`) | |
| tags | text[] | e.g. `NEW`, `HOT`, `HIGH_VOLATILITY` |
| image_url | text | |
| supported_currencies | enum[] (`GC`,`SC`) | |
| demo_available | boolean | |
| rtp_bps | int null | RTP in basis points, e.g. 9700 = 97.00% |
| volatility | enum(`LOW`,`MEDIUM`,`HIGH`) null | |
| status | enum(`ACTIVE`,`INACTIVE`,`MAINTENANCE`) | |
| restricted_jurisdictions | char(2)[] | states this game is unavailable in |
| sort_weight | int | admin-controlled lobby ordering |
| created_at, updated_at | timestamptz | |

### `favorites`
`(user_id, game_id)` composite PK.

### `recently_played`
`(user_id, game_id)` composite PK + `last_played_at`, `play_count` — upserted
per round settlement, trimmed to most-recent N per user by a background job.

## Promotions / VIP / Rewards

### `promotions`
| column | type |
|---|---|
| id | uuid PK |
| type | enum(`SIGNUP`,`DAILY`,`WEEKLY`,`MONTHLY`,`LEADERBOARD`,`RAFFLE`,`CHALLENGE`,`GAME_SPECIFIC`,`PROVIDER`,`PROMO_CODE`,`PURCHASE`,`SOCIAL`,`MANUAL`) |
| name, description, terms_url | text |
| status | enum(`DRAFT`,`ACTIVE`,`PAUSED`,`ENDED`) |
| starts_at, ends_at | timestamptz null |
| jurisdiction_allowlist | char(2)[] null (null = all allowed per compliance) |
| min_account_age_days | int null |
| requires_kyc | boolean |
| min_vip_level_id | uuid FK → vip_levels null |
| eligible_game_ids | uuid[] null |
| eligible_currency | enum(`GC`,`SC`,`BOTH`) |
| reward_config | jsonb | generic — amount, tiered schedule, streak table, raffle ticket rules, etc. |
| playthrough_requirement | jsonb null | `{ multiplier, eligibleGames, expiresInDays }` |
| claim_limit_per_user | int null |
| max_participants | int null |
| created_by | uuid FK → admin_users | |
| created_at, updated_at | timestamptz | |

Designed generically (`reward_config`/`playthrough_requirement` as jsonb
validated per `type` by a Zod schema in code) so new promotion types don't
require a migration or wallet code changes — only a new reward-config
schema + a resolver function.

### `promotion_claims`
`id`, `promotion_id`, `user_id`, `status` enum(`GRANTED`,`IN_PROGRESS`,
`COMPLETED`,`EXPIRED`,`REVOKED`), `granted_amount`, `currency`,
`playthrough_progress jsonb`, `claimed_at`, `completed_at null`.
`UNIQUE (promotion_id, user_id, claim_sequence)` where `claim_sequence`
supports repeatable promos (e.g. daily bonus) while still being
idempotency-safe.

### `amoe_requests`
`id`, `promotion_id null`, `user_id`, `method` enum(`MAIL_IN`,`WEB_FORM`,
`OTHER`), `submission_ref`, `status` enum(`RECEIVED`,`UNDER_REVIEW`,
`DUPLICATE`,`APPROVED`,`REJECTED`), `reviewed_by uuid FK → admin_users null`,
`reason text null`, `sc_awarded numeric null`, `created_at`, `decided_at`.

### `vip_levels`
`id`, `rank_order int unique`, `name` (configurable string, defaults to
Starter/Bronze/Silver/Gold/Platinum I-IV/Diamond/Elite), `min_points`,
`gc_points_multiplier`, `sc_points_multiplier` (independent GC/SC
contribution weights — admin configurable per §8 of the spec), `benefits
jsonb`, `rank_up_reward jsonb null`, `weekly_reward jsonb null`,
`monthly_reward jsonb null`, `rakeback_bps int null`.

### `vip_progress`
`user_id` PK/FK, `current_level_id`, `lifetime_points`, `period_points`
(resets per admin-configured period), `updated_at`.

### `vip_rewards` (issuance history)
`id`, `user_id`, `vip_level_id`, `type` enum(`RANK_UP`,`WEEKLY`,`MONTHLY`,
`RAKEBACK`,`RELOAD`,`MANUAL`), `amount`, `currency`, `ledger_entry_id FK`,
`created_at`.

## Payments / Redemptions (flagged off, schema present)

### `payment_methods`
`id`, `user_id`, `type` enum(`CARD`,`ACH`,`PAYPAL`,`OTHER`), `provider_ref`
(token from `PaymentProvider`, never raw card data), `status`, `created_at`.

### `payments`
`id`, `user_id`, `payment_method_id`, `provider_id text` (which
`PaymentProvider` impl), `provider_payment_ref`, `type` enum(`PURCHASE`,
`REFUND`,`CHARGEBACK`), `gc_package_id FK null`, `amount_usd`,
`status` enum(`PENDING`,`SUCCEEDED`,`FAILED`,`REFUNDED`,`DISPUTED`),
`risk_signals jsonb`, `created_at`, `settled_at null`.
`UNIQUE (provider_id, provider_payment_ref)` for webhook idempotency.

### `gc_packages`
`id`, `name`, `gc_amount`, `bonus_sc_promo_id FK null` (attaches an
approved SC promo to a GC purchase, per spec §6), `price_usd`, `active`.

### `redemptions`
| column | type |
|---|---|
| id | uuid PK |
| user_id | uuid FK |
| status | enum(`DRAFT`,`PENDING`,`UNDER_REVIEW`,`APPROVED`,`PROCESSING`,`PAID`,`REJECTED`,`CANCELLED`) |
| sc_amount | numeric |
| payout_method_id | uuid FK → payment_methods null |
| eligibility_snapshot | jsonb | KYC status, jurisdiction, SC-eligible balance at request time |
| risk_review jsonb null | |
| decided_by | uuid FK → admin_users null |
| created_at, decided_at, paid_at | timestamptz |

### `redemption_audit`
Append-only status-transition log: `redemption_id`, `from_status`,
`to_status`, `actor_id` (admin or system), `reason`, `created_at`. A
redemption's current row is never edited outside a status transition that
appends here — no "undo," only forward transitions with a documented
reason, per spec §22 ("never directly edit historical redemptions").

## KYC

### `kyc_records`
`id`, `user_id`, `status` (mirrors `users.kyc_status`), `provider text
null`, `provider_session_ref null`, `level` enum(`NONE`,`BASIC`,`FULL`),
`reviewed_by uuid FK → admin_users null`, `rejection_reason null`,
`created_at`, `updated_at`.

### `kyc_documents`
`id`, `kyc_record_id`, `type` enum(`ID_FRONT`,`ID_BACK`,`SELFIE`,
`PROOF_OF_ADDRESS`), `storage_key` (S3 key — **never a public URL**,
served only via short-lived signed URL through an admin-permission-checked
endpoint), `uploaded_at`. Row-level: only `COMPLIANCE`/`SUPER_ADMIN` roles
can request a signed URL (enforced in `ADMIN` RBAC, not just the client).

## Risk

### `risk_rules`
`id`, `name`, `signal_type`, `condition jsonb`, `action` enum(`PASS`,
`REVIEW`,`LIMIT`,`BLOCK`), `active boolean`, versioned like compliance
config.

### `risk_events`
`id`, `user_id`, `rule_id FK null`, `signal_type`, `severity`, `outcome`
enum(`PASS`,`REVIEW`,`LIMIT`,`BLOCK`), `details jsonb`, `resolved_by uuid
FK → admin_users null`, `created_at`, `resolved_at null`. Automated
outcomes never delete/freeze a balance directly — a `BLOCK` outcome flips
`users.status` and requires an admin-audited action to reverse (spec §24:
"never automatically confiscate balances without an auditable
administrative process").

## Compliance

### `jurisdictions`
`state char(2) PK`, `status` enum(`ALLOWED`,`GC_ONLY`,`SC_DISABLED`,
`REGISTRATION_DISABLED`,`REDEMPTION_DISABLED`,`BLOCKED`), `min_age int`,
`updated_by uuid FK → admin_users`, `updated_at`. Not hard-coded — seeded
with a conservative default (`REGISTRATION_DISABLED` in Phase 1 seed for
every state except a small demo allowlist) and edited only through the
admin compliance center.

### `compliance_config_versions`
`id`, `config_key` (e.g. `jurisdictions`, `age_minimums`,
`redemption_limits`, `playthrough_defaults`), `value jsonb`, `version int`,
`changed_by uuid FK → admin_users`, `change_reason text`, `created_at`.
Every compliance-relevant setting change appends a version row; current
value is the latest version per `config_key` (spec §42: "maintain version
history whenever compliance rules change").

### `feature_flags`
`key text PK`, `enabled boolean`, `rollout_meta jsonb null`, `updated_by
uuid FK → admin_users`, `updated_at`.

## Responsible play

### `responsible_play_controls`
`user_id PK/FK`, `deposit_limit_daily null`, `deposit_limit_weekly null`,
`deposit_limit_monthly null`, `session_reminder_minutes null`,
`cooling_off_until timestamptz null`, `self_exclusion_until timestamptz
null` (`null` + `permanent boolean` for permanent exclusion),
`self_excluded_at null`, `marketing_opt_out boolean`, `updated_at`. A
`BEFORE UPDATE` application-level guard (service method, not just a DB
constraint) refuses any write that shortens/removes an active
self-exclusion unless the actor is `SUPER_ADMIN` *and* the action is
logged with a mandatory `reason` — enforcing spec §21 ("admin cannot
casually reverse active self-exclusion").

## Social

### `chat_messages`
`id`, `room` (`GLOBAL`, `VIP`, etc.), `user_id`, `body`, `status`
enum(`VISIBLE`,`DELETED_BY_MOD`,`FLAGGED`), `created_at`.

### `chat_moderation_actions`
`id`, `moderator_id FK → admin_users`, `target_user_id`, `action`
enum(`MUTE`,`BAN`,`SLOW_MODE`,`WARN`), `duration_minutes null`, `reason`,
`created_at`.

### `leaderboard_snapshots`
`id`, `promotion_id FK null`, `period` enum(`DAILY`,`WEEKLY`,`MONTHLY`,
`PROMOTIONAL`), `metric`, `rankings jsonb` (array of `{userId, displayName,
value, reward}`), `computed_at`.

## Admin / audit

### `admin_roles`
`id`, `key` enum(`SUPER_ADMIN`,`COMPLIANCE`,`FINANCE`,`SUPPORT`,
`VIP_MANAGER`,`FRAUD_ANALYST`,`CONTENT_MANAGER`,`GAME_MANAGER`,
`MODERATOR`), `permissions jsonb` (fine-grained capability list per role,
editable so permission sets aren't hard-coded per role name).

### `admin_users`
`id`, `user_id FK → users null` (admins are still platform users for
auth/2FA reuse), `role_id FK → admin_roles`, `active boolean`,
`created_at`.

### `audit_logs` (append-only)
`id`, `admin_id FK → admin_users`, `action` text, `target_type`,
`target_id`, `old_state jsonb null`, `new_state jsonb null`, `reason
text null`, `ip`, `created_at`. Every sensitive admin mutation (balance
adjustment, role change, redemption decision, KYC decision, jurisdiction
change, self-exclusion override, flag toggle) writes exactly one row here
in the same DB transaction as the mutation itself.

## Notifications / Support / Analytics

### `notifications`
`id`, `user_id`, `channel` enum(`IN_APP`,`EMAIL`,`SMS`,`PUSH`), `event`,
`payload jsonb`, `status` enum(`QUEUED`,`SENT`,`FAILED`,`SUPPRESSED_OPT_OUT`),
`created_at`, `sent_at null`.

### `notification_preferences`
`user_id PK/FK`, per-channel per-category opt-in/out `jsonb`.

### `support_tickets` / `support_messages`
Standard ticket + threaded messages, `assigned_admin_id null`,
`status` enum(`OPEN`,`PENDING_USER`,`PENDING_SUPPORT`,`RESOLVED`,`CLOSED`).

### `analytics_events`
`id`, `user_id null`, `event_name` (from the spec's tracked-event list),
`properties jsonb`, `created_at`. Internal-only sink — never forwarded to
a third-party analytics vendor with financial/identity fields (spec §39).

## Reconciliation

A scheduled BullMQ job (`ReconciliationJob`, hourly + on-demand):
1. For every wallet, recompute `SUM(ledger_entries.amount)` and compare to
   `wallets.balance`.
2. Compute platform-wide totals: issued, wagered, won, redeemed, expired,
   admin-adjusted, grouped by currency.
3. Any wallet drift, or any of the platform totals failing to balance
   (`issued + won - wagered - redeemed - expired ± admin_adjustments = Σ
   live balances`), writes a `risk_events` row with `severity = CRITICAL`
   and triggers an admin alert (Slack/email webhook — provider-abstracted,
   mocked in Phase 1).
