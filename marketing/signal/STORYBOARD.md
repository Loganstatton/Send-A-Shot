# NEXT × SCOUT — "THE SIGNAL"

60 s hero commercial · 1080×1920 (primary) + 1920×1080 · 30 fps · 1800 frames · three acts.
**SCOUT discovers and evaluates. NEXT lets you discover, back, and virtually trade.**
A new production. It imports the earlier ads' toolkits read-only (`../commercial/next3d.py`,
`../commercial2/phone2.py`, `card2.py`, `../dual/scout3d.py`, `set4.py`) and changes none of them.

## 1. Audit: what the app really does (checked in the code, 14 Nov 2026)

| Brief claim | Verified in | Status |
|---|---|---|
| 10,000 starting virtual Credits | `lib/next-market.ts` `NEXT_STARTING_CREDITS_CENTS = 1_000_000` | ✅ |
| Trades move the NEXT Price | `applyTradeImpact`: every 10,000 Credits on one side moves the price ~5%; buys up, sells down; $1 floor; fills at the average of the pre- and post-trade price | ✅ shown with the app's own numbers |
| Selling | Trade panel's Sell tab, `quoteSell` | ✅ |
| Starting price from the Scout Score | `nextBasePriceCents(score)` ($1–$50 curve) | ✅ (not stated on screen) |
| Discover: browse, search, filter | `DiscoverGrid`: search box, sorts, genre, score and price ranges, "For you" | ✅ |
| Watchlist, Feed, artist activity | `/next/watchlist`, `/next/feed`, `/next/activity`, Watch button | ✅ live in production (sign-in required) |
| Leaderboards | `/next/leaderboard`: Top Traders, Talent Scouts, Top Discoverers, Challenges, genre boards | ✅ |
| Leagues, challenges | `/next/leagues`, `/next/challenges`; the five challenges use only in-app actions, none uses external growth data | ✅ may appear briefly |
| Founding Believer record | `lib/founding-believer.ts`, `/next/artists/[id]/founding-believer`: permanent, dated, first backer = Backer #1 | ✅ |
| SCOUT is internal | role-gated admin routes | ✅ labelled on screen |
| SCOUT score is human-rated | `lib/scoring.ts`: 8 categories rated 0–10 by a scout; weights 25/15/15/15/10/10/5/5 | ✅ |
| Approval sets live status | Approve / Watch / Pass in the queue; every roster artist that is not Passed is listed on NEXT | ✅ |
| **Automated discovery results** | the YouTube momentum scan exists (`lib/youtube-momentum.ts`, "Run YouTube scan now") but needs a YouTube API key | ⚠️ not run; the film shows the real scan control and the queue's source labels, and only fan-submitted candidates (a real feature). No scan results are invented. |
| **Playing a music preview** | previews are official, click-to-play YouTube embeds (`YouTubePreviewButton`); the old Deezer 30 s audio was retired | ⚠️ an embed would put a third-party music video (usually people) into the ad, and the demo artist has none. The film shows the real Preview control, then a 3D waveform with an original music texture composed for this ad. No fake embedded player is drawn. |
| Public website | `https://send-a-shot.onrender.com/next` returns 200 | ✅ works, but the first request took 24 s (the server was asleep). See §7. |
| "Download" | no native app | not used; CTA is "Explore NEXT" |

Zero humans: the demo artists use the original abstract covers (rings, stripes, orbs); player avatars in the app are initials in circles; the Backer #1 card has no likeness. No photos, video or avatars of people anywhere.

## 2. Shot list

Frames are global (30 fps). Titles sit in the upper band (17–30% of frame height); small print stays above 65% (see §5).

