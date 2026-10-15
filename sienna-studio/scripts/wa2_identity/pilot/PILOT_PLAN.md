# WA2 identity-LoRA pilot (300 steps): final plan, awaiting two decisions

**Status:** code complete, all 20 local tests pass. Nothing launched, created or spent. Dataset v2 is built only by `freeze_v2.py` from your confirmations.

**Still needed from you:**
1. Your likeness decision on R1-17, P3, P12, P41, P9 and P1.
2. Separate authorisation to train.

## 1. Dataset
- **Frozen v1** (checksummed, read-only; you hold a 3-part backup):
  - 24 strong training pairs
  - 6 held-out validation photos: P5, P6, P8, P42, O-006, O-017. Never trained on, never used as a reference.
- **Candidates**, separate and not included until you confirm likeness: R1-17, P3, P12, P41, P9, P1.
- **Provisionally excluded:** O-023, O-012.
- **After your decision:** approved candidates go into a new frozen **v2**. v1 is never edited.
- **Composition** (`make_pilot.py`, 100 rows × 3 epochs = 300 steps):

  | Option | Pairs | Still rows | Clip rows |
  |---|---|---|---|
  | 24 only | 24 | 80 | 20 |
  | + your priority 4 | 28 | 80 | 20 |
  | + all 6 | 30 | 88 | 12 |

## 2. Training configuration (unchanged from the passed smoke test, plus tilt balancing)
- **Model and trainer:** official bf16 Wan Animate 2, DiffSynth at commit 4a2d8af.
- **LoRA:** rank 32 on `self_attn.q/k/v`, LR 1e-4, 528×768, checkpoints at steps 100, 200 and 300.
- **Loss:** head-only loss mask, reference slot excluded, one constant prompt. Drivers are other women (identity ≤ 0.35).
- **Selfie tilt:** the 80 still rows split 33 usual lean / 23 level / 24 opposite lean, from in-plane rotation only. No mirroring, and reflected borders are never scored.

## 3. GPU requirements
- **GPU:** RTX A40 or RTX A6000, 48 GB VRAM. This is where the bf16 smoke test ran without fp8.
- **Pod:** Secure Cloud, at least 48 GB system RAM, 150 GB container disk, same datacenter as the pilot volume.
- **Rate:** about $0.59/hr, measured on earlier pilot pods.
- **No other GPU is allowed.** A slower or pricier card would break the cost estimate.

## 4. Duration and cost
| Stage | Minutes |
|---|---|
| Pod boot + 100 MB transfer gate | 7 |
| Trainer install + model downloads (~65 GB, parallel with dataset build) | 15 |
| Latent caching (100 samples) | 5 |
| Training (≈19 s per still step, ≈43 s per clip step, measured on A40) | 109–119 |
| LoRA conversion + ComfyUI key check | 3 |
| Evaluation renders: 6 × about 3.5 min + model load | 26 |
| Buffer | 10 |
| **Total** | **about 175–185 min ≈ $1.75–1.82** |

- **Temporary volume:** 20 GB at $0.07 per GB-month, billed hourly, so about **$0.01** for the few hours it exists.
- **Final absolute cap: $2.40 across all GPUs and storage.**
  - `pilot_guard.py` keeps one ledger.
  - Each pod's own self-delete deadline is set from the budget left: about 239 min for the first pod. A second pod is refused if the budget can't cover it.
- **Expected total ≈ $1.83.**
- **Separately, later:** the talking/laughing test, about $0.25, needs your clip and its own approval.

## 5. Checkpoint backup procedure
1. **Before any spend-heavy step:** the pod writes a 100 MB test file. This session must pull it and verify its SHA-256, otherwise the pod deletes itself (tested). The pod also refuses to start if its self-delete deadline can't be armed (tested).
2. **Every saved checkpoint (steps 100, 200, 300)** is copied once complete, converted to ComfyUI keys and checksummed. It then goes to:
   - **the temporary pilot volume** `sienna-wa2-pilot`, mounted at `/pilotvol`. It is never `/workspace` and never production; the production volume is refused by ID and by name (tested).
   - **this session**, pulled within about a minute and verified against the pod's checksums. Interrupted downloads resume and corrupt files are rejected and re-fetched (tested).
