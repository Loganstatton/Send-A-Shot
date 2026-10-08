# Phase 1 quality test — results (dev branch `phase1-quality`, not deployed)

GPU session: RTX A4500 (Runpod community, $0.19/hr), 56 min, **≈ $0.18** (cap $0.30). Pod stopped afterwards.

## Method
* 4 synthetic references (base RealVisXL, no Sienna LoRA, fictional adults, 768×1344 so the pose-crop issue occurs):
  loose knit + wide-leg trousers · cropped tank + pleated A-line mini skirt · halter tie-side bikini · tucked tee + belted jeans.
* Each reference is used as both the Outfit and the Pose photo. Same outfit text (whole-person analysis), pose text, scene,
  framing, seeds (101, 202), SFW mode, Sienna Lock, v2 LoRA @ 1.0, FaceDetailer 0.3, outfit 0.7, pose 0.65.
* One change per condition vs. the baseline C0; 8 images each, 64 total.
* Measurements: DWPose on every output. Bone-direction error vs. the reference; composition error = mean distance of
  body joints from the reference's own layout (reference padded to the output shape), as a fraction of the frame;
  proportion drift = mean relative difference from Sienna's measured proportions; face texture = Laplacian std on the
  face; clothing recall = share of the reference's outfit attributes found when the output is described by the same
  analyzer (only for conditions that change the clothing input).

## Numbers

| | Condition | bone angle ° | composition | proportion drift | face texture | clothing recall |
|---|---|---|---|---|---|---|
| C0 | Baseline (current production) | 2.4 | 0.047 | 0.112 | 14.7 | 0.86 |
| C1 | Pose photo padded (not cropped) | 2.5 | **0.012** | 0.120 | 12.6 | — |
| C2 | Pad + retarget to Sienna | 2.7 | 0.024 | **0.094** | 13.3 | — |
| C3 | Garment-only isolation | 2.1 | 0.048 | 0.104 | 15.0 | 0.80 |
| C4 | Refinement pass (1.5×, 0.3, LoRA 0.7) | 2.6 | 0.045 | 0.116 | 15.1 | 0.80 |
| C5 | Prompt cleanup | 2.5 | 0.047 | 0.109 | 14.6 | — |
| C6 | v3.3-3750 instead of v2 | 2.8 | 0.045 | 0.110 | 15.9 | — |
| C7 | All on | 2.6 | 0.023 | 0.091 | 15.0 | 0.81 |

Bone-angle errors are 2–3° everywhere: on clear references the pose ControlNet already reproduces limb angles; the
differences between conditions are within noise. Clothing recall differences are ±1 attribute over 8 images.

## Verdicts
* **Pose padding — measurable improvement.** Composition error 4× lower; whole figure, head room and feet framed as in
  the reference. Trade-off: when the reference has empty space around the person, Sienna is smaller in the frame (less
  face detail; FaceDetailer compensates for small faces).
* **Pose retargeting — inconclusive; keep off.** No anatomical distortion, proportion drift −22% vs. pad alone, but
  composition error doubles (feet move) and most bones hit the ±20% cap in opposite directions between references —
  the proportion data (≈5 distinct v2 images, legs from one) and 2D foreshortening are the limit, not the method.
  Needs a deliberate measurement set: 6–10 varied full-body v2 images with visible knees/ankles.
* **Garment-only isolation — worse; keep the whole-person method.** Florence-2 segmentation missed pieces (bikini
  bottoms; the belt), left a thin skin halo, and the zoomed single-garment crop pushed its colour into skin and scene
  (red/orange cast on the bikini, brown instead of black boots, stray fabric).
* **Refinement pass — measurable detail improvement, optional.** Composition/clothing/identity unchanged; sharper eyes,
  lashes, hair and fabric at 1.5× resolution, no halos or exaggerated pores. Skin stays fairly smooth — it is not a
  fix for the LoRA's learned smoothness. ≈ +50% render time (~30 s vs ~20 s on an A4500).
* **Prompt cleanup — no visible or measurable effect** (and no age drift). Harmless; not worth a production change.
* **v3.3 vs v2 —** v3.3 shifts the face slightly (narrower, more freckles); v2 is more consistent across references.
  v2 stays the baseline.

## Bug found by real data
DWPose reports keypoints in canvas pixels, not 0..1, so the framing check against the pose photo never fired on a
real server (mock data was normalized). Fixed in `lib/pose-check.ts` with a regression test.

## Production rollout

Shipped: pose padding (default "Keep the whole pose photo"; "Crop" reproduces the previous graph exactly),
the optional Refinement pass (off by default), and framing conflict detection with one-tap fixes.

Pose retargeting, garment-only outfit isolation and prompt cleanup stay in the code but are hidden in the
UI and ignored by the server unless the environment variable `SIENNA_EXPERIMENTAL=true` is set.
