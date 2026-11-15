# Phase 1: the NEXT market maker — implementation report

Status: **implemented on the development branch and staging, not on production.** Production gets it only
after you approve this report and its test results.

NEXT stays a virtual-credit game: no deposits, no withdrawals, nothing redeemable.

Your decisions are implemented as follows:

| Decision | What was built |
|---|---|
| **0.5% fee on purchases only** | The fee is taken before the trade moves the price and rounded up to the cent; sales pay nothing. It is shown on the trade panel and again on the confirmation screen before anything is spent, and recorded on each trade. |
| **Gradual depth, ×1.25/week as a maximum, admin approval** | Depth never changes automatically. An admin previews a change, sees its exact effect, and approves it. The rules are: increases only; at most ×1.25 within any 7 days; every change records who approved it. |
| **Verified accounts, limits, behavioural detection; no fingerprinting** | New-account and daily limits, a "require verified email" switch, and a pump-and-dump detector. No device fingerprinting: the separate assessment is in `docs/DEVICE-FINGERPRINTING-ASSESSMENT.md`. |
| **Uniform listing price (10 Credits), Score kept separate** | New artists list at 10 Credits a share. Every existing artist keeps its price. The Scout-vs-market comparison is not shown for uniformly listed artists. |

## 1. What changed

### The market maker
The code is in `lib/next-market.ts`.

**The price rule.** Each artist has a published price rule:

> 1 / price = 1 / anchor − Q / depth

- **Q** is the number of shares all players hold.
- **anchor** is the price when nobody holds any shares.

This is the same curve the Phase 0 engine already runs. With no fee, the two fill every trade
identically.

**What Phase 1 adds:**
- **Per-artist depth.** The default is 200,000 Credits, which is about 5% per 10,000 Credits.
- **Fee.** The 0.5% purchase fee.
- **Exact curve state per artist**, stored as anchor, depth, shares outstanding and reserve.
- **No $1.00 floor.** The price can no longer fall below the anchor, because no one can sell shares that
  weren't bought.

### The Credit ledger and reserves
The code is in `lib/market-ledger.ts`, with migration `016`.

- **Double-entry ledger.** Every Credit movement is a balanced entry in `next_ledger`. That covers signup,
  every buy and sale, every fee, depth top-ups, deleted accounts and deleted artists.
- **Accounts:**
  - each player;
  - each artist's reserve;
  - the fee pool;
  - issuance;
  - opening reserve;
  - liquidity;
  - retired.

### Inside every trade (`executeTrade`)
Each trade happens in one transaction, which:
1. locks the trader and then the artist;
2. checks that the books balance before trading;
3. fills along the curve;
4. moves the trader's Credits, shares, shares outstanding, reserve and fee pool together;
5. writes the ledger entry;
6. checks the books again.

If either check fails, nothing is written and that artist's trading pauses for review. A sale can never be
quietly short-paid. A test found that problem in an earlier draft, and it is fixed.

### Reconciliation
The code is `reconcileMarket`. It checks that:
- every ledger entry balances;
- every balance and reserve equals its ledger account;
- shares held plus retired equals the curve's shares outstanding;
- every reserve covers its holders;
- every price lies on its curve;
- there are no negative balances or holdings;
- players + reserves + fees + retired = issued + opening reserves + liquidity.

It runs:
- daily, as a new step in the scheduled workflow;
- on demand, via the admin button or the `market-audit` workflow.

Any artist that fails a check is paused automatically.

### Admin and limits
- **Admin page.** A new **Market maker** page shows the books, the migration proof, paused artists,
  per-artist reserve and margin, depth preview/approve, and pause/resume.
  - The API routes are `/api/admin/market`, `/reconcile`, `/depth` and `/halt`.
  - Depth changes and resumes require a signed-in admin and are written to the audit log.
- **Limits.**
  - Smallest purchase: 1 Credit.
  - Maximum 500 trades a day, on top of the existing 20 a minute.
  - Accounts younger than 3 days without a verified email can buy at most 2,500 Credits of any one artist
    in 24 hours.
  - `NEXT_REQUIRE_VERIFIED_EMAIL=1` makes buying require a verified email. It is off for now, because
    production can't send email yet.
  - Selling is never limited.
- **Quote guard.** The trade panel sends the price the player saw. If the market has moved more than 2%
  against them, the order is refused.
- **Detection.** The Market integrity page has a new "pump and dump" detector (§4).

## 2. Proof that the market maker can always honour valid sales

Write `F(Q) = depth · ln(price / anchor)`, which equals `−depth · ln(1 − anchor·Q/depth)`. That is exactly
what all holders together would receive if they sold every share, in any order and any number of pieces,
because the curve's cost depends only on where it starts and ends.

**Invariant:** at all times, **reserve ≥ F(Q)**.

