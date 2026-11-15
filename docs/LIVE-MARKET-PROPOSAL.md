# NEXT live market: audit and proposed architecture

Status: **proposal for review. No application code has been changed.** The research code is in
`research/market-sim/`. It imports the app's real pricing functions read-only and runs outside the app.

NEXT stays a virtual-credit game: no deposits, withdrawals, cash value or redeemable contracts.

---

## 1. Assessment of the current engine

How it works today: `lib/next-market.ts` holds the pricing, and `executeTrade` / `executeTradeRequest` in
`lib/db.ts` carry it out.

| Area | What it does | Assessment |
|---|---|---|
| Price | One number per artist (`artists.next_current_price_cents`). It is set at listing from the Scout Score (`nextBasePriceCents`), then changed **only by trades**. | Simple and honest. But at low activity it is stagnant: in simulation, prices don't move in **99% of artist-hours with 10 players and 94% with 100**. |
| Impact | Each trade moves the price by 5% per 10,000 Credits (multiplying), and the fill is the average of the before and after prices. | Fine for one trade. But prices are stored in **whole cents and rounded at every step**, and that breaks the "no free money" guarantee (next row). |
| **Rounding arbitrage (found in this audit)** | A small trade's move rounds to zero, or rounds *up* by a cent, so slices trade at a better price than one block. | **A single player, with nobody else trading, can make money.** From a $22.03 listing: buy $10,000 at once, sell in $40 slices → **+$243.58 in about 13 minutes** at the current rate limit. From $50.00: buy in $20 slices, sell all at once → **+$208.65**. (`research/market-sim/exploit-check.mjs`, using the app's real functions.) The existing tests only check a single round trip, which does lose. **This affects the live game now**, and the leaderboard is where it would be exploited. |
| Quotes | There is one "price". The trade panel previews the fill for the typed amount, and portfolios are marked at the realistic exit value (`quoteSell`). | Exit-value marking is good. There is no bid/ask, no spread and no quote for standard sizes. The Sell preview can differ from the fill by a cent ($29.38 shown vs $29.37 filled in the "THE MOVE" capture). |
| Liquidity | The "house" absorbs every trade. There is no counterparty and no reserve, so credits are created or destroyed implicitly by the impact formula. | Trading always works, but nothing proves the system is solvent or conserves credits. |
| Concurrency | Per-user and per-artist row locks (`FOR UPDATE`), idempotency keys, 20 trades a minute, and a guard so a debit can't go negative. | Solid. Keep it. |
| Data model | `next_transactions` (shares as `DOUBLE PRECISION`, timestamps as `TEXT`); `next_price_history` (a price per trade, no volume); a mutable balance on `users`. | No credit ledger to reconcile against, floating-point shares, and no candles or volume. Price history is one point per trade, so charts are lines between trades. |
| Integrity | Rapid-trade and coordinated-pair heuristics (`lib/market-integrity.ts`), computed by scanning **every** trade on each read; human review. | A good start, but it won't scale, and it misses the main manipulation route: **multiple free accounts** (each gets 10,000 Credits) pumping one account's position. |
| Real time | None. Pages are rendered on request, and the production instance is **free and sleeps** after 15 minutes. | A live market needs an always-on server. |

## 2. The recommended architecture

**A transparent automated market maker (a "bonding curve") for each artist, with optional player limit
orders on top. Live quotes are pushed over Server-Sent Events, and an append-only market-event ledger
backs charts and audits.**

### The market maker (virtual liquidity)

Each artist's price is a published function of how many shares players hold in total:

> **price = listing price × e^(shares held by players ÷ depth)**

- **Buying** moves along the curve. The cost is the exact area under the curve, plus a disclosed fee
  (0.5% is used in the simulation).
- **Selling** moves back down the curve, pays out the same area, and takes the same fee.
- **The reserve** holds every Credit paid in. At all times it equals exactly what holders would get by
  selling everything, so the market is provably solvent.
