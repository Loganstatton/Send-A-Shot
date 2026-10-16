"""
Safe framing for video (SiennaSafeFrame). No ComfyUI imports; unit-tested.

A photo framed tight (head at the top edge) leaves no room for a jump or a turn, and a video can't show what is
outside its first frame without her leaving it. This adds only the missing room around her:

  subject_box   her silhouette (hair included) from the segmenter's classes: top, bottom, left, right, face height
  body_height   head-top → feet when her feet are in the photo; otherwise ≥ 9 × her face height (the visible part
                can't tell how tall she is)
  plan_pads     margins (fractions of body height, per movement) minus the room the photo already has, per side.
                Room below her is added only when her feet are in the photo. Extra width only if the frame would get
                taller than min_aspect (9:16). Capped at max_pad of the photo per axis, so she never gets tiny.
  pad_image     the padded image (new strip pre-filled from blurred, mirrored edges so the fill starts from the
                right colours) and the outpaint mask (1 in the new strip, ramping to 0 over `feather` px into the photo)
  fit_area      final size at the video's pixel budget, multiples of 16, same shape

Everything is in pixels of the source photo; the node scales the padded image down to ≤ 1.1 MP for the SDXL fill.
"""

import math
from typing import Dict, List, Optional

import cv2
import numpy as np

FEET_EDGE = 0.985          # feet "in the photo" when the silhouette ends above this fraction of the height
FACE_TO_BODY = 9.0         # chin-to-hairline face height × 9 ≈ standing height (adult proportions)
ALIGN = 8


def subject_box(classes: Optional[List[np.ndarray]], thr: float = 0.5, min_frac: float = 0.01) -> Optional[Dict[str, float]]:
    """Silhouette box of the main person from segmenter confidence maps (index 0 = background)."""
    if not classes:
        return None
    person = (1.0 - classes[0]) >= thr
    h, w = person.shape
    n, lab, stats, _ = cv2.connectedComponentsWithStats(person.astype(np.uint8), 8)
    if n <= 1:
        return None
    main = 1 + int(np.argmax(stats[1:, cv2.CC_STAT_AREA]))
    if stats[main, cv2.CC_STAT_AREA] < min_frac * h * w:
        return None
    keep = np.zeros_like(person)
    for i in range(1, n):  # the main body plus pieces close to it (a hand, hair strands)
        x, y, bw, bh = stats[i, :4]
        mx, my, mw, mh = stats[main, :4]
        if i == main or (x < mx + mw + 0.05 * w and x + bw > mx - 0.05 * w and y < my + mh and y + bh > my):
            keep |= lab == i
    ys, xs = np.where(keep)
    face_h = 0.0
    if len(classes) > 3:
        fy = np.where((classes[3] >= thr).any(axis=1))[0]
        if len(fy):
            face_h = float(fy.max() - fy.min() + 1)
    return {"top": float(ys.min()), "bottom": float(ys.max() + 1), "left": float(xs.min()), "right": float(xs.max() + 1), "face_h": face_h,
            "img_w": float(w), "img_h": float(h)}


def body_height(box: Dict[str, float]) -> float:
    visible = box["bottom"] - box["top"]
    if box["bottom"] <= FEET_EDGE * box["img_h"]:
        return visible
    return max(visible, FACE_TO_BODY * box.get("face_h", 0.0))


def _up(v: float) -> int:
    return int(math.ceil(max(0.0, v) / ALIGN) * ALIGN)


def plan_pads(box: Dict[str, float], margins: Dict[str, float], max_pad: float = 0.4, min_aspect: float = 9 / 16) -> Dict:
    w, h = box["img_w"], box["img_h"]
    hb = body_height(box)
    feet_in = box["bottom"] <= FEET_EDGE * h
    need = {
        "top": margins.get("top", 0) * hb - box["top"],
        "bottom": (margins.get("bottom", 0) * hb - (h - box["bottom"])) if feet_in else 0.0,
        "left": margins.get("side", 0) * hb - box["left"],
        "right": margins.get("side", 0) * hb - (w - box["right"]),
    }
    need = {k: max(0.0, v) for k, v in need.items()}
    capped = False
    for a, b, size in (("top", "bottom", h), ("left", "right", w)):
        tot = need[a] + need[b]
        if tot > max_pad * size:
            f = max_pad * size / tot
            need[a] *= f
            need[b] *= f
            capped = True
    pads = {k: _up(v) for k, v in need.items()}
    nw, nh = w + pads["left"] + pads["right"], h + pads["top"] + pads["bottom"]
    if nw / nh < min_aspect:  # too tall for a phone frame: widen evenly
        extra = int(math.ceil(min_aspect * nh - nw))
        pads["left"] += _up(extra / 2)
        pads["right"] += _up(extra / 2)
    return {**pads, "body_height": round(hb, 1), "feet_in_photo": feet_in, "capped": capped,
            "changed": any(pads[k] > 0 for k in ("top", "bottom", "left", "right"))}


def pad_image(img: np.ndarray, pads: Dict, feather: int = 24):
    """img float32 HxWxC in 0..1 → (padded image, outpaint mask HxW float32)."""
    t, b, l, r = (int(pads[k]) for k in ("top", "bottom", "left", "right"))
    h, w = img.shape[:2]
    if t == b == l == r == 0:
        return img.copy(), np.zeros((h, w), np.float32)
    out = cv2.copyMakeBorder(img, t, b, l, r, cv2.BORDER_REFLECT_101)
    k = max(3, (max(t, b, l, r) // 2) | 1)
    blurred = cv2.GaussianBlur(out, (k, k), 0)
    mask = np.ones(out.shape[:2], np.float32)
    mask[t:t + h, l:l + w] = 0.0
    if feather > 0:  # ramp into the photo so the fill blends; the composite keeps the photo where mask = 0
        d = np.ones((h, w), np.float32) * 1e9
        yy, xx = np.mgrid[0:h, 0:w]
        if t: d = np.minimum(d, yy)
        if b: d = np.minimum(d, h - 1 - yy)
        if l: d = np.minimum(d, xx)
        if r: d = np.minimum(d, w - 1 - xx)
        ramp = np.clip(1.0 - d / float(feather), 0.0, 1.0)
        mask[t:t + h, l:l + w] = ramp
    filled = np.where(mask[..., None] >= 0.999, blurred, out)
    return filled.astype(np.float32), mask


def fit_area(w: int, h: int, area: int, mult: int = 16, lo: int = 256, hi: int = 1280):
    s = math.sqrt(area / float(w * h))
    r = lambda v: max(lo, min(hi, int(round(v * s / mult)) * mult))
    return r(w), r(h)


def fill_size(w: int, h: int, max_px: int = 1_100_000, mult: int = 8):
    """Working size for the SDXL fill: same shape, at most max_px pixels."""
    s = min(1.0, math.sqrt(max_px / float(w * h)))
    return max(mult, int(w * s) // mult * mult), max(mult, int(h * s) // mult * mult)
