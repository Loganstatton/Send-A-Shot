# NEXT: "THE MOVE": export and quality report

## Deliverables (all measured from the exported files)

| File | What it is | Measured |
|---|---|---|
| `THE-MOVE-25s-vertical.mp4` | The full commercial: hook A (counter), narration | 1080×1920, 30 fps, 750 frames, 25.0 s, −14.1 LUFS, −1.5 dBTP |
| `THE-MOVE-25s-hookB-vertical.mp4` | The same film with hook B (phone first) | 750 frames, −14.0 LUFS, −1.5 dBTP |
| `THE-MOVE-25s-hookC-vertical.mp4` | The same film with hook C (the chart erupts) | 750 frames, −14.1 LUFS, −1.5 dBTP |
| `THE-MOVE-12s-vertical.mp4` | The short version, every cut on the beat | 360 frames, 12.0 s, −13.8 LUFS, −1.5 dBTP |
| `THE-MOVE-25s-no-voiceover-vertical.mp4` | Music, effects and on-screen text only | 750 frames, −14.0 LUFS, −1.5 dBTP |
| `THE-MOVE-25s.srt`, `THE-MOVE-12s.srt` | Captions | Timed from each line's actual placement |
| `THE-MOVE-soundtrack-master.wav`, `stems/` | Mastered mix (48 kHz, 24-bit); voice, music and effects stems | Two-pass loudness normalisation to −14 LUFS |
| `editable/THE-MOVE-*.blend` | Blender 5.0 scenes (hook A, B, C; shot 2; shot 3; shots 4–5), images packed | The animated counter, chart reveal and price ticker are driven by the scene scripts (`move_*.py`); the .blend files hold the built scenes |
| Scripts in this folder | `scenario.js`, `capture_move.js`, the `move_*.py` scenes, `post_move.py`, `music_move.py`, `vo_move.py`, `assemble_move.py` | Everything re-runs from these |

Every frame is a native 1080×1920 Cycles render (OptiX on RunPod GPUs: an RTX 4090 and L40S, 128 samples, motion blur, AgX). Nothing is upscaled. All type is composited at full resolution.

## The brief's checks

| Check | Result |
|---|---|
| Opens immediately on a huge gain counter rising to +$1,432 | Frame 1 is already counting (+$33). It locks on +$1,432 at frame 46 (1.5 s) on a bass impact. A giant orange chart rises behind it. |
| Identified as an illustrative virtual-credit gain | On screen from frame 1: VIRTUAL PORTFOLIO GAIN, ILLUSTRATIVE EXAMPLE · VIRTUAL CREDITS, NO CASH VALUE · DEMO DATA. |
| Real smartphone, actual NEXT interfaces | Every phone screen is a capture of the real app, running locally on demo data: Discover, artist page, Buy panel, confirm, "Bought…", position, Sell all, "Sold…", Portfolio. |
| Virtual purchase, market moving, completed virtual sale | The real Buy flow ($4,500). The chart becomes a 3D landscape with a live price ticker ($22.53 → $29.82), labelled SIMULATED MARKET · DEMO PLAYERS' TRADES and EVERY TRADE MOVES THE PRICE · 5% PER 10,000 CREDITS. Then the real Sell all and "Sold 201.9749 shares of Kito Vale at $29.37." |
| Portfolio as a giant polished glass display, +$1,432 reveal on one musical hit | The real portfolio page (Total return +14.3%, $1,432.00) on a chrome-rimmed glass slab. A light sweep and the chrome +$1,432 land on the hit at frame 481 (16.0 s): one boom, sub, braam and stab after a quarter-second of silence. |
| Credits clearly virtual, not real money | Under the figure: IN VIRTUAL CREDITS · NO CASH VALUE and ILLUSTRATIVE EXAMPLE · DEMO DATA · NOT REAL MONEY (frames 484–624). The app's own "Paper trading — NEXT Credits have no real monetary value" is on the glass. |
| Collapses into the NEXT logo; end text; verified address; disclosure | Everything is pulled into one point, then the chrome NEXT wordmark and ember dot form. HOW GOOD ARE YOUR PICKS? / TRY NEXT FREE. / send-a-shot.onrender.com/next / "Virtual trading game. Credits have no cash value." |
| Website verified | `https://send-a-shot.onrender.com/next` returns 200 (checked 14 Nov 2026). The first request after idle took 44 s (server asleep): keep it warm before paying for traffic. |
| Profit consistent with the real engine | The trade was executed through NEXT's own trade API on a local demo database. Each step was checked against the engine's rules to the cent (see STORYBOARD.md). The counter is the app's own realistic exit value along the recorded prices. |
| No invented real user or real market history | The account is named "Demo Player". Every trader is a demo player. The artist is invented. "Demo data" stays on screen with every figure. |
| No cash, withdrawal or wealth implications | The only money words are "virtual Credits", "no cash value" and "not real money". There are no promises of results. |
| Zero humans | No people, faces, hands, silhouettes or photos. The artist covers are abstract. The players appear as initials only (in the app's own UI). |
| Narration clear | Speech band (300–3400 Hz), voice over music and effects: +10.6 dB ("One artist.", under the opening impact) to +17.1 dB. |

## Notes

- **The confirm screen's estimate.** On the Sell confirm screen the app shows an execution price of $29.38; the actual fill was $29.37. The app's preview rounds its estimate slightly differently from the engine's fill. The film shows the app exactly as captured, and both the "Sold … at $29.37" confirmation and the portfolio's $1,432.00 are the engine's real results.
- **Why the pick is $4,500, not $5,000.** Prices are whole cents. Exactly +$1,432.00 needs a matching listing price, and a 62.5 score with a $4,500 first pick is the most natural combination that lands on it.
- **Narration.** Kokoro-82M, voice "af_heart" (Apache-2.0, commercial use allowed), the same as THE SIGNAL. Two alternative voices (am_michael, bm_george) were synthesized for comparison. A paid voice service or a voice actor would sound more natural: swap the lines in `vo_move.py` and re-run `assemble_move.py`, with no re-render needed.
- **Cost.** RunPod GPU time for this film was about $1.11 (balance $5.39 → $4.28). That covers three parallel pods for the full render plus two short re-renders: the reveal frames, and clean cuts between app screens.
