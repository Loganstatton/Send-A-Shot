"""
Pose retargeting for Sienna Studio (pure numpy/cv2 — no ComfyUI imports, unit-tested locally).

A DWPose skeleton carries the reference person's limb lengths, so conditioning on it pulls
Sienna toward that person's body proportions. Retargeting keeps every joint *angle* (the pose)
and the neck/torso position (the composition) but rescales each bone toward Sienna's own
proportions, measured from her approved images.

Keypoints follow the OpenPose-18 body layout DWPose emits (normalized 0..1 x/y):
 0 nose, 1 neck, 2 r-shoulder, 3 r-elbow, 4 r-wrist, 5 l-shoulder, 6 l-elbow, 7 l-wrist,
 8 r-hip, 9 r-knee, 10 r-ankle, 11 l-hip, 12 l-knee, 13 l-ankle, 14 r-eye, 15 l-eye, 16 r-ear, 17 l-ear

Drawing reproduces comfyui_controlnet_aux's draw_bodypose / draw_handpose (Apache-2.0),
including the stick scaling the xinsir OpenPose ControlNet was trained with.
"""

from __future__ import annotations

import math
from typing import Dict, List, Optional, Sequence, Tuple

import numpy as np

Point = Optional[Tuple[float, float]]  # pixel coordinates, None = not detected

# Bones as (parent, child). The tree is rooted at the neck.
BONES: Dict[str, Tuple[int, int]] = {
    "r_shoulder": (1, 2), "r_upper_arm": (2, 3), "r_forearm": (3, 4),
    "l_shoulder": (1, 5), "l_upper_arm": (5, 6), "l_forearm": (6, 7),
    "r_hip": (1, 8), "r_thigh": (8, 9), "r_shin": (9, 10),
    "l_hip": (1, 11), "l_thigh": (11, 12), "l_shin": (12, 13),
    "head": (1, 0),
}
# Left/right pairs share one proportion; the longer side is the less foreshortened estimate.
PAIRS = {
    "shoulder": ("r_shoulder", "l_shoulder"),
    "upper_arm": ("r_upper_arm", "l_upper_arm"),
    "forearm": ("r_forearm", "l_forearm"),
    "hip": ("r_hip", "l_hip"),
    "thigh": ("r_thigh", "l_thigh"),
    "shin": ("r_shin", "l_shin"),
    "head": ("head", "head"),
}
BONE_GROUP = {b: g for g, (a, c) in PAIRS.items() for b in (a, c)}
# Face points move rigidly with the nose (scaled with the head bone), so head tilt is kept exactly.
FACE_POINTS = (14, 15, 16, 17)

# Generic adult-female proportions in units of torso length (neck → mid-hip), used until
# Sienna's own are measured (see lib/pose-proportions.ts).
DEFAULT_PROPORTIONS: Dict[str, float] = {
    "shoulder": 0.34, "upper_arm": 0.58, "forearm": 0.48,
    "hip": 0.95, "thigh": 0.82, "shin": 0.80, "head": 0.40,
}


def _dist(a: Tuple[float, float], b: Tuple[float, float]) -> float:
    return math.hypot(a[0] - b[0], a[1] - b[1])


def to_points(flat: Optional[Sequence[float]], width: float, height: float) -> List[Point]:
    """OpenPose flat [x, y, c]*n list → pixel points (normalized input is scaled to the canvas)."""
    if not flat:
        return []
    vals = list(flat)
    pts: List[Point] = []
    xs = [vals[i] for i in range(0, len(vals), 3) if vals[i + 2] > 0]
    ys = [vals[i + 1] for i in range(0, len(vals), 3) if vals[i + 2] > 0]
    normalized = (max(xs + [0]) <= 1.5) and (max(ys + [0]) <= 1.5)
    sx, sy = (width, height) if normalized else (1.0, 1.0)
    for i in range(0, len(vals), 3):
        x, y, c = vals[i], vals[i + 1], vals[i + 2]
        pts.append((x * sx, y * sy) if c > 0 else None)
    return pts


def to_flat(points: List[Point], width: float, height: float) -> List[float]:
    out: List[float] = []
    for p in points:
        out += [p[0] / width, p[1] / height, 1.0] if p is not None else [0.0, 0.0, 0.0]
    return out


def torso_length(body: List[Point]) -> Optional[float]:
    neck = body[1] if len(body) > 1 else None
    hips = [body[i] for i in (8, 11) if len(body) > i and body[i] is not None]
    if neck is not None and hips:
        mid = (sum(h[0] for h in hips) / len(hips), sum(h[1] for h in hips) / len(hips))
        return _dist(neck, mid)
    return None


