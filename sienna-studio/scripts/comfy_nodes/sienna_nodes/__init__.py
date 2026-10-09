"""
Sienna Studio custom ComfyUI nodes (installed by scripts/comfyui-bootstrap.sh).

  SiennaPoseRetarget     POSE_KEYPOINT → OpenPose image with Sienna's proportions (angles kept)
  SiennaGarmentIsolate   photo + garment/person/face masks → garment-only crop for the outfit adapter
  SiennaChinCrop         clothing photo + face-box mask → crop below the chin (Edit Outfit reference)
  SiennaGarmentOnly      clothing photo → garment pixels on grey, model's skin/figure removed (falls back to chin crop)
  SiennaBodySheet        approved Sienna body references stitched into one image
  SiennaBodyMeasure      image + DWPose keypoints + person mask → body proportions (JSON)
  SiennaBodyCheck        source / result / reference measurements → body-consistency report (JSON)

The math lives in sienna_pose.py / sienna_garment.py / sienna_crop.py / sienna_body.py (no ComfyUI imports; unit-tested).
"""

import json

import numpy as np
import torch

from .sienna_body import SCENE_CHANGED, body_sheet, compare, garment_only, keypoints_from_pose, measure_body, scale_points, scene_change
from .sienna_crop import chin_crop
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


class SiennaChinCrop:
    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {
                "image": ("IMAGE",),
                "margin": ("FLOAT", {"default": 0.08, "min": 0.0, "max": 1.0, "step": 0.01}),
                "min_keep": ("FLOAT", {"default": 0.35, "min": 0.0, "max": 1.0, "step": 0.01}),
            },
            "optional": {"face_mask": ("MASK",)},
        }

    RETURN_TYPES = ("IMAGE", "STRING")
    RETURN_NAMES = ("image", "info")
    FUNCTION = "run"
    OUTPUT_NODE = True
    CATEGORY = "sienna"

    def run(self, image, margin, min_keep, face_mask=None):
        img = image[0].detach().cpu().numpy().astype(np.float32)
        out, info = chin_crop(img, _mask_np(face_mask, 0, img.shape[:2]), margin=margin, min_keep=min_keep)
        text = json.dumps(info)
        return {"ui": {"text": [text]}, "result": (torch.from_numpy(np.ascontiguousarray(out))[None, ...], text)}


def _kp_for(pose_keypoint, shape):
    """DWPose points scaled to this image's pixels."""
    kp, cw, ch = keypoints_from_pose(pose_keypoint) if pose_keypoint else ([], 0, 0)
    h, w = shape[:2]
    return scale_points(kp, w / cw, h / ch) if kp and cw and ch else kp


class SiennaGarmentOnly:
    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {
                "image": ("IMAGE",),
                "person_mask": ("MASK",),
                "expect": ("STRING", {"default": "upper,lower"}),
                "drop_feet": ("BOOLEAN", {"default": False}),
            },
            "optional": {"face_mask": ("MASK",), "pose_keypoint": ("POSE_KEYPOINT",)},
        }

    RETURN_TYPES = ("IMAGE", "STRING")
    RETURN_NAMES = ("image", "info")
    FUNCTION = "run"
    OUTPUT_NODE = True
    CATEGORY = "sienna"

    def run(self, image, person_mask, expect, drop_feet=False, face_mask=None, pose_keypoint=None):
        img = image[0].detach().cpu().numpy().astype(np.float32)
        shape = img.shape[:2]
        pieces = [p.strip() for p in expect.split(",") if p.strip() in ("upper", "lower")]
        out, info = garment_only(img, _mask_np(person_mask, 0, shape), _mask_np(face_mask, 0, shape), _kp_for(pose_keypoint, shape), pieces, drop_feet=drop_feet)
        text = json.dumps(info)
        return {"ui": {"text": [text]}, "result": (torch.from_numpy(np.ascontiguousarray(out))[None, ...], text)}


