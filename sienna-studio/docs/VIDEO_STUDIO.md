# Video Studio (Wan2.2)

Status: **dev branch `video-studio`, off unless `SIENNA_VIDEO=true`. Not deployed; not yet run on a real GPU.**

## What it does

| Mode | Model | Input | Output |
|---|---|---|---|
| **Animate Image** | Wan2.2 image-to-video 14B (fp8, high/low-noise experts) | a gallery photo + what she does + camera move | 2–5 s, 16 fps, 480p or 720p |
| **Copy Motion** | Wan2.2 Animate 14B (fp8), "move" mode | a gallery photo + a short movement video | up to 14 s (made in 1–3 parts), 16 fps |

Both graphs follow ComfyUI's official templates (`video_wan2_2_14B_i2v`, `video_wan2_2_14B_animate`); every node input
name is checked against ComfyUI's and comfyui_controlnet_aux's source in `lib/video.test.ts`.

- **Fast vs quality (Animate Image):** fast = the template's 4-step lightx2v LoRAs (≈ 1.5 min per 5 s clip at 640×640 on an
  RTX 4090, per the template notes); quality = 20 steps, cfg 3.5 (≈ 9 min).
- **Copy Motion** extracts body/hand pose and face keypoints from the movement video with DWPose and gives Wan only those —
  the character/background replacement inputs are not connected, so **the person in the movement video never appears**.
  Longer clips are made in 77-frame parts that continue the previous part's last 5 frames (the template's "Video Extend").
- **Identity:** Wan can't load Sienna's SDXL LoRA, so her identity comes from the photo. Pick a face-verified photo.

## Face check (same rule as photos, applied to frames)

Four frames spread through the clip (never the first frame of Animate Image, which is the photo itself) go through
`SiennaFaceCheck` at 0.74. **Verified only if her face is found in at least one checked frame and every frame where it's
found scores ≥ 0.74.** Otherwise the video goes to **Needs Review** (didn't match / face not detected / check
unavailable), with Looks like Sienna / Not her like photos. Videos are **never retried automatically** (GPU cost).

## Files and storage

- Results: `DATA_DIR/images/vid_*.mp4` (H.264, index moved to the front for streaming) + a poster PNG in `images`.
- Movement videos: normalised on the app server with ffmpeg (bundled `ffmpeg-static`): first 20 s, upright, 16 fps,
  longest side ≤ 832 px, no sound → `mot_*.mp4` (a 100 MB phone clip becomes ~2 MB). Uploads up to 200 MB, streamed to
  a scratch file, never held in memory.
- `/api/files/*` answers byte-range requests (HTTP 206) — iPhone Safari needs this to play video.
- Deleting a video removes its MP4 and poster, and the movement video once no other video uses it. The photo is never
  touched.
- Size: a 5 s 480p clip is ~0.5–2 MB. The 1 GB Render disk holds a few hundred; resize it if you make many.

## GPU setup

`bash comfyui-bootstrap.sh --with-wan-video` (~62 GB; ComfyUI 2025-09+ for the video nodes). It checks the upstream Wan2.2
licenses (Apache-2.0) first. Needs 24 GB+ VRAM (48 GB+ is faster for 720p and long Copy Motion), ~64 GB RAM.

## Not done yet / open

- **No real-GPU run yet.** Graphs are validated structurally (node names and inputs vs. ComfyUI source, test mode, a fake
  ComfyUI over HTTP), not visually. Proposed test plan: see the session report.
- No sound (movement videos are stripped; Wan outputs silent video).
- Wan Animate 2 (Aug 2026, no pose extraction) could replace Wan2.2 Animate for Copy Motion; worth an A/B on the GPU.

## Copy Motion proof of concept (2026-10-15, real GPU)

Engine: **Wan2.2-Animate-2 14B** (int8, Comfy-Org/Wan-Animate-2; Apache-2.0, confirmed on Hugging Face), now the default
Copy Motion engine (`SIENNA_MOTION_ENGINE=animate1` selects Wan2.2 Animate v1). Graph follows ComfyUI's official
`video_wan_animate2` template (6 LCM steps, cfg 1, shift 5, lightx2v LoRA, motion cache in system RAM).

- Inputs: blind-confirmed Sienna photo (face 0.779, red dress, facing camera); ComfyUI's MIT-licensed sample
  `street_dance_drive.mp4`, 1.0–5.0 s (the first second is a close-up), normalised by the app to 16 fps.
- RTX 4090 24 GB (Secure Cloud, $0.89/h): **185.8 s** for a 4 s, 528×768 clip including model load; 175 s for a
  second run; 23.4 s per step; **VRAM peak 17.7 GB** — no offloading needed. Downloads 24.4 GB in ~4 min.
- Result: motion copied closely (steps, spin, arm swings, the driving camera's push-in), red dress and her room kept,
  no flicker or broken limbs seen. **Face check failed: 0.22–0.51 on all 4 frames** (bar 0.74). Her hair and eye colour
  carry over, but the face shape drifts and the dancer's earrings and expressions leak in. Raising
  `reference_image_strength` to 1.5 did not help (0.25–0.50).
- Two community-cloud 4090 hosts had broken CUDA (`cuInit` 999); check CUDA before downloading.
- Network volume: **56 GB used, 19 GB free** of 75 GB; its ComfyUI (2026-09-25) lacks the Wan Animate 2 nodes
  (need ComfyUI ≥ 0.35).
- Cost: ≈ $0.50 in total.

## Identity follow-up (2026-10-15, $0.32, separate RTX 4090, production volume untouched)

Same photo, same dance, same seed. Every one of the 64 frames scored with the app's face check (YuNet + SFace vs
Sienna's reference, bar 0.74; "usable" = face ≥ 64 px):

| Version | Median | 10th pct | Best | Frames ≥ 0.74 | Face flicker* |
|---|---|---|---|---|---|
| Wan Animate 2 | 0.40 | 0.24 | 0.58 | 0 / 60 | 30.4 |
| Test 1 — Wan2.2 Animate v1 (DWPose) | 0.42 | 0.22 | 0.67 | 0 / 8 (faces 46–89 px) | 27.0 |
| Test 2 — WA2 + Sienna FaceDetailer, denoise 0.35 | 0.64 | 0.39 | 0.75 | 1 / 60 | 29.4 |
| Test 2 — WA2 + Sienna FaceDetailer, denoise 0.5 | **0.67** | 0.37 | 0.75 | 3 / 60 | 29.8 |
| Test 2 + temporal smoothing of the correction | 0.54–0.56 | 0.25–0.31 | 0.70 | 0 / 60 | 28.9–29.1 |

\*mean frame-to-frame change inside the aligned face, lower = steadier (mostly real motion).

- v1: closest to Sienna in calm frames, but her face is small and smeared in fast moves; it re-frames her head-to-toe and
  swapped her shoes for black boots. Motion comparable to WA2; ~11 s/step vs 23 s.
- Face restore (production settings: RealVisXL V5 + sienna_v2, fixed seed, face-only prompt): clearly the most Sienna
  (freckles, eyes, face shape), steady frame to frame, but it neutralises expressions (open mouth → closed) and
  can't fix the head-tilted-back frames (0.23). Smoothing the correction over neighbouring frames lowered identity.
- Verdict: neither reaches the bar throughout the clip. Next step: a Wan-native Sienna identity LoRA (ai-toolkit
  `train_lora_wan22_14b_24gb`, her approved 29-image v2 dataset), so identity comes from the video model itself.
