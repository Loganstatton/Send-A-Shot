"""Photo Swap: the photo's own hair recoloured to Sienna's, instead of hair drawn by the image editor.

Drawn by Qwen-Image-Edit, her hair came out glossy and smooth, like a wig, however it was asked for (5 Nov, three
tries). The editor now keeps the photo's hair as it is, and here its colour is moved onto Sienna's: dark brown at the
roots, softly lighter brown towards the ends. Lightness is scaled about the hair's own median, so every strand,
highlight and flyaway of the real photo stays.

The hair is found by the MediaPipe multiclass segmenter (as the colour step), in a child process. No ComfyUI imports;
the colour move is unit-tested in tests/test_sienna_nodes.py.
"""
from typing import Dict, Optional, Tuple

import cv2
import numpy as np

# Sienna's hair in 8-bit OpenCV LAB: roots and ends (her reference photos: dark brown, softly lighter, cool brown ends)
ROOT_LAB = (48.0, 137.0, 141.0)
ENDS_LAB = (66.0, 139.0, 146.0)
TEXTURE = 0.75        # share of the photo hair's own light and shade kept (its strands and highlights)
HUE_SPREAD = 0.6      # share of its own colour variation kept
MIN_PIXELS = 400


def hair_weight(conf: np.ndarray) -> np.ndarray:
    """A firm, slightly softened hair mask from the segmenter's confidence (a soft one left the edges half blonde)."""
    m = np.clip((np.asarray(conf, np.float32) - 0.25) / 0.35, 0, 1)
    return cv2.GaussianBlur(m, (0, 0), 1.2)


def recolour(img: np.ndarray, weight: np.ndarray, strength: float = 1.0) -> Tuple[np.ndarray, Dict]:
    """`img` (float RGB 0..1) with the hair under `weight` moved onto Sienna's colour, darker at the top of the hair and
    lighter towards its ends."""
    out = img[..., :3].astype(np.float32)
    w = np.clip(weight, 0, 1) * float(strength)
    core = w > 0.5
    if core.sum() < MIN_PIXELS:
        return out, {"changed": False, "reason": f"no hair found ({int(core.sum())} pixels)"}
    lab = cv2.cvtColor(np.round(np.clip(out, 0, 1) * 255).astype(np.uint8), cv2.COLOR_RGB2LAB).astype(np.float32)
    med = np.median(lab[core], axis=0)
    ys = np.nonzero(core)[0]
    top, bottom = np.percentile(ys, 5), np.percentile(ys, 95)
    t = np.clip((np.arange(lab.shape[0], dtype=np.float32) - top) / max(1.0, bottom - top), 0, 1)[:, None]
    root, ends = np.asarray(ROOT_LAB, np.float32), np.asarray(ENDS_LAB, np.float32)
    target = [root[c] + (ends[c] - root[c]) * t for c in range(3)]
    new = np.empty_like(lab)
    new[..., 0] = target[0] + (lab[..., 0] - med[0]) * TEXTURE
    new[..., 1] = target[1] + (lab[..., 1] - med[1]) * HUE_SPREAD
    new[..., 2] = target[2] + (lab[..., 2] - med[2]) * HUE_SPREAD
    rgb = cv2.cvtColor(np.round(np.clip(new, 0, 255)).astype(np.uint8), cv2.COLOR_LAB2RGB).astype(np.float32) / 255
    w3 = w[..., None]
    return np.clip(out * (1 - w3) + rgb * w3, 0, 1).astype(np.float32), {
        "changed": True, "pixels": int(core.sum()), "from_lab": [round(float(x), 1) for x in med]}


ISOLATED_TIMEOUT = 120


def recolour_isolated(img: np.ndarray, strength: float = 1.0, timeout: float = ISOLATED_TIMEOUT) -> Tuple[np.ndarray, Dict]:
    """recolour() with the segmentation in a child process; on any failure the image comes back unchanged."""
    import json
    import os
    import subprocess
    import sys
    import tempfile

    out = img[..., :3].astype(np.float32)
    with tempfile.TemporaryDirectory(prefix="sienna_hair_") as td:
        inp, res = os.path.join(td, "in.npz"), os.path.join(td, "out.npz")
        np.savez(inp, image=out, strength=np.array(float(strength)))
        try:
            p = subprocess.run([sys.executable, os.path.abspath(__file__), inp, res], capture_output=True, timeout=timeout)
        except subprocess.TimeoutExpired:
            return out, {"changed": False, "error": f"hair step timed out after {timeout:.0f}s"}
        if p.returncode != 0 or not os.path.exists(res):
            return out, {"changed": False, "error": f"hair step failed (exit {p.returncode})", "log": p.stderr.decode(errors="replace")[-300:]}
        r = np.load(res, allow_pickle=False)
        return r["image"].astype(np.float32), json.loads(str(r["info"]))


def hair_mask_isolated(img: np.ndarray, timeout: float = ISOLATED_TIMEOUT) -> Tuple[np.ndarray, Dict]:
    """The hair mask (float 0..1, firm, slightly softened) of a float RGB picture, the segmenter in a child process; an
    empty mask (and the reason) on any failure."""
    import json
    import os
    import subprocess
    import sys
    import tempfile

    empty = np.zeros(img.shape[:2], np.float32)
    with tempfile.TemporaryDirectory(prefix="sienna_hairmask_") as td:
        inp, res = os.path.join(td, "in.npz"), os.path.join(td, "out.npz")
        np.savez(inp, image=img[..., :3].astype(np.float32), mode=np.array("mask"))
        try:
            p = subprocess.run([sys.executable, os.path.abspath(__file__), inp, res], capture_output=True, timeout=timeout)
        except subprocess.TimeoutExpired:
            return empty, {"error": f"hair mask timed out after {timeout:.0f}s"}
        if p.returncode != 0 or not os.path.exists(res):
            return empty, {"error": f"hair mask failed (exit {p.returncode})"}
        r = np.load(res, allow_pickle=False)
        return r["mask"].astype(np.float32), json.loads(str(r["info"]))


def _main(inp: str, res: str) -> None:
    import json
    import os
    import sys

    sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
    from sienna_redraw import segment_classes, segmenter_error

    d = np.load(inp, allow_pickle=False)
    img = d["image"]
    cls = segment_classes(img)
    if "mode" in d.files and str(d["mode"]) == "mask":
        m = hair_weight(cls[1]) if cls is not None else np.zeros(img.shape[:2], np.float32)
        info = {"pixels": int((m > 0.5).sum())} if cls is not None else {"error": segmenter_error()}
        np.savez(res, mask=m.astype(np.float32), info=np.array(json.dumps(info)))
        return
    if cls is None:
        out, info = img, {"changed": False, "error": segmenter_error()}
    else:
        out, info = recolour(img, hair_weight(cls[1]), float(d["strength"]))
    np.savez(res, image=out.astype(np.float32), info=np.array(json.dumps(info)))


if __name__ == "__main__":
    import sys

    _main(sys.argv[1], sys.argv[2])
