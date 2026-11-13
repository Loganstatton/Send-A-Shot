# SCOUT × NEXT — "BEFORE THE BREAKOUT"

40 s · 1080×1920 (main) + 1920×1080 · 30 fps · 1200 frames.
**SCOUT discovers the talent. NEXT lets the world back it.**
One continuous journey of one demo artist, Juno Marrow, through both products. The earlier ads and the reveal trailer are untouched; this folder only imports their shared toolkit (`../commercial/next3d.py`, `../commercial2/phone2.py`, `card2.py`).

## 1. Asset audit

| Asset | Source | Status |
|---|---|---|
| SCOUT screens | `capture_dual.js`: the real app, run locally on a fresh scratch schema with invented artists and players. 1600×900 at 2× = 3200×1800 (native 16:9 monitor texture) | New candidates queue, Juno's candidate card, roster with lifecycle stages, approved artist (50.0 before rating), score breakdown (86.0 after), the 8-category rating panel with weights |
| NEXT screens | same run, as the demo player Maya Chen; 390×844 at 4× | Discover with Juno as "Featured · Scouts' pick", Score 86, profile, trade $250, confirm, "Bought 6.5138 shares at $38.38", price chart, portfolio, leaderboard, Founding Believer page |
| Backer #1 card | Ad #1 v2.1 design (`../commercial/make_card.py`), re-issued from this journey's record | Genesis Founder · Backer #1 · Maya Chen · locked Nov 13, 2026 · backed at $38.38 · first of 12 backers |
| NEXT phone | `../commercial2/phone2.py` (hero phone from Ad #2) | reused |
| SCOUT wordmark | the app's own: a small glowing cyan square + "SCOUT" in Inter Bold (`components/Header.tsx`) | rebuilt in 3D from those exact parts; Inter + JetBrains Mono extracted from the app's build (OFL) |
| NEXT wordmark | Bricolage Grotesque ExtraBold + ember dot | reused |
| 3D, render | Blender 5.0.1 Cycles; RunPod GPU at true 1080×1920 | working (trailer: ~1 s/frame on an RTX 4090) |
| Compositing | Python (OpenCV/NumPy/Pillow) + FFmpeg | working |
| Music + SFX | original, synthesized from scratch (no samples, no licences needed) | to build: `music4.py` |

What the captures prove about the products (used for the script):
- A candidate enters SCOUT's queue from a NEXT user's "Submit an Artist" (fan submission) or from the YouTube momentum scan. The scan exists but needs API access, so it isn't run here; the film shows fan submissions, which do run.
- A person clicks **Approve**, **Watch** or **Pass**. Approval adds the artist to SCOUT's roster with every rating at 5 (50.0) — nothing is scored automatically.
- A scout then rates eight categories 0–10 (Music/Talent 25%, Growth Velocity 15%, Engagement 15%, Original-Song Response 15%, Brand 10%, Consistency 10%, Commercial 5%, Professionalism 5%). The weighted result (86.0 for Juno) is what NEXT shows as the **NEXT Score (86)**.
- Every roster artist that is not "Passed" is listed on NEXT. The NEXT Price comes from players trading virtual Credits.
- SCOUT is internal (role-gated). NEXT users never see SCOUT screens.

Not shown, on purpose: SCOUT's money pages (Screener totals, deals/revenue/investment ledger), sync credentials, emails, notes; the Discovery dashboard (it shows the YouTube scan as "never run" in this offline capture). Music previews: NEXT plays real Spotify/YouTube embeds, which need a real artist — the demo artist has none, so no preview player is shown playing.

## 2. Shot list

| # | Time | Frames | Picture | Camera | Titles | Sound |
|---|---|---|---|---|---|---|
| 1 HOOK | 0–4 s | 1–120 | A single thin cyan waveform in the dark, already moving at frame 1; it reacts to the score; it splits into a lattice of lines that becomes the floor and walls of a dark workspace | tracking shot along the line, then rises to reveal the lattice | EVERY BREAKOUT HAS A BEGINNING. (0.4–1.9) · THIS IS WHERE IT STARTS. (2.0–3.8) | sub pulses, opening accent at 0.0 |
| 2 MEET SCOUT | 4–12 s | 121–360 | Dark brushed-metal workstation; a large monitor rotates into frame and wakes: roster with stages → New Candidates queue (fan submissions) → Juno's card, cursor on **Approve** → approved profile at 50.0 → the rating panel, sliders set by hand → breakdown 86.0 | slow orbit onto the monitor, push-ins on each readable panel, cyan key + cool rims | MEET SCOUT. · small: INTERNAL TALENT DISCOVERY · HUMAN EVALUATION | precise ticks, clicks on the approve and each slider |
| 3 THE CONNECTION | 12–17 s | 361–510 | Juno's evaluated SCOUT profile lifts off the monitor as a thick glass panel; cyan data trails; it flies through the dark; the light shifts cyan → orange; the panel flips edge-on and its back is Juno's NEXT card; it shrinks into the "Featured · Scouts' pick" slot of a NEXT phone's Discover screen | follow cam, one continuous move, ending on the phone | DISCOVERED. · EVALUATED. · APPROVED. · small: APPROVED BY A SCOUT · NOW LISTED ON NEXT | rising tones, impact at 17.0 |
| 4 NOW IT'S YOUR TURN | 17–28 s | 511–840 | The NEXT phone turns to camera: Discover → Juno's profile (Score 86, price) → $250 of virtual Credits → Confirm → "Bought" → orange price lines grow out of the phone into 3D → portfolio → leaderboard | orbit, push into the screen, pull back through the chart | NOW, IT'S YOUR TURN. · BACK. · TRADE. · COMPETE. · small: VIRTUAL CREDITS · NO CASH VALUE · NOT REAL SECURITIES · DEMO DATA | full beat, UI taps, purchase chime |
| 5 FOUNDING BELIEVER | 28–34 s | 841–1020 | Charts fade; one light finds the Backer #1 card (v2.1 design, this journey's record); rim light runs its edge; slow rotation | slow arc, shallow depth of field | FOUNDING BELIEVER · BACKER #1 · YOU WERE EARLY. · small: FIRST RECORDED NEXT BACKER · DEMO DATA | restraint, then the reveal hit |
| 6 ONE VISION | 34–40 s | 1021–1200 | Huge dark studio: SCOUT workstation left (cyan), NEXT phone right (orange); both turn to the viewer; their light meets in the middle; SCOUT × NEXT | slow pull-back, hold | SCOUT × NEXT · ONE VISION. · FIND WHAT'S NEXT. · small: SCOUT POWERS INTERNAL DISCOVERY · NEXT IS THE PUBLIC EXPERIENCE | finale, final impact |

## 3. Transitions (one world, no stitched scenes)

- 1 → 2: the waveform's lattice *is* the workspace floor; the camera never cuts.
- 2 → 3: the panel that leaves the monitor is the profile the viewer just watched being rated.
- 3 → 4: the glass panel becomes Juno's card on the phone; the phone is already in the shot when it lands.
- 4 → 5: the chart lines fade into one remaining light, which becomes the card's rim light.
- 5 → 6: pull back from the card; the studio reveals the two products; the card's light splits into cyan and orange.

## 4. Accuracy rules

- Real SCOUT and NEXT UI only, captured from the app with demo artists and players; labelled DEMO DATA where numbers are legible.
- Approval and scoring are shown as human actions. No "AI scoring", no live streaming numbers, no predictions.
- SCOUT is labelled internal; NEXT users never touch it.
- NEXT is a game with virtual Credits: no cash value, not real securities, no ownership of artists, music or earnings.
- Backer #1 = the first recorded NEXT backer of that artist. No claim that the artist became successful.

## 5. Delivered

See `QC_REPORT.md` for measurements and checks.
`SCOUT-NEXT-before-the-breakout-vertical.mp4` (1080×1920, 40 s) · `SCOUT-NEXT-before-the-breakout-16x9.mp4` · `SCOUT-NEXT-15s.mp4` / `-16x9` ·
`SCOUT-NEXT-soundtrack.wav` · `SCOUT-NEXT-thumb-*.png` · `editable/SCOUT-NEXT-*.blend`.

Rebuild: `node capture_dual.js` → `prep_dual.py` → render `scout.py` (1–300), `transition.py` (1–240), `next4.py` (1–300),
`finale4.py` (1–360), each also `@wide`, with `gpu_render4.py` → `assemble4.sh`.
Video, audio, images and .blend files stay out of git.