def measure_proportions(body: List[Point]) -> Dict[str, float]:
    """Bone-group lengths in torso units (longest side of each pair). Missing groups are omitted."""
    t = torso_length(body)
    if not t or t < 1e-6:
        return {}
    out: Dict[str, float] = {}
    for group, (a, b) in PAIRS.items():
        lengths = []
        for bone in (a, b):
            p, c = BONES[bone]
            if len(body) > max(p, c) and body[p] is not None and body[c] is not None:
                lengths.append(_dist(body[p], body[c]))
        if lengths:
            out[group] = max(lengths) / t
    return out


def retarget_body(
    body: List[Point],
    target: Dict[str, float],
    strength: float = 1.0,
    max_change: float = 0.2,
) -> Tuple[List[Point], Dict[str, float]]:
    """
    Rescale bones toward `target` proportions, keeping joint angles and the neck position.
    Returns the new points and the per-group factor that was applied (1.0 = unchanged).
    Each factor is limited to 1 ± max_change, then blended by `strength` (0 = off).
    """
    strength = float(min(max(strength, 0.0), 1.0))
    if strength == 0 or len(body) < 14 or body[1] is None:
        return list(body), {}
    ref = measure_proportions(body)
    factors: Dict[str, float] = {}
    for group, want in target.items():
        have = ref.get(group)
        if not have or have < 1e-6 or want <= 0:
            continue
        f = min(max(want / have, 1 - max_change), 1 + max_change)
        factors[group] = 1 + strength * (f - 1)

    new: List[Point] = list(body)

    def place(parent_new: Tuple[float, float], parent_old: Tuple[float, float], child: int, factor: float):
        c = body[child]
        if c is None:
            return
        new[child] = (parent_new[0] + (c[0] - parent_old[0]) * factor, parent_new[1] + (c[1] - parent_old[1]) * factor)

    neck = body[1]
    # Breadth-first from the neck so every child is placed after its parent.
    order = ["r_shoulder", "l_shoulder", "r_hip", "l_hip", "head",
             "r_upper_arm", "l_upper_arm", "r_thigh", "l_thigh",
             "r_forearm", "l_forearm", "r_shin", "l_shin"]
    for bone in order:
        p, c = BONES[bone]
        f = factors.get(BONE_GROUP[bone], 1.0)
        if body[p] is not None and new[p] is not None:
            place(new[p], body[p], c, f)
        elif body[c] is not None:
            # Parent not detected: carry the child along with the neck.
            dx, dy = new[1][0] - neck[0], new[1][1] - neck[1]
            new[c] = (body[c][0] + dx, body[c][1] + dy)
    # Eyes and ears follow the nose rigidly (head tilt unchanged), scaled with the head bone.
    fh = factors.get("head", 1.0)
    if body[0] is not None and new[0] is not None:
        for i in FACE_POINTS:
            if len(body) > i and body[i] is not None:
                new[i] = (new[0][0] + (body[i][0] - body[0][0]) * fh, new[0][1] + (body[i][1] - body[0][1]) * fh)
    return new, factors


def move_hand(hand: List[Point], old_wrist: Point, new_wrist: Point, factor: float) -> List[Point]:
    """Translate a hand with its wrist and scale it about the wrist (forearm factor)."""
    if not hand or old_wrist is None or new_wrist is None:
        return hand
    return [
        None if p is None else (new_wrist[0] + (p[0] - old_wrist[0]) * factor, new_wrist[1] + (p[1] - old_wrist[1]) * factor)
        for p in hand
    ]


def angle_errors(a: List[Point], b: List[Point]) -> Dict[str, float]:
    """Absolute bone-direction difference in degrees, for bones present in both skeletons."""
    out: Dict[str, float] = {}
    for bone, (p, c) in BONES.items():
        if max(p, c) < min(len(a), len(b)) and None not in (a[p], a[c], b[p], b[c]):
            t1 = math.atan2(a[c][1] - a[p][1], a[c][0] - a[p][0])
            t2 = math.atan2(b[c][1] - b[p][1], b[c][0] - b[p][0])
            d = abs(math.degrees(t1 - t2)) % 360
            out[bone] = min(d, 360 - d)
    return out


# ── Drawing (same look as comfyui_controlnet_aux, so the ControlNet sees what it was trained on) ──

LIMB_SEQ = [[2, 3], [2, 6], [3, 4], [4, 5], [6, 7], [7, 8], [2, 9], [9, 10], [10, 11], [2, 12], [12, 13], [13, 14],
            [2, 1], [1, 15], [15, 17], [1, 16], [16, 18]]
COLORS = [[255, 0, 0], [255, 85, 0], [255, 170, 0], [255, 255, 0], [170, 255, 0], [85, 255, 0], [0, 255, 0],
          [0, 255, 85], [0, 255, 170], [0, 255, 255], [0, 170, 255], [0, 85, 255], [0, 0, 255], [85, 0, 255],
          [170, 0, 255], [255, 0, 255], [255, 0, 170], [255, 0, 85]]
