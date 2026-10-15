"""Identity-weighted flow-matching loss for Wan-Animate-2 LoRA training (plugs into DiffSynth's train.py).

Differences from DiffSynth's FlowMatchSFTLoss:
  1. The reference-image slot (latent frame 0) is excluded. The model sees that image clean in its conditioning, so
     its loss is trivial to drive down and, with single-frame samples, would be half of the signal.
  2. Pixels inside the target's head box get extra weight (FACE_WEIGHT), so the gradient concentrates on identity
     while the rest of the frame still teaches body, outfit and background from the reference.
The face box comes from the dataset metadata as "x0,y0,x1,y1" in 0-1 image coordinates (key `face_box`).

Head-only mode (cross-outfit pairs): when a sample has `loss_mask` (path to a PNG, white = head + hair, from
pair_qa.head_mask), only that region is scored. Used when the reference photo shows Sienna in a different outfit and
place than the target, which is the case for almost all approved photos: outfit and background are then not
supervised at all, instead of being taught wrongly.
"""
import numpy as np
try:
    import torch
except ImportError:  # face_bounds stays importable for local tests without torch
    torch = None

FACE_WEIGHT = 4.0      # head region weight relative to 1.0 elsewhere
FACE_PAD = 0.25        # grow the face box by 25% each side (hairline, jaw, ears)


def face_bounds(face_box, lat_h, lat_w, pad=FACE_PAD):
    """Latent-grid rows/cols (r0, r1, c0, c1) covered by the padded face box, or None. Pure Python (tested)."""
    if not face_box:
        return None
    x0, y0, x1, y1 = [float(v) for v in str(face_box).split(',')]
    if not (0 <= x0 < x1 <= 1 and 0 <= y0 < y1 <= 1):
        raise ValueError(f'face_box must be x0,y0,x1,y1 in 0-1: {face_box}')
    bw, bh = x1 - x0, y1 - y0
    x0, x1 = max(0.0, x0 - pad * bw), min(1.0, x1 + pad * bw)
    y0, y1 = max(0.0, y0 - pad * bh), min(1.0, y1 + pad * bh)
    c0, r0 = int(x0 * lat_w), int(y0 * lat_h)
    return r0, max(r0 + 1, int(round(y1 * lat_h))), c0, max(c0 + 1, int(round(x1 * lat_w)))


def mask_to_latent(mask, lat_h, lat_w):
    """Fraction of head pixels in each latent cell (area average of a 0/255 or 0/1 mask). Pure numpy (tested)."""
    import cv2
    m = (np.asarray(mask, np.float32) > 0.5 * (255 if np.asarray(mask).max() > 1 else 1)).astype(np.float32)
    return cv2.resize(m, (lat_w, lat_h), interpolation=cv2.INTER_AREA)


def mask_weight_map(mask_path, lat_h, lat_w, device, dtype):
    import cv2
    w = torch.as_tensor(mask_to_latent(cv2.imread(mask_path, cv2.IMREAD_GRAYSCALE), lat_h, lat_w), device=device, dtype=dtype)
    if float(w.sum()) <= 0:
        raise ValueError(f'empty loss mask: {mask_path}')
    return w / w.mean()


def face_weight_map(face_box, lat_h, lat_w, device, dtype, weight=FACE_WEIGHT, pad=FACE_PAD):
    w = torch.ones((lat_h, lat_w), device=device, dtype=dtype)
    b = face_bounds(face_box, lat_h, lat_w, pad)
    if b is None:
        return w
    r0, r1, c0, c1 = b
    w[r0:r1, c0:c1] = weight
    return w / w.mean()  # keep the overall loss scale comparable to the unweighted loss


def FlowMatchIdentityLoss(pipe, **inputs):
    lo = int(inputs.get('min_timestep_boundary', 0) * len(pipe.scheduler.timesteps))
    hi = int(inputs.get('max_timestep_boundary', 1) * len(pipe.scheduler.timesteps))
    timestep_id = torch.randint(lo, hi, (1,))
    timestep = pipe.scheduler.timesteps[timestep_id].to(dtype=pipe.torch_dtype, device=pipe.device)
    noise = torch.randn_like(inputs['input_latents'])
    inputs['latents'] = pipe.scheduler.add_noise(inputs['input_latents'], noise, timestep)
    target = pipe.scheduler.training_target(inputs['input_latents'], noise, timestep)
    models = {name: getattr(pipe, name) for name in pipe.in_iteration_models}
    pred = pipe.model_fn(**models, **inputs, timestep=timestep)
    pred, target = pred[:, :, 1:].float(), target[:, :, 1:].float()          # drop the reference-image slot
    if inputs.get('loss_mask'):
        wmap = mask_weight_map(inputs['loss_mask'], pred.shape[-2], pred.shape[-1], pred.device, pred.dtype)
    else:
        wmap = face_weight_map(inputs.get('face_box'), pred.shape[-2], pred.shape[-1], pred.device, pred.dtype)
    loss = (((pred - target) ** 2) * wmap).mean()
    return loss * pipe.scheduler.training_weight(timestep)
