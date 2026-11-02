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


# ── Single photos (Copy Photo, 31 Oct) ───────────────────────────────────────────────────────────────────────────────
# A screenshot of a post has no "still" to go by. App overlays are drawn in pure white, in thin strokes (text, icon
# outlines), round the edges of the screen: the right-hand column of buttons, the username and caption along the
# bottom, the top bar. Real scenes have little thin pure white there; a white tub or foam is broad or off-white.
UI_WHITE = 0.9        # overlay text and icons are pure white
UI_LIGHT = 0.76       # ... or a see-through white ("See more" under a caption measured 0.81-0.85)
UI_STROKE = 9         # strokes thinner than this (pixels) count; broad white areas don't
UI_ZONE = (0.08, 0.80, 0.72)  # top band, right column start, bottom band start (shares of height / width)
UI_MAX_PART = 0.02    # one overlay element covers less than this share of the picture
UI_MAX_MASK = 0.15
UI_AVATAR = 0.13     # a username's profile picture sits up to this share of the width to its left
# Letters and icons are dense strokes: 7-28% of their box (2 Nov, 8 screenshots). The white flecks of a heathered knit
# top along the bottom of a selfie were 1.5-5%, and their boxes made a quarter of the picture "overlay", so nothing
# was removed (the speaker button stayed in every copy).
UI_DENSITY = 0.06
UI_LINE = 0.06        # a caption line or username is at most this share of the height
UI_BACKING_TOL = 0.08  # a button's disc or pill: one flat colour round its icon (max channel difference)
UI_BACKING_SHARE = 0.6  # ... over at least this share of the ring round its icon
UI_LETTER_H = 0.008   # ... and a letter at least this share of the height tall (coping glints were 1-8 px)
UI_LETTERS = 3       # outside the button column an element is words: at least this many separate strokes


def _strokes(rgb: np.ndarray, level: float) -> np.ndarray:
    import cv2

    white = (rgb.min(-1) > level) & ((rgb.max(-1) - rgb.min(-1)) < 0.1)
    broad = cv2.morphologyEx(white.astype(np.uint8), cv2.MORPH_OPEN, np.ones((UI_STROKE, UI_STROKE), np.uint8)).astype(bool)
    g = rgb.mean(-1).astype(np.float32)
    grad = 0.25 if level >= UI_WHITE else 0.2
    edge = cv2.dilate((cv2.morphologyEx(g, cv2.MORPH_GRADIENT, np.ones((3, 3), np.uint8)) > grad).astype(np.uint8), np.ones((3, 3), np.uint8)).astype(bool)
    return white & ~broad & edge


def _backing(rgb: np.ndarray, part: np.ndarray, box: Tuple[int, int, int, int]) -> np.ndarray:
    """The flat disc or pill an icon sits on (a dark see-through circle behind a speaker glyph, 2 Nov), or nothing when
    the icon sits straight on the scene. Pixels round the icon of one colour, joined to it, inside a box a little
    bigger than it, and not filling that box (a plain wall would)."""
    import cv2

    h, w = part.shape
    x0, y0, bw, bh = box
    pad = int(0.6 * max(bw, bh)) + 4
    X0, Y0, X1, Y1 = max(0, x0 - pad), max(0, y0 - pad), min(w, x0 + bw + pad), min(h, y0 + bh + pad)
    win, sub = rgb[Y0:Y1, X0:X1], part[Y0:Y1, X0:X1]
    near = cv2.dilate(sub.astype(np.uint8), np.ones((7, 7), np.uint8)).astype(bool) & ~cv2.dilate(sub.astype(np.uint8), np.ones((3, 3), np.uint8)).astype(bool)
    if near.sum() < 10:
        return np.zeros_like(part)
    ring = win[near]
    # most of the ring one colour (its inner edge is the glyph's soft antialiasing, so a plain spread is too strict:
    # the speaker button's disc measured 0.2 at the working size, 2 Nov)
    if float((np.abs(ring - np.median(ring, 0)).max(-1) < 1.5 * UI_BACKING_TOL).mean()) < UI_BACKING_SHARE:
        return np.zeros_like(part)
    same = (np.abs(win - np.median(ring, 0)).max(-1) < UI_BACKING_TOL) | sub
    n, lab = cv2.connectedComponents(same.astype(np.uint8), connectivity=8)
    ids = np.unique(lab[sub & same])
    region = np.isin(lab, ids[ids > 0])
    border = np.concatenate([region[0], region[-1], region[:, 0], region[:, -1]])
    # a disc or pill is enclosed: scenery of one colour (sky, a tub's edge, foliage) runs out of the window (2 Nov)
    if region.mean() > 0.85 or region.sum() > 6 * max(1, sub.sum()) * 4 or float(border.mean()) > 0.1:
        return np.zeros_like(part)
    region = cv2.morphologyEx(region.astype(np.uint8), cv2.MORPH_CLOSE, np.ones((5, 5), np.uint8)).astype(bool)
    out = np.zeros_like(part)
    out[Y0:Y1, X0:X1] = region
    return out


UI_LABEL_SAT = 0.45   # a coloured label behind words ("Made with Edits": purple into orange) is this saturated
UI_LABEL_INSIDE = 0.5  # ... and at least this share of it lies in the words' box


