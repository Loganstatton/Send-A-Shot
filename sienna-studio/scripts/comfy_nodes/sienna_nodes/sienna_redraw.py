"""Garment-only redraw for Edit Outfit: which pixels the editor may change, and what it sees there.

The editor (Qwen-Image-Edit) keeps the garment already in image 1 when it keeps the scene, and redraws the whole
scene when it changes the garment (live case: a micro bikini requested on a full-cup bikini). Here the old garment
is found, the region the new one may occupy is masked, the old garment is greyed out of the editor's view of
image 1, and only the masked region is sampled and pasted back — so face, hair, body outside the clothes, pose and
background stay pixel-identical.

Mask = clothes (MediaPipe multiclass selfie segmenter: background, hair, body skin, face skin, clothes, other)
       + strap/string corridors the segmenter misses (cups → neck and shoulders, under-bust band, hip ties)
       + body zones a larger new garment needs (grow: torso / legs / body)
       − face, hair and hands, then dilated; a feathered copy is used for the paste-back.
Without the segmenter (not installed) the mask falls back to pose zones inside the person mask.
No ComfyUI imports: tested on CPU (tests/test_sienna_nodes.py).
"""
import os
from typing import Dict, List, Optional, Sequence, Tuple

import cv2
import numpy as np

Point = Optional[Tuple[float, float]]

# OpenPose-18 indices (DWPose body)
NOSE, NECK, R_SH, R_EL, R_WR, L_SH, L_EL, L_WR, R_HIP, R_KNEE, R_ANK, L_HIP, L_KNEE, L_ANK = range(14)

GROW_MODES = ("garment", "torso", "legs", "body")
MP_MODEL = "selfie_multiclass_256x256.tflite"
HAIR, BODY_SKIN, FACE_SKIN, CLOTHES, OTHERS = 1, 2, 3, 4, 5


# ── segmentation ─────────────────────────────────────────────────────────────

def mp_model_path() -> Optional[str]:
    """The segmenter model: $SIENNA_MP_MODEL, or ComfyUI/models/mediapipe/ next to custom_nodes."""
    cands = [os.environ.get("SIENNA_MP_MODEL", "")]
    here = os.path.dirname(os.path.abspath(__file__))
    cands += [os.path.join(here, "..", "..", "models", "mediapipe", MP_MODEL), os.path.join(here, MP_MODEL)]
    return next((os.path.normpath(c) for c in cands if c and os.path.isfile(c)), None)


_SEGMENTER = None
_SEG_ERROR: Optional[str] = None


def _preload_gl_libs(model_path: str):
    """MediaPipe dlopens libEGL/libGLESv2 even on CPU. GPU images often lack them and apt installs vanish with the
    Pod, so copies kept next to the model (models/mediapipe/lib, on the network volume) are loaded first."""
    import ctypes
    lib = os.path.join(os.path.dirname(model_path), "lib")
    for name in ("libGLdispatch.so.0", "libEGL.so.1", "libGLESv2.so.2"):
        f = os.path.join(lib, name)
        if os.path.isfile(f):
            try:
                ctypes.CDLL(f, mode=ctypes.RTLD_GLOBAL)
            except OSError:
                pass


def segment_classes(img: np.ndarray) -> Optional[List[np.ndarray]]:
    """Per-class confidence maps (bg, hair, body skin, face skin, clothes, other) at image size, or None
    (segmenter unavailable — the caller falls back to pose zones; the reason is in segmenter_error())."""
    global _SEGMENTER, _SEG_ERROR
    path = mp_model_path()
    if not path:
        _SEG_ERROR = "segmenter model not found"
        return None
    try:
        _preload_gl_libs(path)
        import mediapipe as mp
        from mediapipe.tasks.python import BaseOptions, vision

        if _SEGMENTER is None:
            _SEGMENTER = vision.ImageSegmenter.create_from_options(
                vision.ImageSegmenterOptions(base_options=BaseOptions(model_asset_path=path), output_confidence_masks=True))
    except Exception as e:  # missing package or system library: never fail the edit
        _SEG_ERROR = f"{type(e).__name__}: {e}"[:200]
        return None
    rgb = np.ascontiguousarray((np.clip(img[..., :3], 0, 1) * 255).astype(np.uint8))
    res = _SEGMENTER.segment(mp.Image(image_format=mp.ImageFormat.SRGB, data=rgb))
    out = [np.squeeze(np.asarray(c.numpy_view(), np.float32)) for c in res.confidence_masks]
    h, w = img.shape[:2]
    return [c if c.shape == (h, w) else cv2.resize(c, (w, h)) for c in out]