- **Rounding** always goes against the trader: costs round up, proceeds round down. Prices are kept at
  full precision internally, and only the displayed values are rounded.

Why this fixes today's problems:
- **No self-made profit.** Cost depends only on where you start and end on the curve, not how you slice the
  trade. In the simulation, every buy/sell strategy loses exactly the disclosed fees (about $99.51 on a
  $10,000 round trip); slicing only loses a little more.
- **Always tradable.** No other player is needed. The counterparty is shown openly as "the NEXT market maker".
- **Live quotes are just the curve.** For example, "Ask $22.31 / Bid $22.08 for $100" comes straight from the
  formula, so quotes move only when shares held change.
- **Floor at the listing price.** The price can't fall below listing, because that's where nobody holds
  any shares. Today's floor is $1.00.

**Depth has to grow with the market.** With a fixed depth, the 10,000-player simulation's prices exploded:
up to $3,914 on today's engine and $473 on a fixed-depth curve. With depth set at **$1,000 per registered
player per artist (minimum $200,000)**, prices stayed between $14 and $62. The median daily move was about
0.1%, and 1 in 20 days moved about 1%. Depth changes would follow a published schedule (for example weekly),
re-anchored so **the current price doesn't jump**. Only the size of future moves changes.

### Market maker vs. an order book

| | Order book (players match players) | Market maker (proposed) |
|---|---|---|
| Works with 10–100 players | No. Books are empty most of the time, spreads are huge and orders sit unfilled. | Yes. Every trade fills immediately at the published price. |
| Fairness | Price-time priority is fair, but thin books are easy to move. | Every player gets the same formula. The size of a trade's price impact is known before you confirm. |
| Self-made profit | Possible through self-matching between your own orders, which needs blocking. | Impossible by construction (path-independent, with a fee). |
| Honesty about activity | Real. | Real, with the counterparty disclosed. No invented orders or volume. |
| Complexity | High: matching, cancels, partial fills, queues. | Moderate. |

