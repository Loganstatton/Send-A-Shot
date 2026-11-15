# NEXT × SCOUT — "THE SIGNAL": export and quality report

## Deliverables (all measured from the exported files)

| File | Format | Measured |
|---|---|---|
| `THE-SIGNAL-60s-vertical.mp4` (hero, Hook A, narration) | 1080×1920, 30 fps, H.264 High CRF 16 + AAC 320k | 1800 frames, 60.0 s, −14.0 LUFS, −1.5 dBTP |
| `THE-SIGNAL-60s-16x9.mp4` | 1920×1080, same | 1800 frames, 60.0 s, −14.0 LUFS, −1.5 dBTP |
| `THE-SIGNAL-60s-hookB-{vertical,16x9}.mp4` | Hook B, same film after 3 s | 1800 frames each, −14.0 LUFS, −1.4 dBTP |
| `THE-SIGNAL-60s-hookC-{vertical,16x9}.mp4` | Hook C, same film after 3 s | 1800 frames each, −14.0 LUFS, −1.2 dBTP |
| `THE-SIGNAL-60s-no-voiceover-{vertical,16x9}.mp4` | music, effects, on-screen text | 1800 frames each, −13.9 LUFS, −1.3 dBTP |
| `THE-SIGNAL-30s-{vertical,16x9}.mp4` | advertising cut | 900 frames, 30.0 s, −13.5 LUFS, −1.5 dBTP |
| `THE-SIGNAL-15s-{vertical,16x9}.mp4` | advertising cut | 442 frames, 14.7 s, −13.3 LUFS, −1.5 dBTP |
| `THE-SIGNAL-{60s,60s-hookB,60s-hookC,30s,15s}.srt` | captions | timed from the narration's actual placement in each version |
| `THE-SIGNAL-soundtrack-master.wav` | 48 kHz, 24-bit, mastered | −14 LUFS integrated, two-pass loudness normalisation |
| `stems/THE-SIGNAL-stem-{voice,music,sfx}.wav`, `stems/THE-SIGNAL-music-and-effects.wav` | stems at final mix level | sum to the mix before mastering |
| `THE-SIGNAL-thumb-{card,waveform}[-16x9].png` | thumbnails | from untitled grades of the final frames |
| `editable/THE-SIGNAL-*.blend` | Blender 5.0 scenes (hook, hookb, hookc, scout5, next5, panels5, card5) | images packed; open without the asset folder |
| Compositing project | `post5.py` (grade, typography, small print, rating cards), `assemble5.py` (edit, mixes, masters, cuts, captions), `music5.py` / `synth5.py` (score), `mix5.py`, `vo5.py` | re-runs from the rendered frames |

Every frame is a native Cycles render at the delivered size (OptiX on RTX 4090s, 96–160 samples, AgX, motion blur), graded in post; nothing is upscaled.

## The brief's final checks