HAND_EDGES = [[0, 1], [1, 2], [2, 3], [3, 4], [0, 5], [5, 6], [6, 7], [7, 8], [0, 9], [9, 10], [10, 11], [11, 12],
              [0, 13], [13, 14], [14, 15], [15, 16], [0, 17], [17, 18], [18, 19], [19, 20]]


def stick_scale(width: int, height: int, xinsr: bool = True) -> int:
    max_side = max(width, height)
    if not xinsr:
        return 1
    return 1 if max_side < 500 else min(2 + (max_side // 1000), 7)


def draw_body(canvas: np.ndarray, body: List[Point], xinsr: bool = True) -> np.ndarray:
    import cv2

    h, w = canvas.shape[:2]
    s = stick_scale(w, h, xinsr)
    stickwidth = 4
    for (k1, k2), color in zip(LIMB_SEQ, COLORS):
        if max(k1, k2) > len(body) or body[k1 - 1] is None or body[k2 - 1] is None:
            continue
        (x1, y1), (x2, y2) = body[k1 - 1], body[k2 - 1]
        mx, my = (x1 + x2) / 2, (y1 + y2) / 2
        length = math.hypot(x1 - x2, y1 - y2)
        angle = math.degrees(math.atan2(y1 - y2, x1 - x2))
        poly = cv2.ellipse2Poly((int(mx), int(my)), (int(length / 2), stickwidth * s), int(angle), 0, 360, 1)
        cv2.fillConvexPoly(canvas, poly, [int(float(c) * 0.6) for c in color])
    for p, color in zip(body, COLORS):
        if p is not None:
            cv2.circle(canvas, (int(p[0]), int(p[1])), 4, color, thickness=-1)
    return canvas


def draw_hand(canvas: np.ndarray, hand: List[Point]) -> np.ndarray:
    import colorsys

    import cv2

    if not hand:
        return canvas
    eps = 0.01
    ints = [None if p is None else (int(p[0]), int(p[1])) for p in hand]
    for ie, (e1, e2) in enumerate(HAND_EDGES):
        if max(e1, e2) >= len(ints) or ints[e1] is None or ints[e2] is None:
            continue
        (x1, y1), (x2, y2) = ints[e1], ints[e2]
        if x1 > eps and y1 > eps and x2 > eps and y2 > eps:
            colour = [c * 255.0 for c in colorsys.hsv_to_rgb(ie / float(len(HAND_EDGES)), 1.0, 1.0)]
            cv2.line(canvas, (x1, y1), (x2, y2), colour, thickness=2)
    for p in ints:
        if p is not None and p[0] > eps and p[1] > eps:
            cv2.circle(canvas, p, 4, (0, 0, 255), thickness=-1)
    return canvas


def retarget_openpose(
    pose: dict,
    target: Dict[str, float],
    strength: float = 1.0,
    max_change: float = 0.2,
    xinsr: bool = True,
) -> Tuple[np.ndarray, dict, List[Dict[str, float]]]:
    """Retarget every person in one OpenPose dict; returns (RGB uint8 canvas, new dict, factors per person)."""
    w = int(pose.get("canvas_width") or 512)
    h = int(pose.get("canvas_height") or 512)
    canvas = np.zeros((h, w, 3), dtype=np.uint8)
    people_out = []
    all_factors = []
    for person in pose.get("people", []):
        body = to_points(person.get("pose_keypoints_2d"), w, h)
        new_body, factors = retarget_body(body, target, strength, max_change) if body else (body, {})
        all_factors.append(factors)
        hands = {}
        for key, wrist in (("hand_right_keypoints_2d", 4), ("hand_left_keypoints_2d", 7)):
            hand = to_points(person.get(key), w, h)
            if hand and len(body) > wrist:
                hand = move_hand(hand, body[wrist], new_body[wrist], factors.get("forearm", 1.0))
            hands[key] = hand
        if new_body:
            draw_body(canvas, new_body, xinsr)
        for hand in hands.values():
            draw_hand(canvas, hand)
        people_out.append({
            "pose_keypoints_2d": to_flat(new_body, w, h) if new_body else None,
            "face_keypoints_2d": None,
            "hand_right_keypoints_2d": to_flat(hands["hand_right_keypoints_2d"], w, h) if hands["hand_right_keypoints_2d"] else None,
            "hand_left_keypoints_2d": to_flat(hands["hand_left_keypoints_2d"], w, h) if hands["hand_left_keypoints_2d"] else None,
        })
    return canvas, {"people": people_out, "canvas_width": w, "canvas_height": h}, all_factors