| # | Time | Frames | Picture | Camera | On screen | Narration | Sound |
|---|---|---|---|---|---|---|---|
| **ACT I — THE DISCOVERY** | | | | | | | |
| 1 HOOK A | 0:00–0:03 | 1–90 | Already moving: a huge orange 3D market chart (metal tubes, lit nodes, smoked-glass volume bars). At 0:00.7 it comes apart: lines lift, fold forward and re-form as a mirrored audio waveform; the glass bars swing round into its bars; ~3,200 particles stream with them. The waveform locks at 1.3 s and pulses on the beat; its centre opens, the camera goes through; beyond, the world splits: SCOUT's cyan workstation with the real queue (left), NEXT's orange phone with the real trade panel (right) | fast low push through the chart → hold on the waveform → push through | THIS ISN'T A STOCK. · IT'S AN ARTIST. · SCOUT × NEXT (both wordmarks) | "This isn't a stock." · "It's an artist." | bass impact + distorted metal accent + synthetic pulse; 8th-note sub; reverse swell; clean lock impact, music drops out for line 2; whoosh through; cyan/orange two-tone; drive starts at 2.37 s |
| 2 SCOUT | 0:03–0:10 | 91–300 | The camera turns left into SCOUT's cyan room: an ultrawide monitor (black glass, brushed-aluminium arm), the real New Candidates queue. Juno Marrow's identity tile (geometric cover + waveform) slides into the queue; push in on her candidate record and its status | orbit left → slow push-in → macro on the record | SCOUT · DISCOVER EMERGING TALENT. · small: INTERNAL · NOT PUBLIC | "SCOUT discovers promising musicians before they appear on NEXT." | precise ticks, soft scan tone, a select click |
| 3 EVALUATION | 0:10–0:17 | 301–510 | The rating panel: four categories at a time with their real weights (Music/Talent 25%, Growth Velocity 15%, Engagement 15%, Original-Song Response 15% → Brand 10%, Consistency 10%, Commercial 5%, Professionalism 5%); each value set (a highlight moves across; no hand, no cursor arm); the weighted score resolves to 86.0; the status changes to APPROVED | lateral track along the panel, push-in on the score | 8-FACTOR SCOUT EVALUATION · HUMAN REVIEWED | "Human reviewers evaluate eight factors, then approve which artists go live." | restrained confirmation tones per factor; a distinctive approval sound |
| **ACT II — THE MARKET** | | | | | | | |
| 4 TRANSFER (signature) | 0:17–0:22 | 511–660 | The approved profile lifts off the monitor as a thick glass tile, cyan light running over it; the camera follows it down a dark corridor of interconnected lattice; the light turns cyan → orange; the tile rotates to camera and becomes Juno's NEXT listing; the phone rises out of the floor and the tile lands in its Discover screen | one continuous follow | APPROVED ON SCOUT. · LIVE ON NEXT. | "That's where NEXT begins." (after the landing) | riser through the corridor; landing: warm bass hit with metallic resonance (0:21.0) |
| 5 DISCOVER | 0:22–0:30 | 661–900 | The phone fills the frame: Discover scrolls, the search and filter chips are used, Juno's profile opens: Scout Score 86, NEXT Price; the Preview control is tapped and a 3D waveform rises out of the phone; Watch → Watching | orbit to front, push into the screen | DISCOVER. · LISTEN. · FOLLOW. · small: SCOUT SCORE = SCOUTS' RATING · NEXT PRICE = SET BY PLAYERS' VIRTUAL TRADES | "Discover new music. Listen. Explore each artist's story." | full rhythm enters; an original preview texture (no licensed recording needed) |
| 6 TRADE | 0:30–0:40 | 901–1200 | Trade panel: balance 10,000 Credits; NEXT Price; $250 entered; Review → Buy; "Bought 6.5138 shares at $38.38"; the price line extends out of the phone into a glass 3D chart the camera travels along; as other demo players buy, the price steps up; the Sell tab and a small sell confirmation | push-in on the panel, then a tracking move alongside the chart | 10,000 VIRTUAL CREDITS · BUY. SELL. TRACK. · small (whole scene): VIRTUAL CREDITS · NO CASH VALUE · NOT REAL MONEY OR SECURITIES · DEMO DATA | "Start with ten thousand virtual Credits. Buy and sell artist shares in a simulated market, where trades move prices." | crisp confirmation; layered impact with the chart expansion; small notes on number updates. No casino sounds |
| **ACT III — THE RECOGNITION** | | | | | | | |
| 7 PORTFOLIO + COMMUNITY | 0:40–0:47 | 1201–1410 | Pull back: three glass panels arrange around the phone: PORTFOLIO (holdings, value), LEADERBOARD (Top Traders), COMMUNITY (Feed / watchlist / activity) | pull back, slow arc across the three | BUILD YOUR PORTFOLIO. · FOLLOW THE MUSIC. · PROVE YOUR PICKS. | "Build your portfolio. Follow favorites. Compete on leaderboards." | rhythm kept, arrangement thinned under the voice |
| 8 FOUNDING BELIEVER | 0:47–0:53 | 1411–1590 | Everything darkens; one orange light finds the approved Backer #1 card (v2.1 design, this journey's record): metal edges, black-and-orange finish, foil glints; it turns to near-front | slow arc, shallow focus | FOUNDING BELIEVER · BACKER #1 · YOU WERE EARLY. · small: FIRST RECORDED NEXT BACKER · DEMO DATA | "Back an artist first? Your Founding Believer card records it." | the music pulls back; sub swell; metallic shimmer + warm impact as it turns; a short triumphant phrase |
| 9 FINALE | 0:53–1:00 | 1591–1800 | The card recedes into the dark; the SCOUT workstation (left, cyan) and the NEXT phone (right, orange) light up; their light runs to the centre and meets; a wave of energy between them; symmetrical | pull back to a centred, symmetrical hold | SCOUT × NEXT · DISCOVER. BACK. BELIEVE. · FIND WHAT'S NEXT. · EXPLORE NEXT + URL · small: SCOUT — internal artist discovery and evaluation · NEXT — public virtual music trading and discovery | "SCOUT finds the talent. NEXT lets you back it." · "Find what's next." | both themes together, final chord, the three-note NEXT sonic logo, clean end |

