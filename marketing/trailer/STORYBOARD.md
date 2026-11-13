# NEXT — The Future of Music Discovery (official reveal trailer)

40 s · 1080×1920 (main) + 1920×1080 (16:9) · 30 fps · 1200 frames.
A product reveal, not an ad: slow camera, few words, no sign-up or download message.
Both commercials (`../commercial/`, `../commercial2/`) are untouched; this folder only imports the shared toolkit (`next3d.py`), fonts and the app screens already captured for Ad #2.

## 1. Tools (verified in this environment)

| Need | Tool | Status |
|---|---|---|
| 3D | Blender 5.0.1, Cycles | Working. CPU here (4 cores, ~21 s per 1080×1920 frame for the opening); GPU via RunPod (`gpu_render2.py` pattern), ~1.7–5 s per frame on an A40/L40 for Ad #2 |
| Procedural sound wave | Blender geometry nodes (`opening3.py`) | Working: 9 strands, particles riding each strand, amplitude driven per frame by the score's loudness (`music3.py --env`) |
| Compositing + titles | Python (OpenCV, NumPy, Pillow), `post3.py` | Working: bloom, hue-preserving tone map, lens, grain; title cards at full resolution, vertical or `--wide` |
| App UI | Real NEXT screens captured from the app with demo data (Ad #2 assets: Discover, artist page, trade form, confirm, bought, portfolio, Founding Believer) | Available, no new capture needed |
| Founding Believer card | Ad #1 v2.1 card (`card-hero.png`) | Available |
| Music + SFX | Original score synthesized from scratch (`music3.py`) | Working: −14.7 LUFS, −1.8 dBTP |
| Encode | FFmpeg (H.264 High, AAC 48 kHz) | Working |
| Paid assets | none used, none needed | — |

## 2. Shot list

| # | Time | Frames | Picture | Camera | Title card | Sound |
|---|---|---|---|---|---|---|
| 1 | 0–5.5 s | 1–165 | Black. One tiny orange light flickers awake, then unfolds into a 3D sound wave of nine glowing strands; sparks travel along each strand; the wave moves with the music. Far behind, thousands of faint lights fade in | 35 mm, deep focus; a slow approach that starts to fly along the wave | EVERY GREAT ARTIST… (1.7–3.3 s) · STARTS SOMEWHERE. (3.5–5.4 s) | Low pulse at 60 BPM, air, a single high tone as the light wakes |
| 2 | 5.5–11 s | 166–330 | The camera passes through the strands into a dark world: hundreds of floating artist profile cards (real NEXT card layout, demo artists) and thousands of lights, drifting at different depths | wide lens, continuous forward dolly between the cards (parallax), slight bank | MILLIONS OF ARTISTS. (6–8.3 s) · WHO'S NEXT? (8.7–10.8 s) | Build: plucks, ticks, toms |
| 3a | 11–13 s | 331–390 | The cards turn into light and stream to one point; the streams collapse; black | push into the convergence point | — | Riser, then 0.5 s of silence |
| 3b | 13–17 s | 391–510 | Impact. A photoreal black phone emerges from the dark, rim-lit orange; the camera orbits ~70°; the screen wakes to the real Discover screen, then the NEXT logo | 50 mm, slow orbit with shallow focus, settles front-on | INTRODUCING NEXT. (14.5–16.8 s) | Braam + metal + kick at 13.0 s, held pad |
| 4 | 17–25 s | 511–750 | Push into the screen: a real artist profile, the trade screen, a virtual share purchase confirmed. Orange market lines grow out of the screen into a 3D chart around the phone; floating panels for portfolio, trade history and artist info | push-in, then pull back and arc through the chart | DISCOVER. (17.5) · BACK. (20) · TRADE. (22.5) — plus the small line "Virtual Credits · game values, no cash value · demo artists" | Drive at 120 BPM: kick, snare, hats, bass, UI ticks on each tap |
| 5 | 25–32 s | 751–960 | Music drops away. In darkness, the Founding Believer card (Ad #1 v2.1) rises; light rakes across its edge; the camera circles it slowly and it settles front-on | slow 180° arc + push, hold | FOUNDING BELIEVER. (26) · BACKER #1. (28) · YOU WERE EARLY. (30) — with "Demo data" on the card | Pads, bells, metallic hits at 27.5 and 29.0, riser at 30.5 |
| 6 | 32–40 s | 961–1200 | The card dissolves into light; the particles sweep into a huge NEXT logo; it holds on black with a soft reflection | slow pull-back, hold | NEXT. (34) · THE FUTURE OF MUSIC DISCOVERY. (35.5–39.5) | Braam at 32.0, final hit at 34.0, bells, long tail |

## 3. Transitions

- 1 → 2: no cut. The camera keeps flying along the wave and between the strands; the far lights become the world of artists (the same point cloud, brought closer).
- 2 → 3a: the cards stretch into light streams (motion blur + particle trails) that converge on one point.
- 3a → 3b: a hard 0.5 s black, then the impact frame (a single flash) on the downbeat at 13.0 s.
- 3b → 4: a continuous push into the phone's screen; the UI becomes full-frame without a cut.
- 4 → 5: the chart lines fade back into the dark, leaving one small orange light, which becomes the edge light on the card.
- 5 → 6: the card breaks into particles that fly into the logo shape (same particle system as in Ad #2's ending, retimed slower).

## 4. Soundtrack direction

Original, in D minor, built in `music3.py`. Different from both ads: Ad #1 was a bright stab-led groove and Ad #2 a 120 BPM drop; the trailer is a slow-burn score:

1. A 60 BPM pulse and air that grow with the light (0–11 s).
2. A riser, then real silence before the reveal hit at 13 s.
3. The only rhythmic section (17–25 s) doubles to 120 BPM under the product demo.
4. A deliberate hush for the card (25–32 s).
5. A final crescendo into the logo with a long tail.

The 3D wave in Scene 1 reads the score's loudness frame by frame, so the picture moves with the music. There is no voiceover.

## 5. Accuracy rules

- All app UI is the real NEXT interface on demo artists and players; no real artists.
- Prices are shown as game values in virtual Credits with no cash value, and the trading scene says so on screen.
- The Founding Believer card is labelled demo data; "YOU WERE EARLY" describes the record of the user's action, not a promise of success.
- No URL, download or sign-up message.

## 6. Render budget (needs approval before the full production)

| Option | Vertical 40 s | + 16:9 version | Cost |
|---|---|---|---|
| CPU in this session | ~8–10 h | another ~8–10 h | free (slow; each fix means hours) |
| RunPod GPU (A40/L40 class, ~$0.40–0.90/h) | ~1–1.5 h incl. upload/download | ~1–1.5 h | about $1–2 per version, ~$3–5 total with one round of fixes |

The current RunPod balance is about $0.54, which is not enough for the GPU route.

## 7. Files

`music3.py` (score + loudness envelope), `opening3.py` (Scene 1), `post3.py` (grade + titles).
Rendered frames, audio and videos stay out of git.
