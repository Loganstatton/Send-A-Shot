# Market research simulations (not part of the app)

These scripts import the app's real pricing functions (`lib/next-market.ts`) read-only. They change
nothing in the app or its database, and aren't built or tested with it.

    node --experimental-strip-types --no-warnings research/market-sim/exploit-check.mjs
    node --experimental-strip-types --no-warnings research/market-sim/mm-design-check.mjs
    node --experimental-strip-types --no-warnings research/market-sim/sim.mjs [--users 10,100,1000,10000] [--days 60] [--depth-per-player 1000]

- **`exploit-check.mjs`** asks whether one player, alone, can end up with more Credits by slicing buys and
  sells. It checks both the current engine and the proposed market maker.
- **`mm-design-check.mjs`** checks the final market-maker design (`docs/MARKET-MAKER-DESIGN.md`):
  reserves under every exit order, depth changes, multiple accounts, migration values, splitting, and
  quotes against fills.
- **`sim.mjs`** runs 40 artists for 60 days, hour by hour, with 10 days of zero trading, comparing the
  current engine with the proposed market maker. It reports price coherence, how often prices change,
  displayed versus realizable portfolio value, credit conservation and solvency.

See `docs/LIVE-MARKET-PROPOSAL.md` for what the results mean.