3. **The final LoRA** is split into parts under 30 MB (reassembly checked before sending, tested) and **sent to you**, so a copy exists outside the cloud.
4. **Volume deletion:** only after every local copy re-verifies its checksum (tested). The guard then confirms the volume is gone from your account listing, which stops charges. I also schedule one check-in a few hours later to re-confirm it's gone.
5. **Any failure on the pod** (bad dataset, failed transfer gate, any error) deletes the pod at once (tested).

## 6. Comparison and evaluation (`eval_graphs.py`, `eval_pilot.py`)
**Same inputs everywhere:**
- Copy Motion's exact graph, photo and uploaded driving clip
- Seed 2202, 528×768, 6 LCM steps, lightx2v

The LoRA graphs differ from the baseline only by the inserted LoRA node; the close-up graphs also change the input files. Tests prove nothing else moves.

| Run | What |
|---|---|
| No-LoRA WA2 | Re-rendered on the same pod (previously 0.395) |
| Identity LoRA | Step 300 at 1.0 and 0.7; step 200 at 1.0 (overfit check) |
| Best previous face-restored | Stored frames from the same graph, scored from disk (reproduces 0.665 exactly) |
| Close-framed | No-LoRA vs best LoRA on the head-and-shoulders crop (faces about 175 px) |

**Your seven priorities and how each is measured:**

| # | Priority | Measured by |
|---|---|---|
| 1 | Face similarity during head turns | Identity split by angle: frontal / 15–35° / over 35° / unreadable. Unreadable frames go on a strip for your review |
| 2 | Recognisable in close-up | The close-framed runs, plus similarity against the 6 held-out photos |
| 3 | Natural mouth movement and expressions | Mouth/smile motion against no-LoRA, and correlation with the driver's mouth. A frozen face fails. Talking and laughing need your clip |
| 4 | Flicker and identity changes between frames | Pixel flicker, plus frame-to-frame face-embedding stability |
| 5 | Dance accuracy | Normalised body pose against the driver |
| 6 | Body proportions and clothing | Shoulder/torso and hip/shoulder ratios, and torso colour against the photo |
| 7 | Memorising training poses or appearances | Head pose following the driver (turn error, drift towards her selfie tilt); nearest training photo per frame; whether one photo dominates |

**Check on the stored runs:** no-LoRA vs face-restored passes all 9 checks; the restore copied no training photo.

**Limitation:** the dancer's head pose is readable in only 4 full-body frames, so turn-following and tilt drift are judged on the close-up runs.

**Deliverables to you:**
- Every rendered video (no-LoRA, LoRA variants, close-ups).
- A side-by-side comparison video that includes the face-restored result.
- Face close-up strips.
- The full report.
- A GO / NO-GO recommendation.

## 7. GO / PARTIAL / NO-GO (fixed in advance; scores alone never decide)
**GO only if all of these hold:**
1. Main clip, best LoRA: median ≥ no-LoRA + **0.10**, and ≥ **0.67** (matches or beats the face-restored result without restoration).
2. The turned (15–35°) bin improves by ≥ 0.10, not only frontal frames.
3. Close-framed: LoRA ≥ no-LoRA + 0.10.
4. Similarity against the held-out photos improves by ≥ 0.08 (it learned her, not its training photos).
5. Every behaviour check passes:
   - not frozen (liveliness ≥ 0.8 of no-LoRA)
   - flicker within +5%
   - frame-to-frame identity no less stable
   - motion error +0.05 at most
   - clothing ΔE +5 at most
   - body ratios within 8%
   - head turns still follow the driver (+5° at most)
   - no drift to her selfie tilt (within 5°)
   - no training photo copied or dominating
6. Your visual review of the videos says she is recognisable through the turns, and the motion looks natural.

**PARTIAL:** gain of +0.05 to +0.10, or 1 holds but one of 2–4 is missing, or the visuals are mixed. I report and propose options, with no automatic next spend.

**NO-GO:** gain under +0.05, or any frozen face, broken motion, changed body or memorisation.

**Expressions are not proven by this pilot.** The dance clip has no smiles. Talking and laughing stay open until your authorised clip passes `prepare_talking_clip.py` and the talk test runs.

**Stops during training:**
- Loss NaN or diverging.
- Step time over 1.5× the estimate after 20 steps (would breach the cap).
- The step-100 checkpoint fails transfer verification.
- The ComfyUI key check fails, or the LoRA has no visible effect.