**Recommendation:** use the market maker now. Add **player limit orders** later ("buy if the ask falls to
$X", "sell if the bid reaches $Y"). They fill against the curve only when another player's trade moves the
price there, which gives an order-book feel without invented counterparties. A true player-to-player book
only makes sense once there are thousands of daily traders per artist.

### Real artist momentum (kept apart from the Score and the price)

- The SCOUT Score stays a human rating and **never moves the price**.
- **One link today:** the *listing* price comes from the Score (`nextBasePriceCents`). Keep that, disclosed,
  or switch to a single listing price for every artist; that decision is yours.
- Verified momentum (subscribers, listeners, views) is shown as a **separate, labelled signal** with its
  source and date.
- **Whether a signal may move the price** is a later, optional step. It needs all three of the following:
  1. **A licence that allows derived use.** YouTube's policies forbid new or derived metrics from
     non-authorized data, and forbid storing those statistics for more than 30 days (narrow exceptions are
     only for audited developers). Spotify's API isn't open to an app our size. Last.fm is
     non-commercial only. That leaves a paid provider (Chartmetric, Soundcharts, Viberate or Songstats)
     whose written terms allow it, or artist-authorized data.
  2. **A published formula**, for example "a daily anchor adjustment equal to 25% of the 7-day follower
     growth, capped at ±2% a day".
  3. **A published time** (for example 00:00 UTC, using the previous day's data), so nobody can trade
     ahead of an update they can see coming.

  Until then, **prices move only because players trade**, and the momentum panel informs their decisions.

## 3. What would cause prices to move

| Cause | When | Shown as |
|---|---|---|
| Player buys and sells | Immediately, in the same database transaction | Trades, candles, volume, a new quote |
| Player limit orders triggering | When another trade crosses their price | Trades (marked "limit") |
| Scheduled momentum adjustment *(optional, later, licensed)* | Once a day at a published time, capped | A separate "momentum adjustment" event on the chart, never a trade |
| Listing / delisting | When scouts list or pass an artist | A listing event |

**Never:** random movement, time decay, invented trades or volume, or changes to the Scout Score.

## 4. How often prices can update

- **Quotes:** on every trade. They're computed in the trade's own transaction (milliseconds) and pushed to
  every open screen within about 0.1–0.5 s.
- **External signals:** daily at best (YouTube quota and provider refresh cycles), weekly for some
  providers.
- **How often prices actually change depends on activity.** In the simulation, a given artist's price
  changed in about 0.6% of hours with 10 players, 6% with 100, 35% with 1,000 and 78% with 10,000. When
  nobody trades, prices stay put, and the honest interface says so ("last trade 3 h ago"; the quote is
  live and tradable).

## 5. Real-time delivery

**Server-Sent Events (SSE), fanned out with Postgres LISTEN/NOTIFY.**
- **Why SSE:** updates flow one way (server to browser). SSE works through a Next.js route handler, plain
  HTTP and reconnects automatically (resuming with `Last-Event-ID`). WebSockets would need a separate
  server, since Next.js route handlers can't upgrade connections, and we don't need browser-to-server
  messages.
- **Render limits:** connections are reported to be capped at about 100 minutes, so clients reconnect.
- **Always on:** this needs the always-on Starter instance (+$7 a month, already recommended in
  HOSTING-PLAN.md).
- **At 10,000 players:**
  - many thousands of open streams need a larger instance or a separate realtime service;
  - a managed service (Ably, Pusher) is the alternative.
- **What's pushed:**
  - each artist's quote and last trade;
  - each signed-in player's balance and holdings;
  - market-wide movers.

## 6. Professional charts

- **Candles:** time-based OHLC candles (1m, 5m, 1h, 1d) built **only from completed trades**, with volume
  bars. When nothing trades, the candle is drawn flat and labelled "no trades" rather than invented.
- **Live quote:** the bid/ask shown as a separate thin band or line, labelled "quote", never drawn as a
  trade.
- **Momentum:** in its own panel, labelled with its source and date.
- **Indicators:** 24 h change, volume, number of distinct traders, VWAP, spread, and a 20-period moving
  average. No "buy/sell signals".
- **Library:** TradingView Lightweight Charts (Apache-2.0, with an attribution link required; its built-in
  logo option satisfies that), or the app's existing chart component extended.

## 7. Market integrity

- **Duplicates:** keep the idempotency keys. Add a "quote ID + maximum slippage" to each order, so a trade
  never fills at a price the player didn't see.
- **Execution rules:** full-precision curve state, rounding against the trader, and a minimum trade size
  (for example $1). This removes the rounding arbitrage.
- **Ledger:** an append-only double-entry credit ledger plus a market-event log. A nightly check that
  credits, the market maker's reserve and fees add up to the Credits ever issued. `CHECK` constraints for
  no negative balances or holdings.
- **Multiple accounts:** invite codes and verified email before trading; account-age rules for
  leaderboards; a detector for "sacrificial" accounts pumping another account's position. Detection
  queries become incremental instead of full scans.
- **Invented volume:** impossible by design. Every volume figure comes from a real ledger entry, and the
  market maker is labelled as the counterparty.
- **Portfolio values:** marked at each holding's realistic exit value, as today. Explain that values can't
  all be realized at once: in the simulation, if everyone sold together they'd get about 9% less than the
  sum of what each was shown. That's true of real markets too.

## 8. Infrastructure

- **Database:** Postgres 16 on Render (Basic-256mb, 1 GB disk, 3-day point-in-time recovery). Fine for the
  beta.
- **Growth at 10,000 active players:** about 6,000 trades a day (in the simulation). With ledger and event
  rows that's roughly 1–2 GB a year, so plan for **more disk (5–10 GB) and Basic-1gb RAM**.
- **Schema changes:**
  - `timestamptz` instead of text;
  - fixed-point shares instead of `DOUBLE PRECISION`;
  - a candles roll-up table;
  - partitioning trades by month at scale.
- **Backups:** the existing daily snapshots plus the planned off-site encrypted copies.

## 9. Testing (done for this proposal, and planned)

- **Done:**
  - `exploit-check.mjs`, single-player profit strategies against both engines;
  - `sim.mjs`, 10 / 100 / 1,000 / 10,000 players and 40 artists over 60 days, with **10 days of zero
    trading**. Both engines stayed coherent through the quiet period: no price moved and nothing broke. The
    proposed engine conserved credits exactly; the reserve equalled what holders were owed, to the cent.
- **Planned:**
  - property-based tests of the engine (no strategy beats −fees);
  - database-level concurrency tests at 10,000 accounts;
  - an SSE load test;
  - a shadow period where the new engine computes quotes alongside the old one before switching.

## 10. Changes required, complexity, cost

| Phase | Work | Complexity | Monthly cost |
|---|---|---|---|
| **0 (urgent)** | Fix the rounding arbitrage in today's engine: full-precision price, rounding against the trader, minimum size, regression test | Small (1–2 days) | $0 |
| 1 | Market-maker engine, credit ledger, market-event log, migration (each artist re-anchored at today's price; reserve funded in a disclosed one-off), quotes on the trade panel | Large (2–3 weeks) | $0 |
| 2 | SSE live updates (quotes, trades, portfolio), always-on instance | Medium (1–2 weeks) | +$7 (Starter) |
| 3 | Candles, volume, bid/ask band, indicators, chart library | Medium (1–2 weeks) | $0 |
| 4 | Integrity: account-farming detector, incremental checks, reconciliation job | Medium (1 week) | $0 |
| 5 | Player limit orders | Medium (1–2 weeks) | $0 |
| 6 (optional) | Licensed momentum panel; then, after counsel, a capped scheduled price input | Medium + vendor + legal | Free sources $0; Soundcharts from ~$50 (quote); Chartmetric ~$350; Viberate ~€300 |

- **Hosting:** about $13–35 a month through phase 5 (Starter instance, database, plus more storage and RAM
  as players grow), versus $6.30 today.
- **Data:** licensed momentum data would add $50–400 a month.
- **Not counted:** anything for the scale of 10,000 concurrent viewers (a bigger instance or managed
  realtime, roughly tens of dollars a month).
- **Before buying anything:** get written quotes and licence terms.

## 11. Biggest risks to fairness and accuracy

1. **The live rounding arbitrage.** It exists today. Fix it first (phase 0).
2. **Account farming.** Free Credits per account let groups pump one account. This matters more than any
   pricing formula.
3. **Mis-set depth.** Too shallow and prices swing wildly with many players; too deep and the market feels
   frozen. It needs a published schedule and monitoring.
4. **Migration fairness.** Moving existing holders onto the curve must not change anyone's value on
   switch-over day.
5. **External data.** Licensing (YouTube's derived-metric rules), front-running, and stale or wrong source
   numbers. Keep the signal separate until licensed and capped.
6. **Confusing quotes, trades and signals in the interface.** Each needs its own visual language and
   labels.
7. **Real-time load.** Open connections at scale; stale screens if streams drop (show "reconnecting").
8. **Legal framing.** The game must keep reading as virtual-credit entertainment. No cash, no redemption
   (see LEGAL-REVIEW.md).

Sources: the provider terms in `docs/GROWTH-DATA-SOURCES.md` (researched 2026-11-12); the YouTube API
[derived metrics policy](https://developers.google.com/youtube/terms/derived-metrics-policy) and
[developer policies guide](https://developers.google.com/youtube/terms/developer-policies-guide); Render
on [SSE vs WebSockets](https://render.com/articles/sse-vs-websockets-llm-streaming) and
[long-lived connections](https://render.com/articles/real-time-ai-chat-websockets-infrastructure);
[TradingView Lightweight Charts](https://www.npmjs.com/package/lightweight-charts) (licence and attribution).
