"""
Sienna close-up detail pass (24 Oct), a package of its own so installing it leaves sienna_nodes untouched.

  SiennaDetailRegion  image → close-up crop (enlarged), its redraw mask, region info (JSON)
  SiennaDetailPaste   photo + redrawn crop + region info → photo with the crop pasted back

Between them the app's graph runs VAEEncode → SetLatentNoiseMask → KSampler (with the detail LoRA) → VAEDecode.
Logic in sienna_detail.py (no ComfyUI imports, unit-tested).
"""

import json
import os
import sys

import numpy as np

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from sienna_detail import DETECT_THRESHOLD, cut, detector, detector_error, paste, plan  # noqa: E402


def _np(images, i=0):
    return np.clip(images[i].detach().cpu().numpy().astype(np.float32), 0, 1)


def _t(a):
    import torch

    return torch.from_numpy(np.ascontiguousarray(a, dtype=np.float32))[None, ...]


class SiennaDetailRegion:
    """Finds the exposed genital area (NudeNet) and cuts an enlarged close-up of it. Batches use the first photo."""

    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {
                "image": ("IMAGE",),
                "threshold": ("FLOAT", {"default": DETECT_THRESHOLD, "min": 0.05, "max": 0.95, "step": 0.05}),
                "size": ("INT", {"default": 1024, "min": 512, "max": 1536, "step": 64}),
            }
        }

    RETURN_TYPES = ("IMAGE", "MASK", "STRING")
    RETURN_NAMES = ("crop", "mask", "info")
    FUNCTION = "run"
    CATEGORY = "sienna"

    def run(self, image, threshold, size):
        import tempfile

        import cv2

        img = _np(image)
        det = detector()
        if det is None:
            info = {"found": False, "skipped": f"detector unavailable: {detector_error()}", "size": 64}
        else:
            fd, path = tempfile.mkstemp(suffix=".png")
            os.close(fd)
            try:
                cv2.imwrite(path, cv2.cvtColor((img * 255).astype(np.uint8), cv2.COLOR_RGB2BGR))
                info = plan(det.detect(path), img.shape[1], img.shape[0], size, threshold)
            finally:
                os.remove(path)
        crop, mask = cut(img, info)
        return (_t(crop), _t(mask), json.dumps(info))


class SiennaDetailPaste:
    """Pastes the redrawn close-up back into the photo (soft oval, colours matched); unchanged if nothing was found."""

    @classmethod
    def INPUT_TYPES(cls):
        return {"required": {"original": ("IMAGE",), "redrawn": ("IMAGE",), "info": ("STRING", {"forceInput": True})}}

    RETURN_TYPES = ("IMAGE", "STRING")
    RETURN_NAMES = ("image", "report")
    FUNCTION = "run"
    OUTPUT_NODE = True
    CATEGORY = "sienna"

    def run(self, original, redrawn, info):
        meta = json.loads(info)
        outs, report = [], {}
        for i in range(original.shape[0]):
            out, report = paste(_np(original, i), _np(redrawn, min(i, redrawn.shape[0] - 1)), meta)
            outs.append(out)
        import torch

        text = json.dumps(report)
        return {"ui": {"text": [text]}, "result": (torch.from_numpy(np.stack(outs).astype(np.float32)), text)}


NODE_CLASS_MAPPINGS = {"SiennaDetailRegion": SiennaDetailRegion, "SiennaDetailPaste": SiennaDetailPaste}
NODE_DISPLAY_NAME_MAPPINGS = {"SiennaDetailRegion": "Sienna Detail: close-up region", "SiennaDetailPaste": "Sienna Detail: paste back"}
