# NEXT launch commercial: production project

A 20–25 s vertical (1080×1920) cinematic product ad for TikTok, Reels and
Shorts, plus a 6–10 s hook cut, three alternate openings and an optional
16:9 version. This folder holds the editable sources. Renders and audio are
generated and git-ignored.

## Toolchain (evaluated in this cloud environment, 2026-11-12)

| Tool | Status here | Role |
|---|---|---|
| **Blender 5.0.1** (`bpy` from PyPI) | ✅ Works. Cycles path tracing on CPU (4 cores, 15 GB RAM) | All 3D: chrome, glass, phones, particles, charts, lighting, camera |
| Blender EEVEE (fast real-time renderer) | ❌ Needs a GPU/OpenGL driver; none here | — |
| GPU | ❌ None | — |
| **FFmpeg 6.1** | ✅ Installed | Encoding, audio mux, loudness checks, platform exports |
| Python post (OpenCV, NumPy, Pillow) | ✅ | Bloom, tone map, grade, lens, grain, typography with the real brand fonts |
| Python audio (NumPy/SciPy) | ✅ | Original sound design, synthesized; no samples to license |
| Remotion | Not needed for the opener | Best for later scenes that animate real NEXT UI as React/web pages. Free for individuals and companies of ≤3 people; larger companies need a paid licence. |

**Decision:** Blender Cycles for every 3D frame. Python handles post and
typography, and FFmpeg does the final encode. Remotion is optional, only if
we want the app-screen scenes driven from live React components. Real
screenshots textured onto a 3D phone in Blender achieve the same "actual
interface" result with one fewer tool.

Measured render speed (full 1080×1920, 40 samples + denoise, motion blur):
**~70–150 s per frame** for chrome/glass shots and ~45–80 s for particle and
chart shots. A 25 s ad is 750 frames: **~12–20 hours of CPU** here, run in
background batches. A rented cloud GPU would do it in 1–2 hours for a few
dollars. That's **optional and needs your approval**; nothing paid is used.

## Connectors

**None are required.** Everything above runs locally in this session for free.

| Connector | Needed? | Why |
|---|---|---|
| GitHub (connected) | Yes, already have it | Stores this project |
| Render (connected) | Yes, already have it | The live site, for capturing real app screens |
| Adobe (connected) | Optional, **costs money** | Adobe Stock licensed music/SFX, Firefly. Only with your approval |
| Music library (Epidemic Sound, Artlist, …) | Optional, **paid**, no connector exists | A licensed bass-heavy track for the full 25 s (see below) |
| Cloud GPU (RunPod, Vast.ai, …) | Optional, **paid** | Faster renders only |

## What I need from you

1. **Logo.** The repo has no logo file (no SVG/PNG/favicon). The only brand
   mark is the header wordmark: **NEXT** in Bricolage Grotesque ExtraBold
   with a glowing ember dot (#FD6844). Confirm that's the official logo, or
   send vector files (SVG/AI/PDF).
2. **Launch destination for the end card.** The site is
   `send-a-shot.onrender.com`, which isn't brand-safe for an ad. A custom
   domain (also needed for email) or your approval to show the Render URL.
   NEXT is a web app, so the CTA should be "Play free at …", not
   "Download".
3. **Artists shown on screen.** Real artists' names and photos in an ad need
   their written permission (right of publicity). Choose one:
   (a) consent from 2–3 artists to feature their real NEXT pages, or
   (b) I create clearly fictional demo artists on staging and the ad says
   "Demo profiles" in small print. No real statistics are invented either
   way.
4. **Music.** Options: (a) you provide a track you have rights to;
   (b) approve a stock licence (typically ~$15–50 per track, or a
   ~$10–20/month subscription that covers social ads); (c) an original
   score I synthesize. (c) works for sound design and pulses but won't
   match a produced track.
5. **Copy approvals.** Headlines from your brief, plus the required
   disclaimer on screen in the trading scenes: *"Virtual credits only. No
   real money, no ownership of artists' music or earnings."*
6. **Paid tools:** none planned. Ask me for a GPU or music only if you
   want them.

## Storyboard (20–25 s, 30 fps)

| Time | Scene | Build |
|---|---|---|
| 0–3 s | **Hook** (rendered as a test): chrome vinyl spins in black, cracks with ember light, shatters into ~9,000 particles that stream into a 3D rising chart. "THE NEXT SUPERSTAR…" / "ISN'T FAMOUS YET." | `opener.py` |
| 3–9 s | Original 3D phone spins in showing real NEXT Discover/artist screens (captured at 3× from the app). Holographic artist cards orbit; preview plays; "Back" tap; virtual credits counter. "DISCOVER. BACK. TRADE." | Blender + screen textures |
| 9–16 s | Fast cuts through 3D price charts, portfolio, leaderboard, a Founding Believer card reveal (the app's real holo card design). "PROVE YOU WERE EARLY." + disclaimer | Blender |
| 16–22 s | Everything collapses into the NEXT wordmark. "DISCOVER TOMORROW'S STARS. TODAY." → "JOIN NEXT" + destination | Blender + type |

Alternate hooks to test: (B) a phone falls into frame and the chart erupts
off the screen; (C) a leaderboard rank counter rolls from #9,999 to #1 as
the camera dives through it.

## Rules the ad follows

- Virtual credits are shown as virtual. Nothing implies cash, payouts or
  ownership of musicians.
- No invented artist statistics or user achievements. Anything shown is
  real (with permission) or labelled demo.
- Only licensed or original audio, fonts (OFL) and visuals. No copied
  commercials.
- Text stays inside the 900 px-wide safe area, clear of TikTok/Reels UI.

## Run it

```bash
python3.11 -m venv blender-venv && blender-venv/bin/pip install bpy   # ~375 MB
python3.11 -m venv post-venv && post-venv/bin/pip install opencv-python-headless numpy pillow scipy fonttools brotli skia-pathops
post-venv/bin/python extract_fonts.py
blender-venv/bin/python opener.py -- --frames 1-90 --out frames --save NEXT-opener.blend
./assemble.sh        # post + sound + encode -> NEXT-opener-test.mp4
```
`--preview --list 12,40,70` renders quick low-res stills for art direction.
