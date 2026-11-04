"""Copy Photo: each hand of the copy redrawn on the photo's own hand skeleton, but only where the two line up.

A copied hand came out with six fingers (hot tub, 4 Nov): the plain hand pass redraws fingers freely. The photo's
DWPose hand skeleton (21 points, five fingers) guides the redraw instead. Used on every hand the detector found, it
drew the photo's hand as a separate, oversized hand in a square patch where her arm sat a little off the photo's
(pink copy, 4 Nov). So a found hand is guided only when a photo hand overlaps it and is about its size; every other
hand gets the plain pass.

No ComfyUI imports; unit-tested in tests/test_sienna_nodes.py.
"""
import math
from typing import Dict, List, Optional, Sequence, Tuple

import numpy as np

try:
    from .sienna_pose import draw_hand, to_points
except ImportError:  # imported as a top-level module by the tests
    from sienna_pose import draw_hand, to_points

MIN_POINTS = 15       # a photo hand needs this many of its 21 points found confidently
MIN_CONF = 0.4        # ... at this confidence (DWPose already drops points under 0.3 and may write 1.0 for the rest): a hand
                      # half hidden round a string gave a guessed skeleton and stiff, curled fingers (hot tub, 4 Nov); such
                      # a hand gets the plain pass
MIN_OVERLAP = 0.5     # share of the smaller box inside the other
SIZE_RANGE = (0.5, 1.8)  # the photo hand's size against the found hand's (square root of the areas' ratio)

Box = Tuple[float, float, float, float]


def photo_hands(pose: Optional[Sequence[Dict]], size: Tuple[int, int]) -> List[List[Optional[Tuple[float, float]]]]:
    """The photo's hands (DWPose POSE_KEYPOINT) as point lists in a picture of size (w, h)."""
    w, h = size
    if not pose:
        return []
    frame = pose[0] if isinstance(pose, (list, tuple)) else pose
    cw, ch = float(frame.get("canvas_width") or w), float(frame.get("canvas_height") or h)
    out = []
    for person in frame.get("people") or []:
        for key in ("hand_left_keypoints_2d", "hand_right_keypoints_2d"):
            flat = list(person.get(key) or [])
            pts = to_points(flat, cw, ch)
            conf = [flat[i + 2] for i in range(0, len(flat) - 2, 3)]
            if sum(1 for p, c in zip(pts, conf) if p is not None and c >= MIN_CONF) < MIN_POINTS:
                continue
            out.append([None if p is None else (p[0] * w / cw, p[1] * h / ch) for p in pts])
    return out


def box_of(points) -> Box:
    xs = [p[0] for p in points if p is not None]
    ys = [p[1] for p in points if p is not None]
    return min(xs), min(ys), max(xs), max(ys)


def _area(b: Box) -> float:
    return max(0.0, b[2] - b[0]) * max(0.0, b[3] - b[1])


def matches(found: Sequence[Box], hands: Sequence[Box]) -> Dict[int, int]:
    """found-hand index -> photo-hand index, for the pairs that overlap and are about the same size (each used once,
    best overlap first)."""
    pairs = []
    for i, f in enumerate(found):
        for j, g in enumerate(hands):
            inter = _area((max(f[0], g[0]), max(f[1], g[1]), min(f[2], g[2]), min(f[3], g[3])))
            small = min(_area(f), _area(g))
            if small <= 0:
                continue
            overlap = inter / small
            size = math.sqrt(_area(g) / max(_area(f), 1e-6))
            if overlap >= MIN_OVERLAP and SIZE_RANGE[0] <= size <= SIZE_RANGE[1]:
                pairs.append((overlap, i, j))
    out: Dict[int, int] = {}
    used = set()
    for _, i, j in sorted(pairs, reverse=True):
        if i not in out and j not in used:
            out[i] = j
            used.add(j)
    return out


def control_image(hands: Sequence, size: Tuple[int, int]) -> np.ndarray:
    """The chosen photo hands drawn as an OpenPose hand picture (uint8 RGB, black elsewhere)."""
    w, h = size
    canvas = np.zeros((h, w, 3), np.uint8)
    for hand in hands:
        draw_hand(canvas, hand)
    return canvas
