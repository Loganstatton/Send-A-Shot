# NEXT market maker: final design for approval

Status: **approved with conditions and implemented on staging — see `PHASE-1-REPORT.md` for what was built, how it differs (fee on buys only, admin-approved depth, uniform 10-Credit listing, no device fingerprinting) and the test results.** The original proposal follows. This is phase 1 of `LIVE-MARKET-PROPOSAL.md`, now that phase 0 is live.
Every number below comes from `research/market-sim/mm-design-check.mjs`. That script imports the deployed
pricing code and models the design next to it; run it with:

    node --experimental-strip-types --no-warnings research/market-sim/mm-design-check.mjs

NEXT stays a virtual-credit game: no deposits, no withdrawals, nothing redeemable.

## 0. What phase 0 changed about this plan

The deployed engine is already a path-independent market maker. Written in terms of shares, its rule is:

> **1 / price = 1 / anchor − k × Q**, where Q is the total number of shares players hold, and k ≈ 5% per 10,000 Credits.

This is the same curve as the "about 5% per 10,000 Credits" rule, written another way. With no fee, the
proposed engine fills every trade exactly like the live one; the largest share difference across the test
sizes is 0.

So phase 1 is **not a new pricing engine**. It makes the existing curve explicit and adds what a
professional market needs around it:
- a funded reserve per artist;
- a ledger;
- a fee;
- a depth schedule;
- bid and ask quotes.

The proposal's earlier exponential-in-shares curve is dropped. Keeping today's curve means nobody's
holdings change shape at switch-over.

## 1. The engine

For each artist, the state is three numbers:

| Number | Stored as | Meaning |
|---|---|---|
| anchor `a` | `NUMERIC` | Price when no player holds shares, and the lowest the price can go |
| depth `k` | `NUMERIC` | Fixed by the depth schedule (§3) |
| `Q` | `NUMERIC(38,18)` | Shares held by all players |

The price is calculated from these three, never stored separately: `P = a / (1 − k·a·Q)`.

- **Cost of any move.** Going from Q₁ to Q₂ costs `F(Q₂) − F(Q₁)`, where `F(Q) = −ln(1 − k·a·Q) / k`.
- **Buying.** A disclosed fee is taken first (0.5% recommended, buys only; see decision 1). The rest moves
  along the curve, and shares are rounded down.
- **Selling.** Selling moves back down the curve with no fee. Proceeds are rounded down to the cent.
- **No floor.** The $1.00 floor goes away, because the price can't fall below the anchor: that's where
  nobody holds anything. Today's floor has a flat region that could pay out more than the curve holds once
  legacy holdings exceed it. Migration (§5) removes that region.
- **Concurrency.** Each trade locks the artist row (as today) and carries a quote id with a maximum
  slippage. It never fills at a price the player didn't see.

## 2. Reserves always cover every sale (verification 1)

- **Where Credits go.** Every Credit paid into an artist's curve goes into that artist's **reserve**.
- **The invariant.** At all times, reserve ≥ F(Q), which is exactly what all holders together would get by
  selling everything.
  - Because the cost depends only on where the curve starts and ends, any order of selling, in any number
    of pieces, pays out the same total.
  - Rounding only ever leaves extra in the reserve.
- **Checked:**
  - 200 random exit orders after migration: the reserve was never negative, and 2.49¢ was left over from
    rounding.
  - 300 markets × 400 random trades by 20 accounts, with depth increases mid-run: reserve ≥ owed after
    every one of 120,000 trades. The tightest margin was 0.000000¢.
  - Shares the curve tracks always matched shares players hold (largest gap 4×10⁻¹²).
- **In production:**
  - an append-only Credit ledger with these accounts: players, each artist's reserve, the fee pool, and
    "Credits issued";
  - a nightly reconciliation that the ledger sums to zero and every reserve ≥ F(Q);
  - a circuit breaker: if any check fails, that artist's trading pauses automatically and an admin is
    alerted.

## 3. Changing depth (verification 2)

As more people play, a fixed depth makes prices swing too much (see the proposal's 10,000-player
simulation).

**Proposed rule:**
- Depth (the Credits needed to move the price ×e) = **max($200,000, $1,000 × players who traded in the last
  30 days)**. $200,000 is today's depth, so nothing changes during the beta.
- Depth **only ever increases**, by at most **×1.25 a week**, announced a week ahead and applied at a fixed
  time.

**What a change does:**
- The current price stays put, because the curve is re-anchored around it.
- Everyone's shares stay the same.
- Because the market gets deeper, selling costs less slippage, so every holder's value can only go up:

| Position (bought at $22.03) | Depth ×1.25 | Depth ×2 | Reserve top-up needed (×1.25 / ×2) |
|---|---|---|---|
| $100 | +0.01% | +0.02% | $0.00 / $0.01 |
| $10,000 | +0.50% | +1.25% | $49.50 / $124.99 |
| $50,000 | +2.38% | +6.23% | $1,187.93 / $3,116.89 |

**Is it fair?**
- Nobody loses.
- Bigger positions gain more, because they had more slippage to lose.
- That's why steps are capped at ×1.25. For positions up to $10,000, the gain from one step (≤0.50%) is no
  more than the 0.5% buy fee, so buying ahead of an announced step isn't worth it.
- **Decreasing depth would cut values, so it is not allowed.**

**Funding.** The extra reserve a step needs comes from the fee pool first. Anything beyond that is a
disclosed "liquidity added" ledger entry.

## 4. Multiple accounts (verification 3)