# ── geometry helpers ─────────────────────────────────────────────────────────

def _p(kp: Sequence[Point], i: int) -> Point:
    return kp[i] if kp is not None and i < len(kp) else None


def _mid(a: Point, b: Point) -> Point:
    if a and b:
        return ((a[0] + b[0]) / 2, (a[1] + b[1]) / 2)
    return a or b


def _line(mask: np.ndarray, a: Point, b: Point, width: float):
    if a and b:
        cv2.line(mask, (int(a[0]), int(a[1])), (int(b[0]), int(b[1])), 1, max(1, int(width)))


def _band(h: int, w: int, y0: float, y1: float) -> np.ndarray:
    m = np.zeros((h, w), bool)
    m[max(0, int(y0)):max(0, min(h, int(y1)))] = True
    return m


def _components(mask: np.ndarray, min_frac: float, near: float = 0.0) -> np.ndarray:
    """Pieces of at least min_frac of the image, plus small ones (strings, ties) within `near` px of those."""
    n, lab, stats, _ = cv2.connectedComponentsWithStats(mask.astype(np.uint8), 8)
    big = np.zeros_like(mask, bool)
    for i in range(1, n):
        if stats[i, cv2.CC_STAT_AREA] >= min_frac * mask.size:
            big |= lab == i
    if near <= 0 or not big.any():
        return big
    close = cv2.dilate(big.astype(np.uint8), _disk(near)) > 0
    keep = big.copy()
    for i in range(1, n):
        piece = lab == i
        if not (piece & big).any() and (piece & close).any():
            keep |= piece
    return keep


def _pick_pieces(clothes: np.ndarray, split_y: float, torso: float, upper: bool) -> np.ndarray:
    """The upper or the lower garment: whole pieces by where their centre is; a merged piece is cut near the waist."""
    h, w = clothes.shape
    n, lab, stats, cent = cv2.connectedComponentsWithStats(clothes.astype(np.uint8), 8)
    out = np.zeros_like(clothes, bool)
    for i in range(1, n):
        y0, y1 = stats[i, cv2.CC_STAT_TOP], stats[i, cv2.CC_STAT_TOP] + stats[i, cv2.CC_STAT_HEIGHT]
        piece = lab == i
        above = float((piece & _band(h, w, 0, split_y)).sum()) / max(1, int(piece.sum()))
        if 0.2 < above < 0.8 and y0 < split_y - 0.1 * torso and y1 > split_y + 0.25 * torso:  # top and bottoms touching
            cut = split_y + 0.1 * torso
            out |= piece & (_band(h, w, 0, cut) if upper else _band(h, w, cut - 0.15 * torso, h))
        elif (cent[i][1] < split_y) == upper:
            out |= piece
    return out


def _disk(r: int) -> np.ndarray:
    r = max(1, int(r))
    return cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (2 * r + 1, 2 * r + 1))


# ── the mask ─────────────────────────────────────────────────────────────────

def segmenter_error() -> Optional[str]:
    return _SEG_ERROR