Alternative hooks (same 0:03–1:00 film; each 90-frame hook ends on the hook-A composition so the cut is invisible):
- **Hook B — "THE NEXT BIG ARTIST IS STILL UNKNOWN."** Opens tight on the SCOUT queue as a new candidate arrives, pulls back to the two worlds.
- **Hook C — "ONE SYSTEM FINDS THEM. ANOTHER LETS YOU BACK THEM."** Opens on a dramatic split: SCOUT cyan and NEXT orange facing each other across a dividing line of light, then the same pull-back.

Cuts: 30 s (hook → 2 compressed → 4 → 6 → 8 → 9) and 15 s (hook → 4 → 6 → 9). Every cut keeps SCOUT-internal / NEXT-public and the virtual-Credits label.

## 3. Transitions (one world, no stitched scenes)
- 1 → 2: the far side of the waveform *is* the SCOUT/NEXT room; the camera turns toward the cyan side.
- 2 → 3: push from the candidate record into the rating panel on the same monitor.
- 3 → 4: the panel that leaves the monitor is the one the viewer just saw approved.
- 4 → 5: the glass tile becomes the listing on the phone; the phone is already there when it lands.
- 5 → 6: push from the profile into the trade panel; the chart grows out of the same screen.
- 6 → 7: the camera pulls back out of the chart; the panels assemble around the phone.
- 7 → 8: the panels dim and fall away; one light remains and becomes the card's key.
- 8 → 9: pull back from the card; its light splits into cyan and orange.

## 4. Sound
Original score (`music5.py`), D minor, 112.5 BPM: one beat = 16 frames, so beats land on frames (8, 24, 40, 56…). Five layers, each a stem: narration (`vo5.py`, chain in `mix5.py`), music, interface sounds, cinematic transitions, sonic logo (the last three in the sfx stem). The music ducks and its speech band is carved under every line. Mastered to about −14 LUFS integrated, −1 dBTP.

## 5. Mobile safe zones
Published guidance differs by platform and most figures are secondary sources. This film uses the strictest combination: nothing important in the top 288 px or the bottom 672 px of 1920, or the right-hand 192 px below mid-frame. Titles: 17–30% of height. Small print: above 65%.

## 6. Pipeline and render budget
Blender 5.0.1 Cycles (AgX, OptiX on RunPod RTX 4090s) → linear HDR frames → `post5.py` (bloom, tone map, grain, typography at final resolution) → FFmpeg. Typography and timing are composited in Python (OpenCV/Pillow) at final resolution rather than Remotion: same result, no extra tooling. `post5.py` and the assemble script are the editable compositing project.
Estimate: about 3,960 frames (vertical + 16:9 + hooks B and C) at about 2–3 s each on an RTX 4090 ≈ 3 GPU-hours with pod start-up ≈ **$2.5–4** of the existing RunPod balance (about $7.43), including one round of re-renders. Nothing else is paid.

## 7. Open items needing the owner's decision
1. **Approval to use the RunPod balance** (estimate above). Nothing has been rendered on paid hardware yet.
2. **Narration voice.** Kokoro-82M (Apache-2.0, licensed for commercial use) is used now. A professional voice actor or a paid voice service with a commercial licence would sound better for a paid campaign; that is a cost decision.
3. **The website.** The first request to `send-a-shot.onrender.com` took 24 s (the server was asleep). Before paying for traffic, the server should stay warm, and a short custom domain would read better on the end card. The URL is a typography layer, so it can be swapped at the end.
