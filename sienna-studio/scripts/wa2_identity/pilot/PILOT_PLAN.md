# WA2 identity-LoRA pilot (300 steps): final preparation

**Status: ready, not started.** No GPU launched, no money spent this round. Production, Video Studio, the SDXL LoRA, the NSFW packs and the `sienna-studio` RunPod volume are untouched.

## 1. The 8 pending pairs (your decision)
Sheets: `stageA_review/wa2_final_review/<ID>.jpg`, sent to you in the chat. None are approved. Coverage below is measured against the 24 frozen training pairs.

| Pair | Adds | New coverage | Main concern |
|---|---|---|---|
| R1-17 | **Right turn +17° with an open smile.** The 24 have nothing right of +10° | High | None; passes every automatic check (0.73) |
| P41 | **Strongest right turn (+37°), looking down (+19°), the only opposite tilt (+15°)** | High, *if it is her* | Identity 0.35, unreadable at this angle. Judge by eye |
| P9 | **Right turn +19°, looking up.** Nothing in the 24 looks up | Medium-high | Identity 0.63, dark lighting |
| P3 | **Left profile −51°**, head level | High | Profile, so identity by eye only (0.57) |
| P1 | **Left profile −57°**, head level | High | Profile, by eye (0.50). Overlaps P3 |
| P12 | **The only full-body pair** (face about 115 px, as in the dance clip) | High | Face too small to measure. Loss is head-only, so it trains her small face, not her body |
| O-023 | Near-frontal, neutral (+8°) | Low | Identity 0.67, close to existing poses |
| O-012 | Open toothy smile, frontal | Low | The 24 already have 5. The driver's teeth look stretched |

Once you decide, approved pairs go into a new **frozen v2** (v1 is never edited), and `make_pilot.py --include …` recomposes the 300 steps.

## 2. Frozen dataset
- `stageA_review/wa2_dataset_frozen_v1/` contents:

  | Folder | Contents |
  |---|---|
  | `train/` | 24 pairs |
  | `review_pending/` | 8 pairs |
  | `validation_heldout/` | 6 photos: P5, P6, P8, P42, O-006, O-017 |

- Each pair is reference + driver + target + loss mask. `SHA256SUMS` covers 136 files, and every file is read-only.
- Checked: no overlap between the sets, and no validation photo is used as a reference.
- Single-file bundle for upload: `wa2_dataset_frozen_v1.tgz` (56 MB, sha256 `7d8d5259…`).
- **Note:** `stageA_review/` is excluded from git, so the dataset currently lives only in this temporary container. Uploading the bundle to the pilot volume (section 4) also secures it.

## 3. Training configuration (`sienna-studio/scripts/wa2_identity/pilot/pilot_config.json`)
**Unchanged from the passed smoke test:**
- Official bf16 Wan Animate 2, DiffSynth at the same commit.
- LoRA rank 32 on `self_attn.q/k/v`, so both the reference and driver streams train.
- LR 1e-4, 528×768, constant prompt.
- Reference slot excluded from the loss, **head-only loss mask**.
- Drivers are other women (identity ≤ 0.35), so her identity can only come from the reference.

**New for the pilot:**
- **300 steps = 3 epochs × 100 rows** (`make_pilot.py`), checkpoints at 100, 200 and 300.
- **Selfie-tilt fix.**
  - Before: all 24 targets lean the same way (−8° to −27°).
  - Each pair gets in-plane rotated copies, with driver, target and mask rotated together. The reference is never rotated.
  - Result: of 80 still rows, **33 lean her usual way, 23 are level and 24 lean the opposite way** (+6° to +18°).
  - Verified: all rotations land within 4° of the intended tilt, and every face stays inside its loss mask.
  - No mirroring, which would flip her facial asymmetry.
  - The reflected image border is excluded from the loss, so the model never learns a mirrored face or hair.
- **Priority weighting.**
  - Head turns (≥12°), open smiles and laughs, and full body get an extra original copy and a level-tilt copy.
  - Their 9-frame pseudo-clips come first (20 clip rows), for stability under motion.
- **Stop conditions:** loss NaN or diverging, training projected over 150 min, out of memory, LoRA key check failing, no visible effect, or the body no longer following the driver.

## 4. Storage: exactly where everything goes
| What | Where | Survives pod termination? |
|---|---|---|
| Models (about 70 GB), latent cache | Training pod's container disk (`/root/m`, `/root/work`) | No (re-downloadable) |
| Frozen dataset bundle + checksum | **New pilot volume** `/workspace/wa2_pilot/dataset/` | **Yes** |
| Checkpoints, step 100/200/300 (DiffSynth + ComfyUI-converted, about 80–160 MB each) + `SHA256SUMS` | **New pilot volume** `/workspace/wa2_pilot/ckpt/` | **Yes** |
| Logs (training, loss, step time, RAM/VRAM, composition) | **New pilot volume** `/workspace/wa2_pilot/logs/` | **Yes** |
| Evaluation videos + `report.json` | **New pilot volume** `/workspace/wa2_pilot/eval/` | **Yes** |
| Chosen LoRA + eval report (about 0.3 GB) | Copied to this session (1.2 GB free now), checksum-verified, then **sent to you as a file** | Your own copy |

