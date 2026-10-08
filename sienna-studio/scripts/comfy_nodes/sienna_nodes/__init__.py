"""
Sienna Studio custom ComfyUI nodes (installed by scripts/comfyui-bootstrap.sh).

  SiennaPoseRetarget     POSE_KEYPOINT → OpenPose image with Sienna's proportions (angles kept)
  SiennaGarmentIsolate   photo + garment/person/face masks → garment-only crop for the outfit adapter

The math lives in sienna_pose.py / sienna_garment.py (no ComfyUI imports; unit-tested).
"""

import json

import numpy as np
import torch

from .sienna_garment import garment_composite
from .sienna_pose import DEFAULT_PROPORTIONS, retarget_openpose


def _mask_np(mask, i, shape):
    if mask is None:
        return None
    m = mask[min(i, mask.shape[0] - 1)] if mask.dim() == 3 else mask
    return m.detach().cpu().numpy().astype(np.float32)


class SiennaPoseRetarget:
    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {
                "pose_keypoint": ("POSE_KEYPOINT",),
                "strength": ("FLOAT", {"default": 1.0, "min": 0.0, "max": 1.0, "step": 0.05}),
                "max_change": ("FLOAT", {"default": 0.2, "min": 0.0, "max": 0.5, "step": 0.01}),
                "proportions": ("STRING", {"default": json.dumps(DEFAULT_PROPORTIONS), "multiline": True}),
            }
        }

    RETURN_TYPES = ("IMAGE", "STRING")
    RETURN_NAMES = ("pose_image", "factors")
    FUNCTION = "run"
    OUTPUT_NODE = True
    CATEGORY = "sienna"

    def run(self, pose_keypoint, strength, max_change, proportions):
        try:
            target = {k: float(v) for k, v in json.loads(proportions or "{}").items()} or DEFAULT_PROPORTIONS
        except (ValueError, TypeError):
            target = DEFAULT_PROPORTIONS
        frames, dicts, factors = [], [], []
        for pose in pose_keypoint if isinstance(pose_keypoint, list) else [pose_keypoint]:
            canvas, new_pose, f = retarget_openpose(pose, target, strength, max_change)
            frames.append(torch.from_numpy(canvas.astype(np.float32) / 255.0))
            dicts.append(new_pose)
            factors.append(f)
        text = json.dumps(factors)
        return {
            "ui": {"openpose_json": [json.dumps(dicts)], "text": [text]},
            "result": (torch.stack(frames, 0), text),
        }


class SiennaGarmentIsolate:
    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {
                "image": ("IMAGE",),
                "garment_mask": ("MASK",),
                "person_mask": ("MASK",),
                "edge_px": ("INT", {"default": 6, "min": 0, "max": 64}),
                "silhouette": ("BOOLEAN", {"default": True}),
                "margin": ("FLOAT", {"default": 0.12, "min": 0.0, "max": 1.0, "step": 0.01}),
            },
            "optional": {"face_mask": ("MASK",)},
        }

    RETURN_TYPES = ("IMAGE", "STRING")
    RETURN_NAMES = ("image", "mode")
    FUNCTION = "run"
    OUTPUT_NODE = True
    CATEGORY = "sienna"

    def run(self, image, garment_mask, person_mask, edge_px, silhouette, margin, face_mask=None):
        img = image[0].detach().cpu().numpy().astype(np.float32)
        shape = img.shape[:2]
        out, mode = garment_composite(
            img,
            _mask_np(garment_mask, 0, shape),
            _mask_np(person_mask, 0, shape),
            _mask_np(face_mask, 0, shape),
            edge_px=edge_px,
            silhouette=silhouette,
            margin=margin,
        )
        return {"ui": {"text": [mode]}, "result": (torch.from_numpy(np.ascontiguousarray(out))[None, ...], mode)}


NODE_CLASS_MAPPINGS = {
    "SiennaPoseRetarget": SiennaPoseRetarget,
    "SiennaGarmentIsolate": SiennaGarmentIsolate,
}
NODE_DISPLAY_NAME_MAPPINGS = {
    "SiennaPoseRetarget": "Sienna Pose Retarget",
    "SiennaGarmentIsolate": "Sienna Garment Isolate",
}
