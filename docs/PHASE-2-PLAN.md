# Phase 2: real-time market updates — research and plan

Status: **planning only. Nothing is built.** Implementation starts only after you approve it.

NEXT stays virtual-credit trading: no deposits, withdrawals or redeemable contracts.

## 1. What players would see

**Live without reloading:**
- the price;
- the buy/sell quotes;
- each new trade, on a trade tape;
- 24 h change and volume;
- the player's own balance, holdings and portfolio value.

**Charts:** candlesticks at 1 minute, 5 minutes, 1 hour and 1 day, with volume bars, built only from
completed trades.

**Status:** a small badge reading **Live**, **Reconnecting…** or **Paused for a market check**. A screen is
never silently stale.

**Rule:** only committed trades are ever shown. No optimistic or invented updates, no simulated activity.
Every number traces back to a ledger entry.

## 2. Recommended architecture

**Server-Sent Events (SSE) from the app, fed by Postgres LISTEN/NOTIFY.** No new service.

1. **One event per committed change.** Every trade, depth change and halt/resume writes a row to a new
   `next_market_events` table, inside the same transaction:
   - a sequence number;
   - the artist;
   - the kind of change;
   - the price, shares and Credits.

   The transaction then calls `pg_notify`. Postgres delivers NOTIFY only when the transaction commits, so a
   rolled-back or refused trade can never reach a screen.
2. **Fan-out.** Each app instance keeps one listening database connection and passes events to the browsers
   connected to it.
3. **Stream.**
   - `GET /api/next/stream?artists=…` streams public events: price, quote inputs, trades and volume.
   - A signed-in player also gets their own balance and holdings, and nobody else's.
   - A heartbeat every 15 s keeps the connection alive.
4. **No gaps, no duplicates.**
   - Every event carries its sequence number.
   - On reconnect the browser sends `Last-Event-ID`, and the server replays what it missed from
     `next_market_events`.
   - The browser ignores anything older than what it already has.
   - After a long disconnect it reloads a fresh snapshot instead of replaying.
5. **Quotes.**
   - Bid/ask come from the same formulas as the trade panel (`lib/next-market.ts`), using the price and
     depth in each event.
   - The quote the player sees is therefore exactly what the server's quote guard checks.

**Why SSE and not WebSockets:**
- Updates flow one way.
- SSE runs through a normal Next.js route handler and reconnects automatically.
- It needs no extra server.
- Orders keep going through the existing, tested trade endpoint.

**Fallback.** If streaming is unavailable, the page polls a small JSON endpoint every 5–10 s and shows
"Updating every few seconds".

## 3. Charts and candles

**Candle definition:**
- Open and close are the market price at the first and last trade in the period.
- High and low are the highest and lowest price reached.
- Volume is the Credits traded by players.
- The source is `next_price_history` and `next_transactions`.
- A period with no trades shows **no candle**. It is never filled in.

**Storage:**
- For the beta, candles are computed on request with `date_trunc` queries. The data is small.
- Add a pre-computed table only when history grows.

**Charting library:** TradingView **Lightweight Charts**.
- Free, open source (Apache-2.0).
- Its licence requires a visible TradingView attribution, which its built-in logo option provides.
- I'll confirm the current version and terms before adding it.

The quote band is drawn separately and labelled "quote", never as a trade.

## 4. Hosting: one decision needed

Production runs on Render's **free** instance. It sleeps after 15 minutes without visitors and takes about a
minute to wake, so it can't hold live connections reliably. Live streaming needs the always-on **Starter**
instance at about **$7/month**; that upgrade is already recommended in `HOSTING-PLAN.md`.

| Option | Cost | What players get |
|---|---|---|
| **A. Starter + SSE** (recommended) | +$7/month | True live updates, typically within a second of a trade |
| **B. Stay free, poll** | $0 | Updates every 5–10 s while the page is open; the first visitor after idle waits for the wake-up |

At beta scale (about 100 players) one Starter instance is ample. Render ends long-lived connections after a
while, so the browser simply reconnects and resumes from the last event. A managed realtime service (Ably,
Pusher) is not needed until thousands of people are watching at once.

## 5. Accuracy and safety rules

- Events are written in the same transaction as the trade, and nothing is sent unless it commits.
- Every event has a sequence number, and clients discard anything out of order.
- **Private data:**
  - balances and holdings go only to their owner's authenticated stream;
  - the public trade tape shows "a player" with an amount and price, never names.
- **Halts:** a halt or resume event updates the trading panel at once. A paused artist can't be traded,
  as today.
- **Reconciliation** is unchanged and also checks that `next_market_events` matches the trades.

## 6. Testing plan

- **Unit tests:** event ordering, replay from `Last-Event-ID`, dropping duplicates, candle building
  (including empty periods).
- **Database tests:**
  - NOTIFY fires only on commit;
  - refused or rolled-back trades emit nothing;
  - concurrent trades produce ordered, gap-free sequences.
- **Browser tests:**
  - with two players, a trade in one window updates the other's price, tape and quotes;
  - a disconnect and reconnect produces no gaps or duplicates;
  - a halt shows "Paused";
  - after 1,000 random trades, the stream's final state equals a fresh page load.
- **Load test:** 1,000 simultaneous streams against a production build, measuring memory, CPU and event
  delay.
- **Failure tests:**
  - the database listener drops and recovers;
  - the server restarts mid-stream;
  - the polling fallback works.
- **Staging first,** with the same reconciliation and authenticated-trade checks as Phase 1.

## 7. Work and timeline

| Step | Work | Estimate |
|---|---|---|
| 2a | Market events table, NOTIFY, SSE stream, live price/quotes/trade tape, status badge | ~1 week |
| 2b | Live balance, holdings and portfolio value for the signed-in player | 3–4 days |
| 2c | Candlestick and volume charts | ~1 week |
| 2d | Load and failure testing, polling fallback, staging checks, rollout | 3–4 days |

**Cost:** $0 in services under option B, or +$7/month under option A. No other purchases.

## 8. Decisions for you

1. **Hosting:** option A (Starter, +$7/month) or option B (polling on the free instance for now).
2. **Charts:** Lightweight Charts, with its required attribution.
3. **Candle intervals:** 1m / 5m / 1h / 1d, or a different set.
4. **Trade tape:** anonymous ("a player bought 250 Credits at 10.12", recommended), or show player names.