- **Proposed:** a new, separate 20 GB RunPod network volume `sienna-wa2-pilot`, about $1.40/month while it exists, in a datacenter with A40/A6000 stock.
- **Durability:** checkpoints are copied there the moment each one is saved, so a crash or termination loses at most the steps since the last save.
- **The production `sienna-studio` volume is not mounted** and nothing is written to it.
- **Two independent safety stops:**
  - The spend watchdog in this session.
  - An **on-pod hard deadline** (the pod deletes itself after 240 min). This works even if this session is idle; the smoke test only had the first.
- **Local space:** freed 0.9 GB by deleting only byte-verified duplicates (split and zip copies of LoRA files and images whose originals are still present). Nothing else was deleted.
- Also note: this container itself is temporary. The local copies of the SDXL LoRA checkpoints here aren't durable storage either.

## 5. Evaluation (`eval_pilot.py`, validated locally)
**Fixed inputs**, the same as the 0.41/0.67 results:
- Photo `sienna_front_dress_0779.png`
- `street_dance_drive.mp4` from 1.0 s, 64 frames at 16 fps
- Seed 2202, 528×768, WA2 int8 with lightx2v, 6 steps

**Validated:** the script reproduces the earlier results on the stored frames exactly: no-LoRA **0.395**, face-restored **0.665**, flicker 30.38.

**Baselines:** the user-facing "0.41" is Copy Motion's earlier figure. On this scorer, Wan Animate 2 without the LoRA is 0.395 and Copy Motion v1 is 0.418. The no-LoRA run is re-rendered on the same pod for an exact A/B.

**What it measures, per run:**
- **Identity:** median, p10, frames ≥ 0.74.
  - Split by head angle: frontal, turned 15–35°, over 35°, plus unreadable frames.
  - Split by the driver's expression.
  - Also scored against the **6 held-out photos**, so we can tell whether it learned *her*, not just its training photos.
- **Flicker.**
- **Expression liveliness:** mouth and smile motion relative to the no-LoRA run, plus correlation with the driver's mouth. **A frozen or expressionless face fails**, whatever its identity score.
- **Motion accuracy:** pose compared with the driver, each skeleton centred on the hips and scaled by torso length.
- **Clothing:** torso colour against the photo, and its frame-to-frame jitter.
- **Body proportions:** shoulder/torso and hip/shoulder ratios against the no-LoRA run.
  - The checks discriminate: the older Copy Motion engine fails the body-proportion check.

**Close-framed test** (`make_closeup.py`, built and checked):
- The same dance clip and photo, cropped to head and shoulders, following her head.
- Faces measure **about 175 px (driver) and 158 px (photo)**, against 70–135 px in the full-body clip.
- In this framing, expression is readable in 59 of 64 frames.
- Assets are in `stageA_review/wa2_eval_assets/`.

**Gap:** this dance clip has **no smiles** (the mouth opens briefly, the smile score stays at 0). It can't test smiling or laughing. That needs one short, close-framed clip of a real person talking or laughing (see the questions below).

**Renders** (one pod, after training):

| Clip | Runs |
|---|---|
| Main | No LoRA (re-render); LoRA step 300 at 1.0; step 300 at 0.7; step 200 at 1.0 (overfit check) |
| Close-up | No LoRA; best LoRA |
| Expressive clip (if provided) | No LoRA; best LoRA |

The face-restored 0.665 frames are reused from disk, since the scorer reproduces them exactly.

**GO (all four must hold):**
1. LoRA alone is at least **+0.10** over no-LoRA on the main clip, and at least 0.67 at best strength.
2. The close-up also improves.
3. Every body/motion/clothing/flicker/liveliness check passes.
4. Your visual review says she is recognisable through the turns and expressions.

**PARTIAL:** +0.05 to +0.10, or mixed visuals. **NO-GO:** under +0.05, or any frozen face or broken motion.

## 6. Cost estimate (A40/A6000 Secure, about $0.59/hr; final cap after your decision)
| Stage | Time |
|---|---|
| Pod setup, downloads (about 70 GB), dataset build, latent caching | about 30 min |
| Training: about 240 still steps × 19 s + 60 clip steps × 43 s (fewer clips if all 8 pairs are approved) | about 1.7–2.0 h |
| LoRA conversion + ComfyUI key check | about 5 min |
| Evaluation renders (6–8 × about 3.5 min) | about 35 min |
| Buffer | about 15 min |
| **Total** | **about 3.2–3.4 h ≈ $1.90–2.05** |

- **Provisional caps:** GPU watchdog **$2.60** (the on-pod deadline of 240 min ≈ $2.36 sits below it).
- Plus the pilot volume, about $1.40 for the first month. Delete it once you've taken the LoRA.