| Event | Why the invariant still holds |
|---|---|
| Listing | Q = 0, reserve = 0, F = 0. |
| Migration | The reserve is set to F(Q) rounded **up** to the cent. |
| Buy of net n Credits | Shares are the exact curve amount for n·(1 − 10⁻¹²), rounded **down**. So F(Q′) − F(Q) < n, and the new reserve, reserve + n, is greater than F(Q′). |
| Sale of s ≤ own holding ≤ Q | Proceeds are F(Q) − F(Q−s) rounded **down**. So the new reserve ≥ F(Q−s) = F(Q′) ≥ 0. The proceeds can never exceed the reserve. |
| Depth increase | The price and Q stay fixed. The top-up is ⌈F′(Q) − reserve⌉, so the new reserve ≥ F′(Q). |
| Account deleted | Its shares become "retired": counted in Q but never sellable. The reserve is unchanged, so the remaining holders are over-covered. |
| Artist deleted | Its holdings go with it, and the reserve moves to "retired". |

**Consequence:** any set of valid sales, by any accounts, in any order, pays out at most F(Q) ≤ reserve.
The market maker can always pay every sale.

Floating-point arithmetic is guarded in three ways:
- the 10⁻¹² margin on purchases;
- downward rounding of proceeds;
- an explicit check of the books before and after every trade.

**Tests of this property:**
- 600 random trades by 15 accounts, then everyone exits in random order and in pieces: every sale was paid,
  the price returned exactly to the anchor, and players + reserve + fees equalled the Credits they started
  with, exactly.
- Simultaneous trading by 12 accounts.
- 120,000 random trades in `mm-design-check.mjs`.
- Tampering tests: a short reserve makes the sale refused and the artist paused.

## 3. Depth changes: funding, effect on positions, conservation

**Effect on positions.** A holding of h shares is worth `depth · ln(1 + price·h/depth)`. That value
increases as depth increases, so **no holder can lose value** from a depth increase; they only face less
slippage. The price and everyone's shares are unchanged.

From `mm-design-check.mjs`, for positions bought at 22.03:

| Position | ×1.25 | ×2 (not allowed in one week) |
|---|---|---|
| 100 Credits | +0.01% | +0.02% |
| 10,000 Credits | +0.50% | +1.25% |
| 50,000 Credits | +2.38% | +6.23% |

**How the extra reserve is funded.** Holders are now owed `F′(Q) − F(Q)` more. That amount is added to the
reserve, rounded up:
1. it comes **from the fee pool first**;
2. any remainder is a disclosed **"liquidity"** ledger entry (virtual Credits added to the reserve).

The preview shows the exact split before approval. Examples:
- In the browser test, a 100-Credit position under depth ×1.2 needed a 1-cent top-up, paid from the fee pool.
- With 100,000 Credits held in one artist, ×1.25 needs about 4,500 Credits, mostly liquidity, because fees
  were only 500 Credits.

That size of top-up is why steps are capped and require approval.

**Conservation.** Every top-up is one balanced ledger entry. Reconciliation proves after every change that
players + reserves + fees + retired = issued + opening reserves + liquidity. It also checks that every
reserve still covers its holders.

The tests cover:
- the price, shares and every holder's value;
- the exact top-up and its split;
- the ledger;
- full exit afterwards;
- the "increases only / ×1.25 per 7 days" rules;
- a depth change racing with trades.

## 4. Coordinated multi-account manipulation

**What the tests prove:**
- **No group can create Credits.** In 40 random games of 5 colluding accounts, every group ended with at most
  what it started with. The proof in §2 covers any number of accounts.
- **A group can move Credits to one account (pump and dump), always at a loss.** In the test, 5 throwaway
  accounts of 10,000 Credits each fed a main account. The main account gained less than the throwaways
  lost. Throwaways that sold first can even come out ahead; the ones left holding paid for it.
- **The detector flags it.** It flags a profitable exit where, in the 24 hours before, two or more "thin"
  accounts supplied most of the other buying and were left at a loss. A thin account is under 7 days old, or
  has ≥80% of its buying in that artist, or was invited by the account that profited.
  - It flagged exactly the losing throwaways.
  - It did not flag organic trading by established, diversified players.
  - It needs two or more feeders.
  - It marks repeated beneficiaries.
- **Flags are for review.** Nothing is blocked or changed automatically.

The new-account limit (2,500 Credits per artist per day for 3 days) also caps how fast fresh accounts can
pump.

## 5. Migration: balances, holdings and history preserved

Migration 016 adds columns and tables only. It runs `MARKET_ACCOUNTING_INIT_SQL`, which:
- keeps every existing artist on its Score-based listing;
- sets each curve through today's price and today's holdings;
- funds each reserve with exactly what its holders could get (rounded up);
- opens the ledger with every balance as it is;
- stores a snapshot for proof.

**Verified by:**
- **The real migration path.** A database at migration 015 with Phase-0-shaped data (odd balances, drifted
  prices, exact-decimal shares, an unpriced artist) went through 016. Every balance, holding, cost basis,
  price, transaction and price-history row was identical to the last digit. Every reserve covered its
  holders by less than a cent of rounding, and the ledger opened with the exact balances.
- **The data step on legacy rows.** No holding's value changed: Phase 0 value = new value, to the cent.
  Reconciliation passes. Each holder could then sell for **exactly the value they were shown**. New players
  and new uniform listings work afterwards.
