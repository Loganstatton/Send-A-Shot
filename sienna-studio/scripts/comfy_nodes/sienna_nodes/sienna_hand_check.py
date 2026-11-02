"""Copy Photo hand check: does the copy still have every hand the photo shows?

The photo checker (Claude) passed a boat copy whose hand on her hip was a thumb-like lump (2 Nov); MediaPipe's hand
landmarker found 2 hands in the photo and 1 in that copy, and 2 in the good copies. So a copy with fewer
well-formed hands than its photo is counted as an anatomy failure and redone.

MediaPipe runs in a child process (it took ComfyUI down when run inside it, 1 Nov). No ComfyUI imports; the counting
rule is tested in tests/test_sienna_nodes.py.
"""
import glob
import json
import os
from typing import Dict, List, Optional

import numpy as np

MODEL_NAME = "hand_landmarker.task"
MIN_SCORE = 0.5
ISOLATED_TIMEOUT = 90


def model_path() -> Optional[str]:
    """$SIENNA_HAND_MODEL, ComfyUI/models/mediapipe/, or the copy bundled with comfyui_controlnet_aux."""
    here = os.path.dirname(os.path.abspath(__file__))
    cands = [os.environ.get("SIENNA_HAND_MODEL", ""), os.path.join(here, "..", "..", "models", "mediapipe", MODEL_NAME)]
    cands += glob.glob(os.path.join(here, "..", "comfyui_controlnet_aux", "**", MODEL_NAME), recursive=True)
    return next((os.path.abspath(c) for c in cands if c and os.path.isfile(c)), None)


def verdict(photo: List[float], copy: List[float], min_score: float = MIN_SCORE) -> Dict:
    """Hand scores found in the photo and in the copy -> {photo, copy, ok}: ok unless the copy has fewer confident
    hands than the photo (a hand lost or turned into a lump)."""
    p = sum(1 for s in photo if s >= min_score)
    c = sum(1 for s in copy if s >= min_score)
    return {"photo": p, "copy": c, "ok": c >= p}


def hand_scores(img: np.ndarray, path: str) -> List[float]:
    """Handedness scores of the hands MediaPipe finds in a float RGB 0..1 image (up to 4)."""
    import mediapipe as mp
    from mediapipe.tasks import python as mpt
    from mediapipe.tasks.python import vision

    rgb = np.ascontiguousarray(np.clip(np.round(img[..., :3] * 255), 0, 255).astype(np.uint8))
    with vision.HandLandmarker.create_from_options(vision.HandLandmarkerOptions(base_options=mpt.BaseOptions(model_asset_path=path), num_hands=4)) as det:
        res = det.detect(mp.Image(image_format=mp.ImageFormat.SRGB, data=rgb))
    return [float(h[0].score) for h in res.handedness]


def check_isolated(photo: np.ndarray, image: np.ndarray, timeout: float = ISOLATED_TIMEOUT) -> Dict:
    """verdict() with MediaPipe in a child process; on any failure {available: False, reason} (never a failed copy)."""
    import subprocess
    import sys
    import tempfile

    path = model_path()
    if not path:
        return {"available": False, "reason": "hand model not found"}
    with tempfile.TemporaryDirectory(prefix="sienna_hands_") as td:
        inp, res = os.path.join(td, "in.npz"), os.path.join(td, "out.json")
        np.savez(inp, photo=photo[..., :3].astype(np.float32), image=image[..., :3].astype(np.float32))
        try:
            p = subprocess.run([sys.executable, os.path.abspath(__file__), inp, res, path], capture_output=True, timeout=timeout)
        except subprocess.TimeoutExpired:
            return {"available": False, "reason": f"hand check timed out after {timeout:.0f}s"}
        if p.returncode != 0 or not os.path.exists(res):
            return {"available": False, "reason": f"hand check failed (exit {p.returncode})", "log": p.stderr.decode(errors="replace")[-300:]}
        return {"available": True, **json.load(open(res))}


def _main(inp: str, res: str, path: str) -> None:
    d = np.load(inp)
    out = verdict(hand_scores(d["photo"], path), hand_scores(d["image"], path))
    json.dump(out, open(res, "w"))


if __name__ == "__main__":
    import sys

    _main(sys.argv[1], sys.argv[2], sys.argv[3])
