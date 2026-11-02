"""Copy Photo, body first and garment second: the photo's garment mask moved onto Sienna's own body.

The one-pass copy traced the photo's garment outline onto the redraw, so a micro top's cups sat where the other
woman's breasts were, beside Sienna's (2 Nov: the boat photo failed the top check in 3 of 5 rounds). Now Sienna is
drawn first with the garment in words only; this module then maps the photo's garment mask from the photo's torso
(neck, shoulders, hips, from DWPose) onto hers with a least-squares affine, and only that region is redrawn with the
garment's outline. No ComfyUI imports; tested in tests/test_sienna_nodes.py.
"""
from typing import Dict, List, Optional, Sequence, Tuple

import cv2
import numpy as np

try:
    from .sienna_pose import to_points
except ImportError:  # imported as a top-level module (tests)
    from sienna_pose import to_points  # type: ignore

# neck, right shoulder, left shoulder, right hip, left hip (OpenPose body-18)
ANCHORS = (1, 2, 5, 8, 11)
# a warp that scales the garment more than this (either way) is a pose-detection error, not a body difference
MAX_SCALE = 1.6


def main_body(pose: dict, width: int, height: int) -> Optional[List[Optional[Tuple[float, float]]]]:
    """The largest person's body points in a (width, height) frame, from one OpenPose dict (its own canvas size)."""
    if not isinstance(pose, dict):
        return None
    cw = float(pose.get("canvas_width") or width)
    ch = float(pose.get("canvas_height") or height)
    best, area = None, -1.0
    for person in pose.get("people", []) or []:
        pts = to_points(person.get("pose_keypoints_2d"), cw, ch)
        found = [p for p in pts if p is not None]
        if len(found) < 3:
            continue
        xs, ys = [p[0] for p in found], [p[1] for p in found]
        a = (max(xs) - min(xs)) * (max(ys) - min(ys))
        if a > area:
            best, area = pts, a
    if best is None:
        return None
    sx, sy = width / cw, height / ch
    return [None if p is None else (p[0] * sx, p[1] * sy) for p in best]


def torso_affine(src: Sequence, dst: Sequence) -> Optional[np.ndarray]:
    """2x3 affine taking the photo's torso anchors to Sienna's (least squares over the anchors both have), or None
    when fewer than three are shared or the result scales by more than MAX_SCALE."""
    pairs = [(src[i], dst[i]) for i in ANCHORS if i < len(src) and i < len(dst) and src[i] is not None and dst[i] is not None]
    if len(pairs) < 3:
        return None
    a = np.array([[p[0][0], p[0][1], 1.0] for p in pairs])
    b = np.array([[p[1][0], p[1][1]] for p in pairs])
    m, *_ = np.linalg.lstsq(a, b, rcond=None)
    mat = m.T  # 2x3
    sv = np.linalg.svd(mat[:, :2], compute_uv=False)
    if sv.min() < 1 / MAX_SCALE or sv.max() > MAX_SCALE:
        return None
    return mat.astype(np.float32)


def warp_mask(mask: np.ndarray, photo_pose: dict, her_pose: dict) -> Tuple[np.ndarray, Dict]:
    """The photo's garment mask (float32 HxW, 0..1) moved onto Sienna's torso; unchanged, with the reason, when the
    torso can't be matched."""
    m = np.asarray(mask, np.float32)
    h, w = m.shape[:2]
    src, dst = main_body(photo_pose, w, h), main_body(her_pose, w, h)
    if src is None or dst is None:
        return m, {"warped": False, "reason": "no body found in the " + ("photo" if src is None else "copy")}
    mat = torso_affine(src, dst)
    if mat is None:
        return m, {"warped": False, "reason": "torso anchors missing or too far apart"}
    out = cv2.warpAffine(m, mat, (w, h), flags=cv2.INTER_LINEAR, borderValue=0.0)
    shift = float(np.hypot(mat[0, 2] + (mat[0, 0] - 1) * w / 2 + mat[0, 1] * h / 2, mat[1, 2] + mat[1, 0] * w / 2 + (mat[1, 1] - 1) * h / 2))
    return np.clip(out, 0, 1).astype(np.float32), {"warped": True, "matrix": [[round(float(v), 4) for v in row] for row in mat], "centre_shift_px": round(shift, 1)}