class SiennaBodySheet:
    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {"image1": ("IMAGE",), "height": ("INT", {"default": 768, "min": 256, "max": 2048})},
            "optional": {"image2": ("IMAGE",), "image3": ("IMAGE",), "image4": ("IMAGE",)},
        }

    RETURN_TYPES = ("IMAGE",)
    FUNCTION = "run"
    CATEGORY = "sienna"

    def run(self, image1, height, image2=None, image3=None, image4=None):
        ims = [i[0].detach().cpu().numpy().astype(np.float32) for i in (image1, image2, image3, image4) if i is not None]
        return (torch.from_numpy(np.ascontiguousarray(body_sheet(ims, height)))[None, ...],)


class SiennaBodyMeasure:
    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {"image": ("IMAGE",), "pose_keypoint": ("POSE_KEYPOINT",), "person_mask": ("MASK",)},
            "optional": {"face_mask": ("MASK",)},
        }

    RETURN_TYPES = ("STRING",)
    RETURN_NAMES = ("measurements",)
    FUNCTION = "run"
    CATEGORY = "sienna"

    def run(self, image, pose_keypoint, person_mask, face_mask=None):
        img = image[0].detach().cpu().numpy().astype(np.float32)
        shape = img.shape[:2]
        m = measure_body(img, _kp_for(pose_keypoint, shape), _mask_np(person_mask, 0, shape), _mask_np(face_mask, 0, shape))
        return (json.dumps(m, default=lambda o: None),)


class SiennaBodyCheck:
    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {
                "source": ("STRING", {"forceInput": True}),
                "result": ("STRING", {"forceInput": True}),
                "footwear_changed": ("BOOLEAN", {"default": False}),
                "legs_hidden": ("BOOLEAN", {"default": False}),
            },
            "optional": {
                "source_image": ("IMAGE",),
                "result_image": ("IMAGE",),
                **{f"ref{i}": ("STRING", {"forceInput": True}) for i in range(1, 7)},
            },
        }

    RETURN_TYPES = ("STRING",)
    RETURN_NAMES = ("report",)
    FUNCTION = "run"
    OUTPUT_NODE = True
    CATEGORY = "sienna"

    def run(self, source, result, footwear_changed=False, legs_hidden=False, source_image=None, result_image=None, **refs):
        try:
            report = compare(json.loads(source), json.loads(result), [json.loads(v) for v in refs.values() if v],
                             footwear_changed=footwear_changed, legs_hidden=legs_hidden)
        except (ValueError, TypeError, KeyError) as e:
            report = {"status": "insufficient", "flags": [], "checked": [], "skipped": [{"part": "all", "why": f"measurement failed: {e}"}]}
        if source_image is not None and result_image is not None:
            diff = scene_change(source_image[0].detach().cpu().numpy(), result_image[0].detach().cpu().numpy())
            report["scene"] = {"diff": diff, "changed": diff > SCENE_CHANGED}
        text = json.dumps(report)
        return {"ui": {"text": [text]}, "result": (text,)}


NODE_CLASS_MAPPINGS = {
    "SiennaPoseRetarget": SiennaPoseRetarget,
    "SiennaGarmentIsolate": SiennaGarmentIsolate,
    "SiennaChinCrop": SiennaChinCrop,
    "SiennaGarmentOnly": SiennaGarmentOnly,
    "SiennaBodySheet": SiennaBodySheet,
    "SiennaBodyMeasure": SiennaBodyMeasure,
    "SiennaBodyCheck": SiennaBodyCheck,
}
NODE_DISPLAY_NAME_MAPPINGS = {
    "SiennaPoseRetarget": "Sienna Pose Retarget",
    "SiennaGarmentIsolate": "Sienna Garment Isolate",
    "SiennaChinCrop": "Sienna Chin Crop",
    "SiennaGarmentOnly": "Sienna Garment Only",
    "SiennaBodySheet": "Sienna Body Sheet",
    "SiennaBodyMeasure": "Sienna Body Measure",
    "SiennaBodyCheck": "Sienna Body Check",
}
