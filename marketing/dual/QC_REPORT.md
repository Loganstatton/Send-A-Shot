# SCOUT × NEXT — "BEFORE THE BREAKOUT": final quality check

## Deliverables

| File | Format | Measured |
|---|---|---|
| `SCOUT-NEXT-before-the-breakout-vertical.mp4` | 1080×1920, 30 fps, H.264 High + AAC 48 kHz | 1200 frames, 40.0 s, −14.8 LUFS integrated, −3.2 dBFS peak |
| `SCOUT-NEXT-before-the-breakout-16x9.mp4` | 1920×1080, same | 1200 frames, 40.0 s, −14.8 LUFS, −3.2 dBFS |
| `SCOUT-NEXT-15s.mp4` / `-16x9` | 15 s cut | 450 frames, 15.0 s, −15.5 LUFS, −3.9 dBFS |
| `SCOUT-NEXT-soundtrack.wav` | 48 kHz stereo | original score + sound design, 40.0 s |
| `SCOUT-NEXT-thumb-reveal[-16x9].png`, `SCOUT-NEXT-thumb-connection[-16x9].png` | 1080×1920 / 1920×1080 | thumbnails with the campaign title |
| `editable/SCOUT-NEXT-{scout,transition,next4,finale4}.blend` | Blender 5.0 | every image packed; open without the asset folder |
| Compositing project | `post4.py` (grade, titles, small print, cuts), `assemble4.sh` (edit, encode, 15 s cut), `music4.py` (score, cue sheet) | rebuild from the rendered frames in ~15 min |

Every frame is a native render at the delivered size (Blender Cycles, OptiX on RTX 4090s, 64–128 samples, motion blur); nothing is upscaled.

## Checks

| Check | Result |
|---|---|
| Continuity between scenes | The scenes are separate renders of one set. Scene joins were compared frame-for-frame in test renders: SCOUT → transition 0.1% mean difference, transition → NEXT 0.04% (both invisible). |
| Phone-size viewing | Frames from the final vertical MP4 scaled to 390 px wide (phone width): every title and small-print line is legible; app screens are legible in every close-up. |
| Screen readability | Fixed in review: a key-light reflection over the phone screen in the NEXT section (re-rendered), a title over the SCOUT queue close-up (retimed). |
| Bloom / flicker | No blown highlights on UI; no flicker (screen textures are static images with cross-fades; denoised). |
| Warped screen textures | None: screens are flat, UV-mapped captures at 3200×1800 (SCOUT) and 1560×3376 (NEXT). |
| Audio | Original synthesized score (no samples, no licence needed). Sound effects on the approval, the lift, the flip, the landing impact (16.5 s), each UI tap, the purchase, the card's hit (29.0 s) and the logo impact (37.0 s). |

## Accuracy (against the brief's rules)

- **Real UI only.** SCOUT and NEXT screens come from the actual app run locally on a scratch database with invented artists and players (`capture_dual.js`). No production data, no real people, no credentials, emails, internal notes, or money pages (Screener totals, deals, revenue, investments) are shown. App code was not changed.
- **Human evaluation.** The film shows a person clicking Approve and the scout's own 8-category rating (with the app's real weights). The NEXT Score (86) is that rating. No AI scoring, streaming statistics or predictions are shown or claimed.
- **Automated discovery** appears only as what exists: the queue's own description and "Run YouTube scan now" button are visible on the real screen; the scan itself was not run (it needs API access), and no scan results were invented. The candidates in the queue are fan submissions made through NEXT's real "Submit an Artist".
- **Internal vs public.** On-screen: "INTERNAL TALENT DISCOVERY · HUMAN EVALUATION" (SCOUT), "APPROVED BY A SCOUT · NOW LISTED ON NEXT", and at the end "SCOUT POWERS INTERNAL DISCOVERY · NEXT IS THE PUBLIC EXPERIENCE".
- **Virtual trading.** "VIRTUAL CREDITS · NO CASH VALUE · NOT REAL SECURITIES · DEMO DATA" is on screen for the whole NEXT section.
- **Backer #1.** The card is the approved v2.1 design, re-issued from this journey's record (Maya Chen, Backer #1, locked Nov 13 2026, backed at $38.38, first of 12 backers), labelled "FIRST RECORDED NEXT BACKER · DEMO DATA". No claim that the artist succeeded.
- **Music previews** are not shown playing: NEXT plays real Spotify/YouTube embeds, which need a real artist; the demo artist has none.

## Known limits

- The SCOUT section moves quickly between the roster and the queue (about 0.5 s of motion blur at 6.0 s), by design of the 8-second section.
- In the vertical format the queue row is too wide to show the artist's name and the Approve button in one shot, so the camera shows them one after the other.

## Cost

RunPod GPU time for this commercial: transition preview, full vertical + 16:9 renders, and one NEXT-section re-render — about $1.80 in total.
