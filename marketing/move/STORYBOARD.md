# NEXT: "THE MOVE": storyboard and production notes

A 25-second vertical film (1080×1920, 30 fps, 750 frames) about the thrill of a well-timed virtual
artist trade. The payoff is **+$1,432 in virtual Credits**: an illustrative result, never real money.

## The trade (real engine, demo data)

The figure is not drawn by hand. `capture_move.js` runs this trade through NEXT's own trade API on a
local demo database. `scenario.js` mirrors the engine's arithmetic only to choose the amounts, and the
capture script stops if any stored number differs from it by a cent.

| Step | What happens in the app | The app's numbers |
|---|---|---|
| Listing | Kito Vale (invented, abstract cover); the scouts' rating gives a NEXT Score of 62.5 | listed at $22.03 (`nextBasePriceCents`) |
| The pick | Demo Player (10,000 Credits) buys $4,500, the first trade on the artist | fills at $22.28 (average of $22.03 and the post-impact $22.53); 201.9749 shares |
| The market | 13 buys and 2 sells by 14 other demo players, over ten demo days | each trade moves the price by the engine's rule (5% per $10,000); price reaches $29.82 |
| The sale | Sell all, through the real Sell panel | fills at $29.37 (its own price impact included); proceeds $5,932.00 |
| Result | Portfolio: "Total return +14.3% $1,432.00"; Realized P&L $1,432.00 | balance $11,432.00 Credits |

Before the sale, the trade panel's "Unrealized P&L" reads +$1,432.00. That is the app's realistic exit
value, which already includes the sale's own price impact.

The film's counter and chart are drawn from the same recorded numbers:
- **The chart** is the artist's recorded price, trade by trade.
- **The counter** is that position's exit value at each point, minus the $4,500 cost.

### Why a $4,500 pick and a 62.5 score

Prices are whole cents, so a realized gain moves in steps of about $2.80 as the exit price moves. An
exact +$1,432.00 needs a matching listing price. The solver searched NEXT Scores from 40 to 80 (in the
app's 0.5 steps) and picks from $2,000 to $6,000. A 62.5 score with a $4,500 first pick is the most
natural combination that lands exactly on it.

## What the film never says or implies

- **No cash:** the gain is never presented as cash, earnings, winnings or income. It is always "virtual
  Credits" with "no cash value".
- **No withdrawal:** nothing suggests Credits can be withdrawn, redeemed or exchanged.
- **No wealth promise:** there is no promise of wealth or of results. "Illustrative example · demo data"
  stays on screen whenever the figure is.
- **No invented history:** the demo trade is not shown as a real user's trade or as real market history.

## Shots

| # | Time | Frames | Picture | Sound | Text |
|---|---|---|---|---|---|
| 1 | 0–3 s | 1–90 | **Hook A.** A huge chrome-and-light counter, already climbing, locks on +$1,432 (frame 46). Behind it, Kito Vale's real price line rises corner to corner as a giant orange glass chart. Volume bars grow, one per real trade, mirrored in black lacquer, between chrome monoliths. | Sub drop, crack and braam on frame 1. One counter tick per digit change. Reverse swell into a clean impact plus a D minor add9 stab at the lock. VO: "One artist." (0.12 s) / "One early pick." (1.62 s) | VIRTUAL PORTFOLIO GAIN · ILLUSTRATIVE EXAMPLE · VIRTUAL CREDITS · NO CASH VALUE · DEMO DATA |
| 2 | 3–8 s | 91–240 | A photoreal phone enters through the market. Huge holographic NEXT Discover cards (real captures) float in the hall. The real Discover grid, then a tap on Kito Vale's card and her real artist page (score 63, $22.03). | The drive starts on frame 91: kick, offbeat hats, D minor 16th bass, plucked arp. Glass UI ticks. VO: "Discover the talent before the crowd." | DISCOVER EARLY |
| 3 | 8–15 s | 241–450 | The real Buy panel: $4,500, Review, Confirm, "Bought 201.9749 shares … at $22.28." Then the camera dives out of the phone into the chart, now an enormous 3D landscape. Ten demo days pass, each trade a pulse of light along the line ($22.53 → $29.82). Back to the phone: Sell all, Confirm, "Sold 201.9749 shares … at $29.37." | The build: snare, opening filter, risers. A confirm chime on each Confirm; a day-tick sweep as time passes. VO: "Back your picks." / "Watch the market move." | SIMULATED MARKET · DEMO PLAYERS' TRADES |
| 4 | 15–20 s | 451–600 | The portfolio as a giant polished glass display: the real portfolio page, Total return +14.3%, $1,432.00. Light sweeps across the glass on the reveal (frame 481). | A quarter-second of silence, then one substantial hit: boom, sub drop, braam, and a wide stab. | +$1,432 IN VIRTUAL CREDITS · NOT REAL MONEY · NO CASH VALUE |
| 5 | 20–25 s | 601–750 | The visualizations collapse into the NEXT wordmark (chrome, ember dot). | Reverse swell, impact, then NEXT's three-note sonic logo (from THE SIGNAL). VO: "How good are your picks?" / "NEXT is coming soon." | HOW GOOD ARE YOUR PICKS? · COMING SOON. · Virtual trading game. Credits have no cash value. |

**Hook B (phone first):** the phone fills the frame on the real portfolio, and a light sweep crosses
"Total return +14.3% $1,432.00".

**Hook C (the chart erupts):** the camera races up the glowing price line from floor level to its
peak, landing on the counter.

Both alternative hooks use the same narration and disclosure.

## Zero humans

- **Covers:** the artists are invented, with abstract covers (rings, stripes, orbs).
- **Players:** the demo players appear only as initials.
- **Imagery:** no photos, faces, hands, silhouettes or video anywhere.

## Sound

- **Score:** the score and every effect are synthesized from scratch (`music_move.py`; primitives from
  `../signal/synth5.py`).
- **Narration:** Kokoro-82M, voice af_heart (Apache-2.0, commercial use allowed). Alternative voices
  were rendered for comparison.
- **Mix:** the music ducks, and its speech band is carved out under every line. Mastered to −14 LUFS,
  −1.5 dBTP.

## Files

- **Data and trade:** `scenario.js` (the solver), `capture_move.js` (the real-app run and capture),
  `journey.json` (that run's record).
- **Scenes:** `move_hook.py` (hook A); the scenes for shots 2–5 and hooks B and C follow.
- **Post and audio:** `post_move.py` (grade and type), `music_move.py`, `vo_move.py`.
