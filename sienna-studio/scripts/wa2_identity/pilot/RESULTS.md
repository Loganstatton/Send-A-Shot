# WA2 native identity-LoRA pilot: results (2026-10-15)

## Recommendation: NO-GO for full training with this recipe
- The LoRA makes Sienna somewhat more consistent in calm, near-frontal frames.
- It does **not** keep her recognisable through natural motion:
  - The close-up gain is within run-to-run noise.
  - The main-clip gain misses the +0.10 bar and stays far below the previous face-restored result (0.665).
  - Fast-motion frames get worse.
  - On the dance clip, part of the gain comes from pulling her face toward the frontal poses it was trained on.
- On the pre-set rules, the main-clip gain (+0.087) falls in the PARTIAL band. The decisive close-up and held-out checks don't support it, so my overall call is NO-GO.

## What ran
- **Training:** 300 steps on frozen dataset v2 (28 pairs).
  - Head-only loss; 100 rows × 3 epochs.
  - One A40, 21:07–21:59 UTC, about 10 s per step.
  - Exit 0, no NaN.
- **Checkpoints:** steps 100, 200 and 300, in both formats (6 files).
  - Each was SHA-256 verified on the pod, on the temporary volume and in the session.
  - All 3 ComfyUI-format LoRAs were sent to the owner in verified parts.
- **ComfyUI key check:** 0 "lora key not loaded" lines on Copy Motion's int8 Wan Animate 2. The LoRA loads fully.
- **Evaluation:**
  - Copy Motion's exact graph, photo, uploaded driving clip, seed 2202, 528×768, 6 steps.
  - The LoRA graphs differ only by the LoRA node; the close-up graphs also change the input files.
  - No-LoRA was re-rendered on the same pod.

## Main dance clip (app face check, faces ≥ 64 px)
| Run | Median | p10 | vs held-out photos | Frontal / 15–35° frames | 15–35° median | Unreadable-frame median |
|---|---|---|---|---|---|---|
| No-LoRA (re-render) | 0.413 | 0.183 | 0.467 | 13 / 32 | 0.463 | 0.349 |
| No-LoRA (original render) | 0.395 | 0.240 | 0.420 | 16 / 35 | 0.437 | 0.256 |
| Face-restored (previous best) | **0.665** | 0.373 | 0.695 | 25 / 29 | 0.671 | 0.652 |
| LoRA step 300 @1.0 | 0.500 | 0.020 | 0.509 | **40 / 7** | 0.572 | 0.057 |
| LoRA step 300 @0.7 | 0.462 | 0.128 | 0.474 | 22 / 27 | 0.500 | 0.110 |
| LoRA step 200 @1.0 | 0.482 | 0.026 | 0.488 | 18 / 29 | 0.530 | 0.012 |

## Close-framed test (face about 183 px; same clip and photo, head-and-shoulders crop)
| Run | Median | p10 | vs held-out | Open-mouth frames | 15–35° | Head yaw error | Tilt bias | Flicker |
|---|---|---|---|---|---|---|---|---|
| No-LoRA | 0.597 | 0.391 | 0.607 | 0.418 | 0.619 | 2.4° | −1.1° | 20.8 |
| LoRA step 300 @1.0 | 0.621 | 0.405 | 0.620 | 0.482 | 0.622 | 2.6° | −0.8° | 22.3 (+7%) |

The close-up gain of **+0.024** is about the size of the difference between two no-LoRA renders of identical inputs (0.018).

## Your seven priorities
1. **Head turns:**
   - Main clip, step 300: the 15–35° bin rose (+0.11), but only 7 frames stayed turned (32 without the LoRA). The LoRA pulled faces frontal, which also flatters the score.
   - Step 200: +0.067 on 29 turned frames.
   - Close-up: no gain on turns (+0.003), and head pose followed the driver.
2. **Close-up recognisability:** +0.024, within noise. Visually: slightly more consistent features and freckles, but the same person as without the LoRA.
3. **Mouth and expressions:**
   - Close-up liveliness is 0.93 of no-LoRA, so not frozen.
   - Open-mouth frames improved +0.064.
   - The dance clip has no smiles. Talking and laughing remain untested (needs your clip).
   - Full-body liveliness is unreliable: two identical no-LoRA renders differ 2×.
4. **Flicker and identity stability:**
   - Main clip: flicker slightly better (29.7 vs 32.6), frame-to-frame identity equal (0.79 vs 0.77).
   - Close-up: flicker 7% worse.
5. **Dance accuracy:** body-pose error unchanged or slightly better (0.164 vs 0.189 torso lengths). Fast-motion faces are worse: smeared and warped, p10 0.02.
6. **Body and clothing:**
   - Main-clip body ratios within 2.5% (step 300 @1.0).
   - Clothing colour unchanged (ΔE 6.4 vs 6.3).
   - The close-up body ratio isn't measurable (hips out of frame).
7. **Memorisation:**
   - No training photo is copied: crop match unchanged.
   - Faces drift toward one training photo (O-016 nearest in 46% → 61% of frames) and toward frontal poses on the dance clip. That is a mild memorisation trend.

## Spending (strict cap $2.40)
- **RunPod balance:** $14.49 → $13.37 = **$1.12**. That includes about $0.02 of the production volume's normal storage, so the pilot cost about $1.10.
- **Conservative ledger** (rounded up): A40 #1 16 min $0.16, A40 #2 14 min $0.13, A40 #3 95 min $0.93, temporary volume 2.2 h ≈ $0.004; total $1.23.
- **Failed setup attempts (#1, #2)** were my errors: an un-uploaded measurements file, then a dropped `librosa` package. Each pod deleted itself within 2 minutes as designed. Both fixes are in the script.
- **Cleanup:** the temporary volume `mfqwqf59r4` was deleted after verified backups and confirmed absent. No pods are running. The production volume and pods are untouched.

## What this means
- Training on Wan Animate 2's own weights does reach the identity path: the LoRA loads, changes faces and keeps the body.
- But with 28 mostly frontal, mostly still pairs, it learns "a more frontal, more consistent Sienna" rather than "Sienna at every angle and in motion". The face is lost in fast motion either way.
- The previous face-restore approach remains clearly better on identity (0.665). Its known weakness is flattening expressions.
- I'd not spend on full training of this recipe. Any next step should be proposed separately for approval.
