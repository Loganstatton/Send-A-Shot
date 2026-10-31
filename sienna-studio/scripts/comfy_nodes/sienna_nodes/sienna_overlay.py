"""
Screen-recording clean-up for Copy Motion driving videos (31 Oct). A phone screen recording of a reel carries the app's
overlays: caption text across her chest, the like/comment icons beside her arm, the username and caption over her legs,
the comment bar. The video model reads the raw frames, so they could leak into the result or disturb the motion.
Overlays sit still while the video under them moves, and they are drawn in pure white (with dark outlines) or as solid
dark bars, which real footage almost never is:
  - strokes: pixels that stay near-pure white the whole clip on a sharp edge, plus the dark outline pixels touching them;
    erased by inpainting from the surroundings (frame by frame)
  - bars: full-width rows at the top or bottom edge that stay dark and still the whole clip; cropped off
A clip with nothing like that comes back unchanged. No ComfyUI imports; unit-tested in tests/test_sienna_nodes.py.
"""

from typing import Dict, Tuple

import numpy as np

STILL = 0.07          # max brightness change over the clip for a pixel to count as still
WHITE = 0.72          # overlay text and icons are drawn white or light grey
DARK = 0.22           # their outlines, and app bars, are near-black
BAR_DARK_SHARE = 0.85  # a row is part of a bar when this share of it is still and dark
MAX_MASK = 0.2        # more than this share of the frame "overlay" means it is real footage: leave it alone


WINDOW = 12           # captions that change during the clip ("…" then "yes"): strokes still within a sliding window
STRIDE = 4


def stroke_mask(frames: np.ndarray) -> np.ndarray:
    """Overlay strokes that stay still through these frames: white/light on a sharp edge, plus the dark outline round them."""
    import cv2

    g = frames[..., :3].mean(-1)
    mn, mx = g.min(0), g.max(0)
    still = (mx - mn) < STILL
    med = np.median(g, 0).astype(np.float32)
    edge = cv2.morphologyEx(med, cv2.MORPH_GRADIENT, np.ones((3, 3), np.uint8)) > 0.25
    white = still & (mn > WHITE) & cv2.dilate(edge.astype(np.uint8), np.ones((3, 3), np.uint8)).astype(bool)
    near_white = cv2.dilate(white.astype(np.uint8), np.ones((7, 7), np.uint8)).astype(bool)
    outline = still & (mx < DARK + 0.15) & near_white
    return cv2.dilate((white | outline).astype(np.uint8), np.ones((5, 5), np.uint8), iterations=2).astype(bool)


def window_masks(frames: np.ndarray, base: np.ndarray, top: int, bottom: int) -> list:
    """Per frame: the whole-clip mask plus the strokes still within a window centred on that frame (a caption shown for
    part of the clip). A window whose strokes would cover too much is left at the whole-clip mask."""
    t = frames.shape[0]
    if t < WINDOW * 2:
        return [base] * t
    out = []
    cache = {}
    for i in range(t):
        c = min(max(WINDOW // 2, (i // STRIDE) * STRIDE + STRIDE // 2), t - WINDOW // 2)
        if c not in cache:
            w = stroke_mask(frames[c - WINDOW // 2:c + WINDOW // 2])
            w[:top] = False
            w[bottom:] = False
            cache[c] = base | w if w[top:bottom].mean() <= MAX_MASK else base
        out.append(cache[c])
    return out


def overlay_plan(frames: np.ndarray) -> Tuple[np.ndarray, Tuple[int, int], Dict]:
    """frames: (T, H, W, 3) float 0..1. Returns (mask HxW bool of overlay strokes, (top, bottom) rows to keep, report)."""
    import cv2

    g = frames[..., :3].mean(-1)
    mn, mx = g.min(0), g.max(0)
    still = (mx - mn) < STILL
    med = np.median(g, 0).astype(np.float32)
    h, w = med.shape
    # bars: still dark rows from the top / bottom edge inwards
    dark_rows = (still & (mx < DARK)).mean(1) >= BAR_DARK_SHARE
    top = 0
    while top < h // 4 and dark_rows[top]:
        top += 1
    bottom = h
    while bottom > h - h // 4 and dark_rows[bottom - 1]:
        bottom -= 1
    # strokes: still, near-white and on a sharp edge (plain bright walls have no edges)
    edge = cv2.morphologyEx(med, cv2.MORPH_GRADIENT, np.ones((3, 3), np.uint8)) > 0.25
    white = still & (mn > WHITE) & cv2.dilate(edge.astype(np.uint8), np.ones((3, 3), np.uint8)).astype(bool)
    near_white = cv2.dilate(white.astype(np.uint8), np.ones((7, 7), np.uint8)).astype(bool)
    outline = still & (mx < DARK + 0.15) & near_white
    mask = cv2.dilate((white | outline).astype(np.uint8), np.ones((5, 5), np.uint8), iterations=2).astype(bool)
    mask[:top] = False
    mask[bottom:] = False
    share = float(mask[top:bottom].mean()) if bottom > top else 0.0
    report = {"overlay_share": round(share, 4), "crop_top": int(top), "crop_bottom": int(h - bottom)}
    if share > MAX_MASK:
        report["skipped"] = "too much of the picture looked like an overlay; left as it was"
        return np.zeros_like(mask), (0, h), report
    return mask, (top, bottom), report


def clean_frames(frames: np.ndarray) -> Tuple[np.ndarray, Dict]:
    """The clip with overlay strokes inpainted and app bars cropped off (same frame count; the height may shrink)."""
    import cv2

    mask, (top, bottom), report = overlay_plan(frames)
    if report.get("skipped"):
        return frames, {**report, "changed": False}
    masks = window_masks(frames, mask, top, bottom)
    if not any(m.any() for m in masks) and top == 0 and bottom == frames.shape[1]:
        return frames, {**report, "changed": False}
    out = []
    for f, m in zip(frames, masks):
        f8 = np.clip(np.round(f[..., :3] * 255), 0, 255).astype(np.uint8)
        if m.any():
            f8 = cv2.inpaint(f8, m.astype(np.uint8), 7, cv2.INPAINT_TELEA)
        out.append(f8[top:bottom].astype(np.float32) / 255)
    return np.stack(out), {**report, "changed": True, "windowed": len(set(map(id, masks))) > 1}