| Check | Result |
|---|---|
| First frame has an immediate visual hook | Frame 1 is mid-flight through the 3D chart, with motion blur and "THIS ISN'T A STOCK." already on screen; a bass impact sounds on frame 1. No black, no logo build. |
| First three seconds communicate the concept | A stock chart (0–0.7 s) becomes an audio waveform (0.7–1.3 s), then SCOUT (cyan, the real queue) and NEXT (orange, the real trade panel) appear under the SCOUT × NEXT wordmarks (2.1 s). The titles carry it with the sound off. |
| Both product names appear early | SCOUT × NEXT at 2.1 s; the SCOUT mark at 3.4 s; NEXT's own screens from 2 s. |
| Zero visible humans | Checked frame by frame on contact sheets: no people, hands, silhouettes, avatars or photos. The demo artist's art is an abstract ring; player avatars in the app are initials; the profile's video thumbnail was answered with the abstract cover during capture; no video is played. |
| SCOUT's internal role is explained | "SCOUT IS INTERNAL · NOT PART OF THE PUBLIC APP" (0:03–0:10), "SCOUT IS INTERNAL · NEXT IS PUBLIC" (0:17–0:22), end line "SCOUT — INTERNAL ARTIST DISCOVERY AND EVALUATION". |
| SCOUT's scoring is accurately represented | The real Approve click (status: "1 approved" on the real dashboard), then the scout's own 8-factor rating set by hand, four at a time, with the app's weights (25/15/15/15/10/10/5/5) and the resulting 86.0. "EACH FACTOR RATED 0–10 BY A SCOUT". No AI scoring, no streaming numbers, no predictions. |
| The SCOUT-to-NEXT transfer is clear | The evaluated profile lifts off the monitor as glass, travels a corridor that turns cyan to orange, turns edge-on into Juno's real NEXT card and lands on the phone's Discover screen; titles APPROVED ON SCOUT. / LIVE ON NEXT. |
| Virtual buying and selling is easy to understand | Balance $10,000.00 → $250 → Review → Confirm → "Bought 6.5138 shares at $38.38"; the price line grows out of the phone with one node per real trade; the Sell tab, $50, Confirm → "Sold". |
| Virtual Credits vs real money is clear | "VIRTUAL CREDITS · NO CASH VALUE" + "NOT REAL MONEY OR SECURITIES · DEMO DATA" for the whole trading section; the narration says "virtual Credits" and "simulated market". |
| The Founding Believer card is memorable | The approved v2.1 card, re-issued from this film's record (Maya Chen, Backer #1, locked Nov 14 2026, backed at $38.38, first of 12 backers), lit from the dark with a warm impact; "FIRST RECORDED NEXT BACKER · DEMO DATA". |
| Soundtrack and narration balanced | Measured per line from the stems, speech band (300–3400 Hz): voice is +9.5 to +16 dB over music + effects on every line (opening lines +9.5 / +12.5 dB under the hook's impacts). |
| Understandable muted | Every beat has a title; captions (.srt) for every narrated version. |
| Genuinely 1080×1920 | ffprobe: 1080×1920 (vertical) and 1920×1080 (16:9), 30 fps, frame counts above. |
| Legible on a phone | Phone UI close-ups frame the full screen width; the SCOUT rating panel (too small to read at phone size as a landscape UI) is composited as sharp type at final resolution, with the real values and weights. |
| Safe zones | Titles in the band 17–30% of height; small print above 65%; nothing important in the strictest published bottom margin (672 px of 1920) except the end-card CTA at 60–63%. |
| Permissions | All picture: our renders + captures of our own app on invented demo data. All sound: synthesized from scratch (score, effects, the demo artist's preview fragment). Narration: Kokoro-82M (Apache-2.0, commercial use allowed); no person's voice imitated. Fonts: Inter (OFL), Bricolage Grotesque (OFL), IBM Plex (OFL). |
| Destination website works | `https://send-a-shot.onrender.com/next` returns 200 (checked 14 Nov 2026). The first request after idle took 24 s (server asleep): keep it warm before paying for traffic. |
| Glitches or artifacts | Scene joins measured (mean frame difference vs the frames either side): 90→91 0.022 (neighbours 0.016/0.023), 660→661 smoothed with a 5-frame light dissolve, 1200→1201 0.026 (the pull-back starts), 1410→1411 0.008 (through black). No missing frames (1980 per format checked). Motion blur is heavy only on fast camera moves between holds. |

## Accuracy decisions (where the brief and the app differ)

- **Narration line 4** was "Human reviewers evaluate eight factors, then approve which artists go live." In the app a scout approves first (that lists the artist on NEXT at 50.0), then rates. It now says: "Human reviewers approve which artists go live, then rate them on eight factors."
- **Automated discovery**: the YouTube scan exists but needs an API key, so it was not run; the queue shown contains only fan submissions (a real feature) and the real "Run YouTube scan now" control. No scan results were invented.
- **Music preview**: NEXT plays previews through official YouTube embeds. Showing one would put a third-party music video (people) into the ad, so the film shows the real preview control and a 3D waveform with an original demo fragment, labelled "DEMO ARTIST · PREVIEW AUDIO IS AN ORIGINAL DEMO TRACK".
- **Founding Believer / Backer #1**: the card's own lettering carries FOUNDING BELIEVER and BACKER #1; the brief's third line, YOU WERE EARLY., is a title as the card recedes.

## Known limits

- The narration is synthesized (Kokoro, voice "af_heart"). A professional voice actor or a paid commercial-licence voice service would sound better; swapping it means regenerating `vo5.py`'s lines and re-running `assemble5.py` (no re-render).
- In the 16:9 version, the phone close-ups show the phone in the middle of a wider dark frame (the cameras keep the vertical framing height).
- The public address is the Render subdomain; a custom domain can replace it in `post5.py` (`CTA`) and re-run `assemble5.py`.

## Cost

RunPod GPU time for this film: hook test, then vertical + 16:9 + hooks B and C in eight parallel jobs — about $2.04 (balance $7.43 → $5.39).