- **On production after deploy.** `verifyMarketMigration` re-proves it from the snapshot. It is shown on the
  admin page and printed by the workflow.
- **Restore.** Restoring a backup taken before Phase 1 re-runs the set-up automatically. Every balance and
  holding was intact and the books reconciled.

## 6. Test results

| Suite | Result |
|---|---|
| Unit and integration (vitest, real Postgres) | **570 / 570 pass** (47 files). New: `market-maker.test.ts` (22 tests) and `market-migration.test.ts` (3). Existing tests changed only where Phase 1 changes behaviour on purpose: fee, 10-Credit listing, no $1 floor, Score comparison only for Score-listed artists. |
| New browser suite `market-maker` | **28 / 28.** Fee shown before confirming (real browser); disclosures; admin overview; reconciliation over HTTP; depth preview, approval and refusals; audit log; pause/resume; new-account limit; quote guard. |
| Browser suite `trade-exploit` (Phase 0 replay) | Passes with fees: every strategy ends below where it started, prices return exactly. |
| All other browser suites | **All pass:** main 55/55, guest 24/24, leagues 23/23, onboarding 20/20, challenges 18/18, discovery 14/14, artist-requests 12/12, analytics 6/6, security 14/14, social 9/9, keyboard 3/3, trade-exploit 15/15, and the dead-link sweep of every page as guest, player, artist, admin and phone (no dead ends). The sweep found one issue, fixed: the trade panel's amount presets now show which one is selected. |
| Staging (deployed) | Healthy. Pages render. Trade, admin and reconciliation endpoints refuse signed-out requests. The automated staging reconciliation needs a `STAGING_CRON_SECRET` repository secret (staging uses its own CRON_SECRET); until then, run it from the admin Market maker page on staging. |
| Typecheck, production build | Clean. |

## 7. What users will notice

1. **A 0.5% fee on purchases**, shown before confirming. For example, 100 Credits = 0.50 fee + 99.50 into
   the market. Sales have no fee. A buy-then-sell round trip now costs about 0.5% instead of about 0.
2. **Buy and sell quotes** for 100 Credits on the trade panel, and an average price per share that includes
   the fee.
3. **New artists start at 10 Credits a share.** Existing artists and their prices don't change.
4. **No "Scouts rate higher / Market ahead" badge on newly listed artists.** There is nothing to compare,
   because their price wasn't set from the Score. Artists listed before keep it.
5. **New rules:**
   - prices can't drop below where they started, so there is no $1 floor;
   - the smallest purchase is 1 Credit;
   - 500 trades a day;
   - new, unverified accounts: 2,500 Credits per artist per day for 3 days;
   - an order is refused if the price moved more than 2% since the quote.
6. **Clearer disclosure:** "you trade with the NEXT market maker", its reserve, and "no cash value".
7. **Rarely:** "Trading in this artist is paused while the market is checked."

**Nothing changes at switch-over** for any player's Credits, shares, portfolio value, history or
leaderboard position.

## 8. Rollback plan

**Before production:**
- a verified backup (the daily workflow, run on demand), plus Render's 3-day point-in-time recovery;
- trading paused (`NEXT_TRADING_PAUSED=1`) for the switch.

**Steps:**
1. **Something looks wrong right after deploy, before trading resumes.** Keep trading paused and redeploy
   the previous commit (revert the merge on `main`). Migration 016 only *added* columns and tables, so the
   Phase 0 code runs unchanged. Nothing anyone owns is touched.
2. **Problems found after trading resumed.**
   - Pause trading.
   - Look at the admin Market maker page. Reconciliation names the failing check and artist, and halts
     affected artists on its own.
   - Fix forward if it is narrow, or revert as in step 1.
   - Trades made under Phase 1 stay valid either way: they are ordinary balance and holding changes.
3. **Data damaged** (not expected; no code path rewrites balances). Restore the pre-deploy backup from the
   admin Backups page. It takes a safety snapshot first, and a pre-Phase-1 backup re-runs the accounting
   set-up automatically. Trades after the backup would be lost, so this is the last resort. Render
   point-in-time recovery is the alternative.
4. **Going forward again after a code rollback that let trading continue on Phase 0.** The Phase 0 code
   doesn't write the ledger, so the books must be re-opened. A one-line migration
   `017_market_reopen_books` would run `DELETE FROM next_ledger;` followed by `MARKET_ACCOUNTING_INIT_SQL`.
   That re-opens every balance and re-funds every reserve from the state at that moment, exactly as 016 did.
   Fees collected before the rollback are then not in the fee pool; this is disclosed, and nothing anyone
   owns changes.

## 9. Proposed production deployment (needs your approval)

1. Run the backup workflow and verify the encrypted artifact.
2. Set `NEXT_TRADING_PAUSED=1` on production and confirm the trade endpoint returns 503.
3. Merge the branch to `main`. Render deploys, and migration 016 runs on the first request.
4. Run the `market-audit` workflow on production. Reconciliation must pass and `migration.ok` must be true,
   with the same number of balances, holdings, trades and price points as before.
5. Spot-check the artist pages, portfolio values and the admin Market maker page.
6. Unpause trading and run one more reconciliation.
