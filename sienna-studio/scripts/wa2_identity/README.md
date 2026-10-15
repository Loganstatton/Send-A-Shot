# Sienna identity LoRA trained on Wan Animate 2 itself (design + tooling)

Status: local tooling only. No GPU used, nothing trained, nothing deployed.

## Why this differs from the failed Wan2.1-T2V LoRA
The T2V LoRA learned Sienna on a text-to-video model, and almost none of it carried over to WA2 (+0.004 face score).
This trains on WA2's own weights, through WA2's own reference-image and driving-video inputs, so it trains the exact
path that loses her identity: WA2 reads the driving video as raw pixels and lets the dancer's face leak in.

## Verified locally (DiffSynth-Studio @4a2d8af, ComfyUI @b60ae8e)
- **Weights:** DiffSynth trains `Wan-AI/Wan2.2-Animate-2-14B` `wan_animate_2/wan_animate_2_bf16.safetensors`, the
  official checkpoint. Our Copy Motion uses Comfy-Org's int8 repack of it. The int8-vs-bf16 equality is
  checked on the GPU in the smoke test (a few tensors compared).
- **Conditioning and gradients:** in training, `model_fn_wananimate` calls `forward_origin`, which runs the
  driving-video stream (`forward_ref`) and the generation stream (`forward_gen`) in one graph. The LoRA on the shared
  `self_attn.q/k/v` therefore gets gradients from both streams. At inference the driver stream is cached once
  (`WanVideoUnit_Animate2RefKVCacheEmbedder`); in training it isn't (`if pipe.scheduler.training: return {}`).
- **Stills work:** DiffSynth loads `.png`/`.jpg` as one-frame videos. `num_frames=1` gives the reference slot plus one
  target latent frame, and the noise, mask and conditioning lengths agree. 9-frame clips work too.
- **Loss gap:** the stock `FlowMatchSFTLoss` also scores the reference-image slot, which is trivial to copy and would be
  half the signal for single frames. `face_loss.py` drops that slot and weights the head region ×4.
- **LoRA export:** DiffSynth saves `blocks.N.block.<module>.lora_A.weight`. ComfyUI's `WanAnimate2Block` uses
  `diffusion_model.blocks.N.<module>.lora_A.weight`; the official repo itself adds `.block` when loading.
  `convert_lora.py` maps between them. Tests confirm the output is the same key layout ComfyUI loaded with 0
  unloaded keys in our pilot.
- **Custom per-sample fields:** non-file metadata keys pass through to the loss, and the data_process cache keeps
  them (`remove_unnecessary_params` defaults to False), so `face_box` reaches the loss.

## Training example = REFERENCE + DRIVER -> TARGET
| Part | What it is | Teaches |
|---|---|---|
| Reference | approved Sienna image, same outfit and place as the target, different pose/expression | identity, outfit, body come from here |
| Driver | a different woman rendered from the target's own DWPose body + 68-point face keypoints (`driver_graph.py`), with different hair, clothes and place | pose and expression come from here; her face, clothes and background must be ignored |
| Target | approved Sienna image | ground truth for both |

Every image in a scene set (`set_plan.json`: 24 sets × 5 views, 4 of them non-explicit nude) is Sienna in one outfit.
Every ordered pair (ref ≠ target) inside a set is an example, so 120 approved images give 480 examples.
Video outputs are never used as targets.

**Why the loss teaches identity without freezing expressions:** the target's face is Sienna's but the driver's isn't,
so lowering the loss requires taking identity from the reference. The target's pose and mouth match the driver and
differ from the reference, so copying the reference's expression is penalised, more so inside the ×4 face region.
Clothed drivers paired with nude targets (sets N1–N4) penalise the clothing ghosts seen in Test B.

## Revised pairing (existing approved photos as targets)
- **Targets** are approved photos, unchanged (crop/resize only). No new Sienna faces.
- **References** are other approved photos. Almost none share an outfit, so the sample carries `loss_mask` (head + hair,
  `pair_qa.head_mask`) and `face_loss.py` scores only that region; outfit and background are not trained.
- **Drivers** are other women (existing base-model images), matched on head yaw/pitch/roll, shoulders or full-body
  landmarks and expression, then edited locally on the driver only (`driver_edit.py`): whole-image similarity alignment
  plus an identical paired crop, a mouth/cheek expression transfer (target minus a neutral Sienna photo in 3D, so her
  face shape cancels), and hair darkening when the colour is too close to hers.
- **Gates** (`pair_qa.py`): head pose, blendshapes (smile, jaw, blink), lip gap, body or shoulders, facing direction,
  driver identity at most 0.35, hair colour difference, and target identity at least 0.70 on the full-resolution photo
  (profiles and small faces by eye). Every pair is also reviewed visually: a warped open-mouth smile can pass the
  numbers and still be a grimace.
- **Local limits:** open-mouth smiles, smiles on turned heads and head pitch can't be made by warping. Those need
  LivePortrait retargeting of another woman's portrait on the GPU.

## Limits of training on stills
- No real Sienna video exists, and generated videos have the wrong face, so supervision is per frame. Each 9-frame
  pseudo-clip applies the same smooth camera move to driver and target, so every frame is still an approved image.
  It teaches identity stability under motion, not real body or face dynamics.
- WA2's motion behaviour comes from its original training. The LoRA is small (rank 32, attention q/k/v only, about
  1,500 steps) so it changes as little else as possible. Evaluation measures whether motion, mouth movement and
  flicker survived; if they didn't, it's a NO-GO.
- Drivers are AI stills, not real dance footage. Real drivers have motion blur and other lighting.
- Animate Image (Wan2.2 I2V) is a different model; this LoRA does not apply there.

## Files
- `convert_lora.py`: DiffSynth to ComfyUI key conversion and checks
- `face_loss.py`: identity-weighted loss
- `train_identity.py`: train.py wrapper that swaps in the identity loss
- `train_wa2_identity.sh`: two-stage DiffSynth run
- `build_metadata.py`: dataset folder, metadata.json and pseudo-clips
- `driver_graph.py`: ComfyUI graph for drivers
- `pair_qa.py`: pair measurements and acceptance gates (MediaPipe, SFace; CPU)
- `driver_edit.py`: local driver edits (alignment, paired crop, expression transfer, hair recolour)
- `set_plan.json`: the 24 scene sets
- `tests/test_wa2_identity.py`: local tests (no GPU)
