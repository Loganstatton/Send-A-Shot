# NEXT Ad #2 — "I FOUND THEM FIRST. PROVE IT."

22 s · 1080×1920 · 30 fps · 120 BPM (a beat = 0.5 s = 15 frames; every scene boundary is on a beat).
Ad #1 (`../commercial/`) is untouched; this folder only imports its toolkit and fonts.

## 1. What was verified (step 1–4 of the brief)

| Item | Status |
|---|---|
| 3D | Blender 5.0.1 (Cycles). Genuine 1080×1920 renders on a RunPod GPU (RTX 4090 / A40, OptiX denoise, 128 samples, motion blur). The opening preview was rendered this way, not upscaled. |
| Compositing | Python (OpenCV/NumPy/Pillow) grade + full-resolution typography; FFmpeg for encode and edits. |
| App footage | Real NEXT screens captured from the app on a local database with invented artists and players (`../commercial/capture_screens.js`, 4× resolution): Discover, artist page, trade form, confirm, bought, portfolio, leaderboard, Founding Believer. No invented UI. |
| Backer #1 card | Reused from Ad #1 v2.1 (`card-hero.png`, `make_card.py`): the app's real Genesis Founder tier, Backer #1, serial, lock date. |
| Voiceover | Kokoro-82M, an open-source voice model (Apache-2.0: commercial use allowed), voice `af_heart`. Synthetic; a human VO artist can replace it 1:1 (`vo.py` lines + timings). |
| Music + SFX | Original, synthesized from scratch (`music2.py`, `mix2.py`). No samples or licensed recordings. |
| Human footage | **Not available here.** Stock sites (Pexels, Pixabay, Mixkit, Coverr) and Hugging Face are blocked by this environment's network rules, and buying footage needs approval. Scene 1 is therefore a photoreal 3D studio stand-in built so a real clip drops into the same 0–2 s slot. |

## 2. Storyboard and camera plan