**What a group can't do: create Credits together.**
- In 2,000 random games of 8 colluding accounts, all trading and then exiting, the best group result was
  −$167.63.
- The curve is the only way Credits move between accounts.

**What a group can do: move Credits from throwaway accounts to one main account** (pump and dump). Each
account comes with 10,000 free Credits, so this is the real risk:

| Players in the game | 5 throwaways ($10,000 each) | 20 throwaways |
|---|---|---|
| 100 | they lose $2,971.68; main gains $2,673.09 | lose $16,894.30; main gains $15,849.21 |
| 1,000 | lose $753.74; main gains $455.15 | lose $3,172.98; main gains $2,127.92 |
| 10,000 | lose $298.42; main gains −$0.16 | lose $1,195.20; main gains $150.13 |

Deeper markets shrink the effect a lot. While the game is small, defences matter more than the pricing.

**Defences:**
1. **Gate trading.** Trading needs a verified email and an invite code, both of which exist today.
2. **Beneficiary detector.** For each profitable exit, list the accounts that bought the same artist while
   that position was open and then lost or abandoned theirs. Flag the case when the same accounts recur
   three or more times, or are under 7 days old, or came from the same invite.
3. **Leaderboard eligibility.** Accounts need to be at least 7 days old. Flagged accounts are held out
   until reviewed.
4. **Review, never silent changes.** Flags go to the admin Market integrity page. Balances are never
   changed automatically.
5. **Optional, needs your decision:** a hashed signup network/device signal to spot one person running
   many accounts. This needs a privacy-policy update.

## 5. Migrating portfolios without losing value (verification 4)

Migration runs once, in one transaction per artist, with trading paused and a verified backup taken first:

1. Q = the sum of everyone's holdings, and P = the current price.
2. Set the anchor so the curve passes through today's state: `a = P / (1 + k·P·Q)`.
3. Fund the reserve with exactly F(Q), the amount all holders could get. This is a disclosed
   "opening reserve" ledger entry. In the realistic test state it was $21,273.85.
4. Leave the rest alone: holdings, cost basis, realized P&L and history aren't touched.

**Checked:**
- The price was unchanged.
- **Every holder's portfolio value was identical to the cent before and after.**
- All exit orders were covered.

**Rollout:**
1. Rehearse on a copy of the production backup in the staging schema, with a per-user value checksum
   before and after.
2. Run in shadow mode: the new engine computes quotes alongside the live one for a week.
3. Switch: pause trading, migrate, verify the checksums, resume.

## 6. No new rounding or splitting exploits (verification 5)

- **By construction.** The total cost depends only on where the curve starts and ends. Every fraction
  rounds toward the market: the fee rounds up, and shares and proceeds round down.
- **Checked:**
  - 3,000 random slice and round-trip strategies, with random depths: none ended ahead (best −$0.01).
  - 10,000 one-cent buys: no extra shares.
- **Kept as regression:** the phase 0 unit tests and the `trade-exploit` browser suite, which fails on the
  pre-fix engine.
- **Added in phase 1:** the property "any accounts, any sequence: total Credits out ≤ total Credits in",
  run on every commit.
- **Minimum trade of $1.** This isn't needed for correctness; it keeps the history free of dust.

## 7. Liquidity without invented volume (verification 6)

- **Always a counterparty.** Every trade fills immediately against the curve. The screen names the
  counterparty: "the NEXT market maker".
- **The market maker is passive.** It never starts a trade.
  - There are no bots and no synthetic orders.
  - Volume, trades and candles come only from real player trades in the ledger.
- **Quiet artists look quiet.** An artist nobody trades shows a flat line and "No trades today".

## 8. What the screen shows (verification 7)

| Shown | Exact meaning |
|---|---|
| **Price** | The curve's price right now. |
| **Bid / Ask** | The average fill for selling or buying $100 now, and for the amount being typed. A sell quote is capped at what the curve holds. |
| **Last trade** | The average fill price of the most recent trade, which is different from the price after it. |
| **Candles** | Open/close is the price at the start and end of the period; high/low is the highest and lowest price reached. Built from trades only. |
| **Volume** | Credits traded by players. |
| **Portfolio value** | What selling each holding alone would pay right now, which is exactly today's rule. The detail view also shows shares × price. |

Every page carries the label **"Virtual Credits — no cash value."**

Checked: across 4,913 fills, bid ≤ price ≤ ask at every moment. Every fill matched the quote shown,
falling short only by rounding in the market's favour, and never by more than 1¢.

## 9. Decisions for you

1. **Fee.**
   - **0.5% on buys only** (recommended): existing values are unchanged at switch-over, a round trip
     costs 0.5%, and it funds depth top-ups.
   - No fee.
   - 0.25% each way: this lowers everyone's displayed value by 0.25% on switch day.
2. **Depth schedule.**
   - **$1,000 per active player, minimum $200,000, at most ×1.25 a week, announced a week ahead**
     (recommended).
   - Or a fixed depth.
3. **Multi-account signal.** Hashed network/device signal at signup with a privacy-policy update, or not.
4. **Listing price.**
   - Keep listing new artists from the Scout Score (as today, disclosed).
   - Or use one listing price for every artist.

**What phase 1 then builds:**
- the ledger and reserves;
- the explicit curve state and migration;
- the fee;
- the depth schedule;
- bid/ask quotes with a quote id;
- the reconciliation job and circuit breaker;
- the beneficiary detector;
- tests.

It costs **$0** in services. Live updates (SSE), candles and limit orders follow as phases 2–5 of the
proposal.
