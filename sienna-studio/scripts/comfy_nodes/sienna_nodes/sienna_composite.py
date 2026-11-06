"""Photo Swap: the photo's own body on the swap, only her head and hair from the editor.

The owner wants the body to match the photo exactly: pose, clothing, the details on her skin (5 Nov). The image editor
redraws the whole picture, so it drifts (arms moved, a cami turned into a sweater, skin smoothed). Here the photo is put
back everywhere but her head and hair: the swap is kept where either picture has her hair or face (the editor's long
hair over a shoulder, and wherever the photo's own hair was, which the editor filled in), and where the swap changed
the photo on purpose (a tattoo removed: what differs there at the editor's scale while the layout is the same). The
swap's head is shifted to the photo's skin tone, measured on the body both pictures share, so her face sits on the
photo's neck without a seam.

No ComfyUI imports; unit-tested in tests/test_sienna_nodes.py.
"""
from typing import Dict, Optional, Sequence, Tuple

import cv2
import numpy as np

HAIR, BODY_SKIN, FACE_SKIN, CLOTHES = 1, 2, 3, 4
GROW = 0.012      # the head and hair region grown by this share of the picture's long side ...
FEATHER = 0.008   # ... and its edge softened over this share
REACH = 0.07      # ... and on into what clearly differs next to it, up to this share (the photo's own head: a bun, a
                  # profile, sunglasses the segmenter did not call hair or face came back as ghosts, red hot tub, 6 Nov)
DIFFERS = 0.12    # clearly different (0..1, at the editor's scale)


def _lab(img: np.ndarray) -> np.ndarray:
    return cv2.cvtColor(np.clip(img, 0, 1).astype(np.float32), cv2.COLOR_RGB2LAB)


def head_region(cls_o: np.ndarray, cls_s: np.ndarray, long_side: int) -> np.ndarray:
    """Where the swap is kept (float 0..1, the classes' size): hair or face in either picture, grown and softened."""
    m = np.isin(cls_o, (HAIR, FACE_SKIN)) | np.isin(cls_s, (HAIR, FACE_SKIN))
    s = cls_o.shape[0] / float(long_side) if cls_o.shape[0] >= cls_o.shape[1] else cls_o.shape[1] / float(long_side)
    g = max(1, int(round(GROW * long_side * s)))
    m = cv2.dilate(m.astype(np.uint8), cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (2 * g + 1, 2 * g + 1)))
    f = max(0.5, FEATHER * long_side * s)
    return np.clip(cv2.GaussianBlur(m.astype(np.float32), (0, 0), f), 0, 1)


def _reach(orig: np.ndarray, swap: np.ndarray, keep: np.ndarray, below: Optional[int] = None) -> np.ndarray:
    """keep (at its own size) grown into the area next to it where the two pictures clearly differ, up to REACH: the
    rest of the photo's own head (and anything else of it the editor removed) that touches her new head."""
    kh, kw = keep.shape
    small = lambda im: cv2.GaussianBlur(cv2.resize(im, (kw, kh), interpolation=cv2.INTER_AREA), (0, 0), 1.5)  # noqa: E731
    differs = (np.abs(small(orig) - small(swap)).max(axis=2) > DIFFERS).astype(np.uint8)
    # blobs only (a bun, a lens), not the thin lines where every edge of the editor's body sits a little off the photo's:
    # grown along those, it traced the neckline, the cleavage and her waist (lqcy32, 6 Nov) ...
    differs = cv2.morphologyEx(differs, cv2.MORPH_OPEN, np.ones((5, 5), np.uint8))
    # ... and only round her head: the photo's head ends at her chin
    if below is not None:
        differs[max(0, below):] = 0
    region = (keep > 0.5).astype(np.uint8)
    steps = max(1, int(REACH * max(kh, kw)))
    k = np.ones((3, 3), np.uint8)
    for _ in range(steps):
        grown = cv2.dilate(region, k) & (differs | region)
        if np.array_equal(grown, region):
            break
        region = grown
    f = max(0.5, FEATHER * max(kh, kw))
    return np.clip(cv2.GaussianBlur(cv2.dilate(region, k, iterations=2).astype(np.float32), (0, 0), f), 0, 1)