| Time | Frames | Scene | Picture | Camera | Type (sound-off) | VO | Sound |
|---|---|---|---|---|---|---|---|
| 0–2 s | 1–60 | 1 HOOK | Dark creative studio, orange practicals, record shelf; the phone on the desk already shows NEXT Discover ("Prove you found them first.") | 50 mm, real-lens depth of field; slow push-in with handheld drift (decays) | **I FOUND THEM FIRST.** from frame 1 | "Everybody says they found them first." | Opening punch (boom + Cm9 stab) at 0.0 |
| 1.8–2.2 s | 54–66 | THE TURN | The studio goes dark around the phone; the phone lifts into a black void | the rush: accelerating push, continuous | — | — | Rising whoosh, "lights out" thunk |
| 2–4 s | 61–120 | 2 PROVE IT | Phone floating in darkness; an orange ring of light circles the phone and travels up its body, lighting the metal; a soft reflection crosses the glass | arcs ~30° to show the edge and thickness, then settles toward front | **PROVE IT.** slams on the beat | "Prove it." | Bass drop + impact at 2.0; ring shimmer |
| 4–7 s | 121–210 | 3 DISCOVER | Phone turns to camera; Juno Marrow's real profile expands off the screen into a floating 3D panel (cover art, name, genre); preview play with a light pulse | slow push, f/1.8-equivalent shallow focus on the panel | **DISCOVER.** | "Discover artists before the crowd." | Bell motif enters; UI tick on play |
| 7–11 s | 211–330 | 4 BACK. TRADE. | Real trade screen fills the frame: price, Credits balance, $250, "Review purchase", "Confirm purchase", "Bought 5.6779 shares at $44.03", portfolio updates; on the purchase, orange market lines extend from the screen and a 3D chart forms around the phone | close-ups on each control, then pull back and fly into the chart | **BACK ARTISTS.** → **TRADE VIRTUAL SHARES.** + "Virtual Credits · no real money · no ownership" | "Back them with virtual Credits." | UI taps, success chime, energy lift at 7.0 |
| 11–14 s | 331–420 | 5 TRACK YOUR PICKS | Through the chart into a dark space of floating real artist cards; parallax past them to the real portfolio (+16.1%) and Top Traders leaderboard (#1 lit) | dolly between the cards (parallax), land on the phone | **TRACK YOUR PICKS.** | "Track your picks." | Hat rolls, swish per card |
| 14–18 s | 421–540 | 6 BACKER #1 | Market fades to black; a small orange light; the Founding Believer card (Ad #1 v2.1 design) rotates toward camera, light catches its thickness, settles front-on and holds | slow arc + push, settle and hold ~1.5 s | **YOU WERE EARLY.** + "Backer #1 = first recorded backer on NEXT" | "And if you're first? You've got the proof." | Riser, metallic hit at 15.0, sub |
| 18–22 s | 541–660 | 7 WHO'S NEXT? | Card drifts back and dissolves into fine orange particles that form the NEXT logo on clean black with soft reflections | slow pull-back | **THINK YOU KNOW WHO'S NEXT?** → **PROVE IT.** → NEXT · **FIND THEM FIRST.** · **TRY NEXT FREE** · URL · "Virtual Credits. No cash value." | "Think you know who's next? Prove it." | Logo sound, final stab at 20.0 |

Hooks (same body, frames 1–60 swap only): **A** "I FOUND THEM FIRST." (competition) · **B** "WAIT… YOU CAN TRADE MUSIC ARTISTS?" (opens on the trade screen) · **C** "CAN YOU FIND THE NEXT BIG ARTIST?" (opens on an emerging artist).

## 3. Accuracy and compliance rules for this ad

- Every number on screen comes from the app's own engine on invented demo artists and players (Juno Marrow et al.); no real artists, no testimonials, no growth claims.
- Trading is shown as virtual Credits with no cash value and no ownership of artists, music or earnings (on-screen line during the trade and at the end).
- "Backer #1" is labelled as the first recorded backer on NEXT — a permanent record of the user's action, not proof of future success.
- CTA says "Try NEXT free" (web app; no native app).

## 4. Files

`opening.py` (frames 1–120), `phone2.py` (hero phone), `post2.py` (grade + type), `music2.py`, `mix2.py`, `vo.py`, `gpu_render2.py`.
Rendered frames, audio and videos stay out of git (see `.gitignore`).

## 5. Delivered (final render)

| File | What | Checked |
|---|---|---|
| `NEXT-ad2-A-found-them-first.mp4` | main, hook A (competition) | 1080×1920, 660 frames, 22.0 s, −14.7 LUFS, −3.9 dBTP |
| `NEXT-ad2-B-trade-artists.mp4` | hook B (trading curiosity): the studio phone shows the trade screen | 660 frames, 22.0 s, −14.6 LUFS |
| `NEXT-ad2-C-next-big-artist.mp4` | hook C (discovery): the studio phone shows Juno's featured card | 660 frames, 22.0 s, −14.7 LUFS |
| `NEXT-ad2-A-captions.mp4` | sound-off version: voiceover as captions | 660 frames |
| `NEXT-ad2-12s.mp4` | condensed: 0–4 + 8–10 + 14–16 + 18–22 s, cut on bar lines | 360 frames, 12.0 s, −15.3 LUFS |
| `NEXT-ad2-cover.png` | cover / thumbnail | 1080×1920 |

All 3D is rendered at a true 1080×1920 (Blender Cycles on a RunPod GPU, OptiX denoise); type is composited at full resolution.
Scene 1 is a 3D studio, not live action (stock footage was unreachable from this environment); a filmed 2 s clip can replace frames 1–60.
Voice: Kokoro-82M `af_heart` (synthetic, Apache-2.0). Music and sound design: original (`music2.py`, `mix2.py`).
CTA URL checked: `https://send-a-shot.onrender.com` → 200 at `/next`.

Rebuild: render `opening.py`, `body.py`, `hero.py`, `opening.py@b`, `opening.py@c` with `gpu_render2.py`, then `assemble2.sh`.
`blender-venv/bin/python <scene>.py -- --assets DIR --save scene.blend` writes an editable .blend of any scene.