def _label(rgb: np.ndarray, box: Tuple[int, int, int, int]) -> np.ndarray:
    """The whole coloured label round a line of words: its rounded orange end stuck out past the words' box and was
    left as an orange smudge on a hot tub's rim (2 Nov). Saturated pieces near the box that lie mostly inside it,
    grown a little for their soft edge; skin or a towel running past the box is not taken."""
    import cv2

    h, w = rgb.shape[:2]
    y0, y1, x0, x1 = box
    reach = max(8, y1 - y0)
    Y0, Y1, X0, X1 = max(0, y0 - reach // 2), min(h, y1 + reach // 2), max(0, x0 - reach), min(w, x1 + reach)
    win = rgb[Y0:Y1, X0:X1]
    sat = (win.max(-1) - win.min(-1)) / np.maximum(win.max(-1), 1e-3)
    col = ((sat > UI_LABEL_SAT) & (win.max(-1) > 0.4)).astype(np.uint8)
    inside = np.zeros(col.shape, bool)
    inside[y0 - Y0:y1 - Y0, x0 - X0:x1 - X0] = True
    n, lab = cv2.connectedComponents(col, connectivity=8)
    out = np.zeros((h, w), bool)
    if n <= 1:
        return out
    total = np.bincount(lab.ravel(), minlength=n)
    within = np.bincount(lab[inside].ravel(), minlength=n)
    keep = (within >= UI_LABEL_INSIDE * total) & (total >= 20)
    keep[0] = False
    if keep.any():
        out[Y0:Y1, X0:X1] = cv2.dilate(keep[lab].astype(np.uint8), np.ones((5, 5), np.uint8)) > 0
    return out


def ui_mask(img: np.ndarray) -> Tuple[np.ndarray, Dict]:
    """img: (H, W, 3) float 0..1 → (mask HxW bool of app overlays to repaint, report)."""
    import cv2

    h, w = img.shape[:2]
    rgb = img[..., :3].astype(np.float32)
    top, right, bottom = UI_ZONE
    mask = np.zeros((h, w), bool)
    parts = 0
    seen = np.zeros((h, w), bool)
    for level in (UI_WHITE, UI_LIGHT):
        strokes = _strokes(rgb, level) & ~seen
        # letters and icon parts sit close together: join them into elements
        joined = cv2.dilate(strokes.astype(np.uint8), np.ones((9, 9), np.uint8))
        n, lab, stats, cent = cv2.connectedComponentsWithStats(joined, 8)
        for i in range(1, n):
            cx, cy = cent[i]
            area = stats[i, cv2.CC_STAT_AREA]
            if area > UI_MAX_PART * h * w or area < 30:
                continue
            if not (cy < top * h or cx > right * w or cy > bottom * h):
                continue
            x0, y0, bw, bh = (int(v) for v in stats[i, :4])
            part = (lab == i) & strokes
            if part.sum() < 12 or part.sum() / float(bw * bh) < UI_DENSITY:
                continue  # sparse flecks: fabric, foam, hair highlights
            if level < UI_WHITE and not (cy > bottom * h and bh <= 0.035 * h and bw >= 1.2 * bh):
                continue  # see-through white only as a caption line along the bottom
            backing = _backing(rgb, part, (x0, y0, bw, bh))
            if cx <= right * w and not backing.any():
                nl, _, ls, _ = cv2.connectedComponentsWithStats(part.astype(np.uint8), connectivity=8)
                tallest = int(ls[1:, cv2.CC_STAT_HEIGHT].max()) if nl > 1 else 0
                if nl - 1 < UI_LETTERS or tallest < UI_LETTER_H * h or tallest < 0.45 * (bh - 8):
                    # flat dashes along an edge: the bright lip of a pool's coping, not words (2 Nov)
                    continue
            parts += 1
            seen |= cv2.dilate(part.astype(np.uint8), np.ones((15, 15), np.uint8)).astype(bool)
            if cx > right * w or bh > UI_LINE * h:
                # the button column (or a tall icon): its icons and counts and any disc behind them, so little of the
                # scene is repainted (whole rectangles left blocky patches in foamy water, 31 Oct)
                mask |= cv2.dilate((part | backing).astype(np.uint8), np.ones((9, 9), np.uint8), iterations=2).astype(bool)
                continue
            # the whole element, not only its white strokes: the coloured profile picture left of a username, the dark
            # pill behind "Made with Edits", icon fills (31 Oct: the avatar and a dark smudge stayed in the copies)
            pad_y = max(8, int(0.6 * bh))
            left = int(UI_AVATAR * w) if level >= UI_WHITE else 6
            box = (max(0, y0 - pad_y), min(h, y0 + bh + pad_y), max(0, x0 - left), min(w, x0 + bw + 6))
            mask[box[0]:box[1], box[2]:box[3]] = True
            mask |= _label(rgb, box)
    share = float(mask.mean())
    report = {"ui_share": round(share, 4), "parts": parts}
    if share > UI_MAX_MASK:
        report["skipped"] = "too much of the picture looked like app overlays; left as it was"
        return np.zeros((h, w), bool), report
    return mask, report


def paint_out(img: np.ndarray, mask: np.ndarray) -> np.ndarray:
    """img (H, W, 3) float 0..1 with the masked overlays filled from the pixels round them (Telea), then softened so the
    fill carries no hard strokes."""
    import cv2

    if not mask.any():
        return img
    f8 = np.clip(np.round(img[..., :3] * 255), 0, 255).astype(np.uint8)
    m8 = mask.astype(np.uint8)
    out = cv2.inpaint(f8, m8, 9, cv2.INPAINT_TELEA)
    soft = cv2.GaussianBlur(out, (0, 0), 3)
    m3 = cv2.GaussianBlur(m8.astype(np.float32), (0, 0), 2)[..., None]
    out = (out * (1 - m3) + soft * m3).astype(np.float32) / 255
    return out