def garment_region(
    img: np.ndarray,
    classes: Optional[List[np.ndarray]],
    person: Optional[np.ndarray],
    face_mask: Optional[np.ndarray],
    kp: Sequence[Point],
    scope: str = "full",
    grow: str = "garment",
    include_feet: bool = False,
    dilate_frac: float = 0.018,
    feather_frac: float = 0.008,
) -> Tuple[np.ndarray, np.ndarray, Dict]:
    """(hard mask for sampling, feathered mask for the paste-back, info). Masks are float32 0..1 at image size."""
    h, w = img.shape[:2]
    info: Dict = {"scope": scope, "grow": grow, "source": "segmenter" if classes else "pose"}
    person_m = (np.asarray(person) > 0.5) if person is not None and np.asarray(person).any() else None
    neck, sh_r, sh_l = _p(kp, NECK), _p(kp, R_SH), _p(kp, L_SH)
    hip = _mid(_p(kp, R_HIP), _p(kp, L_HIP))
    shoulder = _mid(sh_r, sh_l) or neck
    torso = float(np.hypot(hip[0] - shoulder[0], hip[1] - shoulder[1])) if hip and shoulder else 0.3 * h
    knee = _mid(_p(kp, R_KNEE), _p(kp, L_KNEE))
    ank = _mid(_p(kp, R_ANK), _p(kp, L_ANK))
    face = (np.asarray(face_mask) > 0.5) if face_mask is not None else np.zeros((h, w), bool)
    if classes:
        face |= classes[FACE_SKIN] > 0.5
    chin_y = float(np.where(face.any(1))[0].max()) if face.any() else (neck[1] - 0.12 * torso if neck else 0.15 * h)
    split_y = (hip[1] - 0.12 * torso) if hip else 0.55 * h  # between an upper and a lower garment

    # 1. the old garment
    if classes:
        clothes = (classes[CLOTHES] > 0.5) | ((classes[OTHERS] > 0.5) & (classes[CLOTHES] > 0.2))
        if person_m is not None:
            clothes &= cv2.dilate(person_m.astype(np.uint8), _disk(0.01 * h)) > 0
        clothes = _components(clothes, 0.0004, near=0.03 * h)
    else:  # fallback: chest and pelvis zones of the person
        clothes = np.zeros((h, w), bool)
        if person_m is not None and shoulder and hip:
            clothes = person_m & (_band(h, w, shoulder[1] + 0.15 * torso, shoulder[1] + 0.55 * torso)
                                  | _band(h, w, hip[1] - 0.15 * torso, hip[1] + 0.35 * torso))
    if not include_feet and ank:
        clothes &= ~_band(h, w, ank[1] - 0.06 * torso, h)  # shoes stay unless they are being changed
    all_clothes = clothes
    if scope in ("top", "bottom"):
        clothes = _pick_pieces(clothes, split_y, torso, upper=scope == "top")
    region = clothes.copy()

    # 2. strings and straps the segmenter misses (thin, often under hair)
    width = max(3.0, 0.045 * torso)
    upper = clothes & _band(h, w, 0, split_y)
    lower = clothes & _band(h, w, split_y, h)
    corridors = np.zeros((h, w), np.uint8)
    if scope in ("full", "top") and upper.any():
        ys, xs = np.where(upper)
        cx = (neck or shoulder or (w / 2, 0))[0]
        for side in (xs < cx, xs >= cx):  # each cup's highest point → neck and that side's shoulder
            if side.any():
                i = np.argmin(np.where(side, ys, h))
                a = (float(xs[i]), float(ys[i]))
                _line(corridors, a, neck, width)
                _line(corridors, a, sh_r if a[0] < cx else sh_l, width)
        bot_y = ys.max()
        corridors[int(max(0, bot_y - 0.06 * torso)):int(min(h, bot_y + 0.03 * torso))] = 1  # under-bust / back band
    if scope in ("full", "bottom") and lower.any():
        ys, _ = np.where(lower)
        corridors[int(max(0, ys.min() - 0.08 * torso)):int(min(h, ys.min() + 0.10 * torso))] = 1  # hip ties
    # strictly on her body: the final dilation adds the edge margin, the background stays out
    body_ok = person_m if person_m is not None else (classes[BODY_SKIN] > 0.4) | clothes if classes else np.ones((h, w), bool)
    region |= (corridors > 0) & body_ok & _band(h, w, chin_y, h)
    if include_feet and ank and person_m is not None:  # shoes come off: the segmenter files them under "other"
        region |= person_m & _band(h, w, ank[1] - 0.1 * torso, ank[1] + 0.35 * torso)

    # 3. room for a larger new garment
    zones = np.zeros((h, w), bool)
    if grow in ("torso", "body") and shoulder and hip:
        zones |= _band(h, w, chin_y, hip[1] + 0.25 * torso)
    if grow in ("legs", "body") and hip:
        zones |= _band(h, w, hip[1] - 0.2 * torso, (ank[1] if ank and include_feet else (ank[1] - 0.06 * torso) if ank else h))
    if zones.any():
        base = person_m if person_m is not None else (classes[BODY_SKIN] > 0.4 if classes else np.zeros((h, w), bool))
        region |= zones & base
    info["grown"] = bool(zones.any())

    # 4. never: face, hair, hands
    keep_out = cv2.dilate(face.astype(np.uint8), _disk(0.02 * h)) > 0
    if classes:
        keep_out |= classes[HAIR] > 0.4
    arms = np.zeros((h, w), np.uint8)  # bare arms next to the hips or chest stay as they are; sleeves are clothes
    for a_, b_ in ((R_SH, R_EL), (R_EL, R_WR), (L_SH, L_EL), (L_EL, L_WR)):
        _line(arms, _p(kp, a_), _p(kp, b_), 0.16 * torso)
    # ties and strings hang next to the arms: the arm keep-out stops short of the old garment and its fringe
    near_garment = cv2.dilate((clothes | (classes[CLOTHES] > 0.25 if classes else clothes)).astype(np.uint8), _disk(0.02 * h)) > 0
    keep_out |= (arms > 0) & ~near_garment
    for wr in (_p(kp, R_WR), _p(kp, L_WR)):
        if wr:
            hand = np.zeros((h, w), np.uint8)
            cv2.circle(hand, (int(wr[0]), int(wr[1] + 0.05 * torso)), int(0.11 * torso), 1, -1)
            keep_out |= (hand > 0) & ~clothes  # fingers over the old garment are redrawn with it
    hard = cv2.dilate(region.astype(np.uint8), _disk(dilate_frac * h)) > 0
    hard &= ~keep_out
    hard = cv2.morphologyEx(hard.astype(np.uint8), cv2.MORPH_CLOSE, _disk(0.01 * h)) > 0
    soft = cv2.GaussianBlur(hard.astype(np.float32), (0, 0), max(1.0, feather_frac * h))
    soft = np.maximum(soft * (cv2.dilate(hard.astype(np.uint8), _disk(feather_frac * h)) > 0), 0)  # no blur halo outside
    # leftover check: old fabric (even faintly detected) that the mask does not cover would survive the redraw
    faint = (classes[CLOTHES] > 0.3) if classes else clothes
    faint = faint & (cv2.dilate(clothes.astype(np.uint8), _disk(0.03 * h)) > 0)  # near the garment, not the bathroom tiles
    if not include_feet and ank:
        faint &= ~_band(h, w, ank[1] - 0.06 * torso, h)
    if scope in ("top", "bottom"):
        faint &= ~(all_clothes & ~clothes)  # the garment being kept is not leftover
    info["uncovered"] = round(float((faint & ~hard).sum() / max(1, faint.sum())), 4)
    info.update(old_garment=round(float(clothes.mean()), 4), mask=round(float(hard.mean()), 4),
                empty=not bool(clothes.any()))
    return hard.astype(np.float32), np.clip(soft, 0, 1).astype(np.float32), info


def erase(img: np.ndarray, mask: np.ndarray, grey: float = 0.5) -> np.ndarray:
    """Image 1 as the editor sees it: the masked region a flat grey, so the old garment's shape can't be copied."""
    m = np.asarray(mask, np.float32)[..., None]
    return (img[..., :3] * (1 - m) + grey * m).astype(np.float32)


def overlay(img: np.ndarray, mask: np.ndarray) -> np.ndarray:
    """Preview: the redrawn region tinted."""
    m = np.asarray(mask, np.float32)[..., None] * 0.5
    return (img[..., :3] * (1 - m) + np.array([1.0, 0.25, 0.55], np.float32) * m).astype(np.float32)


def composite(src: np.ndarray, edited: np.ndarray, soft: np.ndarray) -> np.ndarray:
    m = np.asarray(soft, np.float32)[..., None]
    return (src[..., :3] * (1 - m) + edited[..., :3] * m).astype(np.float32)