FLOW_MAX = 0.025   # the editor's body moved onto the photo's by at most this share of the picture's long side


def align_body(orig: np.ndarray, swap: np.ndarray, below: Optional[int], still: Optional[np.ndarray] = None) -> Tuple[np.ndarray, float]:
    """The swap with its body (below `below`, a row at full size) moved onto the photo's: where the photo's long hair
    covered her chest, the editor's body is used, and its edges sat a few pixels off the photo's beside it, an outline
    along the seam (lqcy32, selna84, 6 Nov). A smooth flow, its head untouched. Returns (swap, mean shift in px)."""
    h, w = swap.shape[:2]
    if below is None or below >= h - 2:
        return swap, 0.0
    sc = 640 / max(h, w)
    gray = lambda im: cv2.cvtColor((np.clip(cv2.resize(im, None, fx=sc, fy=sc, interpolation=cv2.INTER_AREA), 0, 1) * 255).astype(np.uint8), cv2.COLOR_RGB2GRAY)  # noqa: E731
    try:
        dis = cv2.DISOpticalFlow_create(cv2.DISOPTICAL_FLOW_PRESET_MEDIUM)
        flow = dis.calc(gray(orig), gray(swap), None).astype(np.float32)
    except cv2.error:
        return swap, 0.0
    lim = FLOW_MAX * max(h, w) * sc
    flow = np.clip(flow, -lim, lim)
    k = max(3.0, 0.02 * max(flow.shape[:2]))
    flow = cv2.GaussianBlur(flow, (0, 0), k)  # smooth: whole parts move, nothing is bent
    flow = cv2.resize(flow, (w, h), interpolation=cv2.INTER_LINEAR) / sc
    ramp = np.clip((np.arange(h, dtype=np.float32) - below) / max(1.0, 0.04 * h), 0, 1)[:, None, None]
    flow *= ramp  # nothing above her chin moves (her face stays as drawn)
    if still is not None:
        # nor her hair: moved, its strands bent into zigzags (selna84, 6 Nov)
        st = cv2.resize(still.astype(np.float32), (w, h), interpolation=cv2.INTER_LINEAR)
        st = cv2.GaussianBlur(st, (0, 0), max(2.0, 0.006 * max(h, w)))
        flow *= (1 - np.clip(st, 0, 1))[..., None]
    gx, gy = np.meshgrid(np.arange(w, dtype=np.float32), np.arange(h, dtype=np.float32))
    out = cv2.remap(swap, gx + flow[..., 0], gy + flow[..., 1], cv2.INTER_LINEAR, borderMode=cv2.BORDER_REFLECT)
    return out, float(np.abs(flow).mean())


def skin_shift(orig: np.ndarray, swap: np.ndarray, shared_skin: np.ndarray) -> Optional[np.ndarray]:
    """Lab offset taking the swap's skin to the photo's, measured on body skin both pictures have in the same place
    (her neck, chest, arms); None when there is too little of it."""
    if shared_skin.sum() < 200:
        return None
    lo, ls = _lab(orig)[shared_skin], _lab(swap)[shared_skin]
    return np.median(lo, axis=0) - np.median(ls, axis=0)


