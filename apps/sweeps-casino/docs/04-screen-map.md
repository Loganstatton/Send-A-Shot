# Screen Map

Legend: **P1** ships in Phase 1 (real UI, real backend). **P2**/**P3** are
stubbed or omitted in Phase 1 per `docs/06-phase1-plan.md`.

## Global chrome

- **Topbar** (persistent, all authenticated screens) — logo, global search,
  GC/SC currency switcher, balance display, wallet button, notifications
  bell, profile menu. **P1**
- **Left sidebar** (desktop, persistent) — Home / Casino / Rewards / Social
  / Account sections per the spec's nav tree. **P1** (Live Casino, Game
  Shows, Chat, Leaderboards, Raffles nav entries present but link to a
  "coming soon" state — **P2** for real content)
- **Right community panel** (collapsible) — live activity feed. **P1**
  (feed UI + WS wiring), **My Plays** tab **P1**, cross-user "All Plays"
  populated from real rounds **P1**, anonymization toggle **P1**
- **Mobile bottom nav** — Home / Casino / Rewards / Wallet / Profile, plus
  a slide-out drawer for the rest of the nav tree. **P1**
- **Notification toasts / center** — **P1** in-app only; email/SMS/push
  dispatch stubs log-only. **P2** real delivery.

## Auth

| Screen | Route | Phase |
|---|---|---|
| Register | `/register` | P1 (email/password, DOB, state-of-record, jurisdiction gate) |
| Login | `/login` | P1 |
| Forgot / reset password | `/forgot-password`, `/reset-password` | P1 |
| Email verification | `/verify-email` | P1 |
| 2FA setup / challenge | `/account/security` (setup), inline login challenge | P2 (schema + TOTP lib wired, UI stub in P1) |
| Passkeys, Google OAuth | — | P3 |

## Casino

| Screen | Route | Phase |
|---|---|---|
| Casino Home (lobby) | `/` | P1 — banner, daily-reward CTA, VIP progress, horizontally-scrollable sections |
| Category pages (Originals/Slots/Live/Table/Game Shows/New/Popular) | `/casino/[category]` | P1 shell + real data for Originals; other categories render empty-state ("catalog seeds via provider integration") since no real aggregator exists yet |
| Search results | `/casino/search?q=` | P1 — name/provider/category/tag, filters |
| Game detail / launch (Original) | `/casino/originals/[slug]` | P1 — Dice, Mines, Plinko playable; others show "Phase 2" card |
| Provably fair verification | `/provably-fair` | P1 |
| Favorites | `/casino/favorites` | P1 |
| Recently played | `/casino/recently-played` | P1 |

## Rewards

| Screen | Route | Phase |
|---|---|---|
| Promotions list | `/rewards/promotions` | P1 — generic promo list rendering `reward_config` by type |
| Daily bonus | `/rewards/daily-bonus` | P1 — 7-day streak UI, claim, cooldown |
| VIP Club dashboard | `/rewards/vip-club` | P1 — rank, progress bar, benefits, reward history |
| Challenges | `/rewards/challenges` | P2 (schema + engine ready via promotions `type=CHALLENGE`, no seeded content) |
| Raffles | `/rewards/raffles` | P2 (same — `type=RAFFLE`) |

## Social

| Screen | Route | Phase |
|---|---|---|
| Global chat | `/social/chat` | P2 (WS gateway + moderation schema built; UI stub in P1) |
| Leaderboards | `/social/leaderboards` | P2 |

## Account

| Screen | Route | Phase |
|---|---|---|
| Wallet (GC/SC/Transactions/Redeem/Rewards tabs) | `/account/wallet` | P1 — GC + Transactions tabs fully real; SC tab visible but reads `sc.enabled` flag and shows a disabled/"coming soon" state when off; Redeem tab always shows disabled state in P1 |
| Transactions | `/account/transactions` | P1 — full ledger history, filterable by currency/type |
| Redemptions | `/account/redemptions` | P1 UI shell reachable only if `redemptions.enabled`; otherwise explains the feature is pending compliance approval |
| Profile | `/account/profile` | P1 |
| Responsible Play | `/account/responsible-play` | P1 — limits, cooling-off, self-exclusion, opt-outs |
| Security | `/account/security` | P1 — password change, sessions/devices list, login history; 2FA setup P2 |
| Support | `/account/support` | P1 — FAQ + ticket create/list; live-chat integration P2 |

## Admin (never linked from player nav; separate RBAC-guarded route tree)

| Screen | Route | Phase |
|---|---|---|
| Admin dashboard (metrics) | `/admin` | P1 — users, GC/SC activity, pending KYC, promotions counts; revenue/payment metrics render zeroed until payments are enabled |
| User search & detail | `/admin/users`, `/admin/users/[id]` | P1 — profile, balances, ledger, sessions, devices, KYC, risk flags, notes |
| Ledger / reconciliation view | `/admin/ledger` | P1 |
| Game management | `/admin/games` | P1 — activate/deactivate, feature, reorder, tag, jurisdiction-restrict |
| Promotions manager | `/admin/promotions` | P1 — CRUD on the generic promotion model |
| VIP configuration | `/admin/vip` | P1 — levels, multipliers, rewards |
| Jurisdiction / compliance center | `/admin/compliance` | P1 — per-state status editor, versioned config, feature-flag toggles |
| KYC review queue | `/admin/kyc` | P1 (against mock provider) |
| Risk / fraud queue | `/admin/risk` | P1 shell — lists `risk_events`, manual PASS/REVIEW/LIMIT/BLOCK actions; rule authoring UI P2 |
| Redemptions review | `/admin/redemptions` | P1 shell, functionally inert until `redemptions.enabled` |
| Payments / chargebacks | `/admin/payments` | P2 (schema ready, mock provider only) |
| AMOE queue | `/admin/amoe` | P2 |
| CMS (banners, announcements, legal pages) | `/admin/cms` | P2 (schema ready; P1 banners/legal pages are static JSON seed) |
| Roles & admin users | `/admin/roles` | P1 |
| Audit log viewer | `/admin/audit-log` | P1 |
| Support ticket queue | `/admin/support` | P2 |

## Cross-cutting UI states (apply to every list/grid screen)

- Skeleton loaders for game tiles/lists while fetching.
- Paginated/infinite-scroll game grids (never render a full catalog at once).
- Empty states that explain *why* (e.g. "Live Casino launches once a
  provider is integrated — see Phase 2") rather than looking broken.
- Currency-aware empty/disabled states: any SC-only surface visibly
  explains it's pending compliance approval rather than silently hiding
  (so the product still demonstrates the full intended UX to
  stakeholders/reviewers).