def composite(orig: np.ndarray, swap: np.ndarray, cls_o: np.ndarray, cls_s: np.ndarray,
              also_keep: Optional[np.ndarray] = None) -> Tuple[np.ndarray, Dict]:
    """orig, swap: float RGB 0..1, same size. cls_*: segmenter class maps (argmax) at any size (same for both).
    also_keep: where the swap is kept as well (the app overlays painted out of a screenshot, which the editor redrew)."""
    h, w = swap.shape[:2]
    orig = orig[..., :3].astype(np.float32)
    swap = swap[..., :3].astype(np.float32)
    if orig.shape[:2] != (h, w):
        orig = cv2.resize(orig, (w, h), interpolation=cv2.INTER_AREA)
    keep = head_region(cls_o, cls_s, max(h, w))
    face_rows = np.nonzero((np.isin(cls_o, (FACE_SKIN,)) | np.isin(cls_s, (FACE_SKIN,))).any(1))[0]
    chin = int(face_rows.max() + 0.03 * cls_o.shape[0]) if face_rows.size else None
    keep = np.maximum(keep, _reach(orig, swap, keep, chin))
    swap, moved = align_body(orig, swap, None if chin is None else int(chin * h / cls_o.shape[0]), cls_s == HAIR)
    keep = cv2.resize(keep, (w, h), interpolation=cv2.INTER_LINEAR)
    # what the swap changed on purpose outside her head: same layout, clearly different (a tattoo taken off)
    same_layout = cv2.resize((cls_o == cls_s).astype(np.uint8), (w, h), interpolation=cv2.INTER_NEAREST) > 0
    sig = max(1.0, 0.9 * (h * w / 1.0e6) ** 0.5)
    lo, ls = cv2.GaussianBlur(orig, (0, 0), 3 * sig), cv2.GaussianBlur(swap, (0, 0), 3 * sig)
    # skin both share, away from her head: the tone reference
    skin_o = cv2.resize(np.isin(cls_o, (BODY_SKIN,)).astype(np.uint8), (w, h), interpolation=cv2.INTER_NEAREST) > 0
    skin_s = cv2.resize(np.isin(cls_s, (BODY_SKIN,)).astype(np.uint8), (w, h), interpolation=cv2.INTER_NEAREST) > 0
    shared = skin_o & skin_s & (keep < 0.05)
    shift = skin_shift(lo, ls, shared)
    head = swap
    if shift is not None:
        # her skin only: toning her hair with it turned it a sunlit blonde-brown (red hot tub, 6 Nov)
        skin = cv2.resize(np.isin(cls_s, (BODY_SKIN, FACE_SKIN)).astype(np.float32), (w, h), interpolation=cv2.INTER_LINEAR)
        skin = cv2.GaussianBlur(skin, (0, 0), 2 * sig)[..., None]
        lab = _lab(swap) + shift.astype(np.float32)
        toned = np.clip(cv2.cvtColor(lab, cv2.COLOR_LAB2RGB), 0, 1)
        head = swap * (1 - skin) + toned * skin
    # tattoos and the like: the swap's skin there, toned to the photo
    # only a dark mark on the photo's skin the swap took off (ink is darker than skin): where the swap *added* or moved
    # something (its own necklace a little higher) the photo stays, else that came back as a ghost pendant (cami, 6 Nov)
    diff = (_lab(ls) - _lab(lo))[..., 0]
    edited = ((diff > 12) & same_layout & skin_o & skin_s).astype(np.float32)
    edited = cv2.GaussianBlur(cv2.morphologyEx(edited, cv2.MORPH_OPEN, np.ones((5, 5), np.uint8)), (0, 0), 2 * sig)
    # (the swap's skin was kept where the photo's was clearly darker, for a tattoo the swap took off; it took a strip of
    # the cleavage's shadow too, lqcy32, 6 Nov: the photo's body is kept whole now, tattoos included)
    edited = np.zeros_like(edited)
    k = keep
    if also_keep is not None and also_keep.any():
        ak = cv2.resize(also_keep.astype(np.float32), (w, h), interpolation=cv2.INTER_LINEAR)
        ak = cv2.GaussianBlur(cv2.dilate(ak, np.ones((9, 9), np.uint8)), (0, 0), 3)
        k = np.maximum(k, ak)
    k = np.clip(k, 0, 1)[..., None]
    out = orig * (1 - k) + head * k
    return np.clip(out, 0, 1).astype(np.float32), {
        "swap_share": round(float((k[..., 0] > 0.5).mean()), 3), "body_moved_px": round(moved, 1),
        "tone_shift": None if shift is None else [round(float(v), 1) for v in shift],
        "edited_share": round(float((edited > 0.5).mean()), 4)}
