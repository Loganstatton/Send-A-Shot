"""Copy Photo: the face pass run on her face turned upright, then turned back.

A copied photo often has her head on its side (lying on a bed, a tilted selfie). The face pass (FaceDetailer with the
face reference) works on an upright face far better: in a selfie lying on her side, tilted about 30 degrees, the
faces came out 0.34-0.65 similar to Sienna against 0.71-0.77 for the upright copies (2 Nov). So the picture is turned
round her face until her eyes are level, the face pass runs on that, and only what the face pass changed is turned
back and pasted on the untouched picture: the rest is never resampled.

YuNet (the face check's detector) gives the eyes. No ComfyUI imports; unit-tested in tests/test_sienna_nodes.py.
"""
import json
from typing import Dict, Optional, Sequence, Tuple

import cv2
import numpy as np

MIN_ROLL = 12.0       # degrees: a face tilted less than this is left as it is
MAX_ROLL = 100.0      # past this YuNet's eyes are unreliable (upside down): left as it is
CHANGED = 1.5 / 255   # a pixel the face pass changed differs from its input by more than this
GROW = 0.04           # the changed region is grown and softened by this share of the face box before pasting back


def roll_of(face: Sequence[float]) -> float:
    """Head roll in degrees from a YuNet detection (x, y, w, h, right eye, left eye, nose, mouth corners): the angle
    of the line from her right eye (on the picture's left) to her left eye; 0 when level."""
    re, le = np.asarray(face[4:6], np.float64), np.asarray(face[6:8], np.float64)
    return float(np.degrees(np.arctan2(le[1] - re[1], le[0] - re[0])))


def plan(size: Tuple[int, int], face: Optional[Sequence[float]], angle: Optional[float] = None) -> Dict:
    """The turn for a picture of size (w, h) with this face: {turned, angle, M (2x3), canvas [W, H], size, box}.
    The canvas grows so no corner is cut off; the face is the centre of the turn. `angle` overrides the roll read
    from the face's eyes."""
    w, h = size
    out = {"turned": False, "size": [w, h]}
    if face is None:
        return {**out, "reason": "no face found"}
    angle = roll_of(face) if angle is None else float(angle)
    out["roll"] = round(angle, 1)
    if abs(angle) < MIN_ROLL:
        return {**out, "reason": f"face nearly level ({angle:.0f} degrees)"}
    if abs(angle) > MAX_ROLL:
        return {**out, "reason": f"face upside down ({angle:.0f} degrees)"}
    x, y, bw, bh = (float(v) for v in face[:4])
    cx, cy = x + bw / 2, y + bh / 2
    M = cv2.getRotationMatrix2D((cx, cy), angle, 1.0)  # positive angle turns counter-clockwise: undoes a clockwise roll
    corners = np.array([[0, 0, 1], [w, 0, 1], [0, h, 1], [w, h, 1]], np.float64) @ M.T
    x0, y0 = np.floor(corners.min(0)).astype(int)
    x1, y1 = np.ceil(corners.max(0)).astype(int)
    M[:, 2] -= (x0, y0)
    return {**out, "turned": True, "angle": round(angle, 2), "M": M.tolist(), "canvas": [int(x1 - x0), int(y1 - y0)],
            "box": [x, y, bw, bh]}


def turn(img: np.ndarray, p: Dict) -> np.ndarray:
    """The picture turned by the plan (float RGB 0..1); unchanged when the plan doesn't turn."""
    if not p.get("turned"):
        return img
    W, H = p["canvas"]
    return cv2.warpAffine(img.astype(np.float32), np.asarray(p["M"], np.float64), (W, H), flags=cv2.INTER_CUBIC,
                          borderMode=cv2.BORDER_REPLICATE)


def turn_back(original: np.ndarray, upright: np.ndarray, processed: np.ndarray, p: Dict) -> Tuple[np.ndarray, Dict]:
    """`original` with what the face pass changed (processed vs its upright input) turned back and pasted in."""
    if not p.get("turned"):
        if processed.shape == original.shape:
            return processed.astype(np.float32), {"pasted": False, "reason": p.get("reason", "not turned")}
        return original.astype(np.float32), {"pasted": False, "reason": "size changed"}
    if processed.shape != upright.shape:
        return original.astype(np.float32), {"pasted": False, "reason": "face pass changed the picture's size"}
    w, h = p["size"]
    changed = (np.abs(processed.astype(np.float32) - upright.astype(np.float32)).max(-1) > CHANGED).astype(np.float32)
    if changed.sum() < 16:
        return original.astype(np.float32), {"pasted": False, "reason": "the face pass changed nothing"}
    k = max(3, int(GROW * max(p["box"][2], p["box"][3]))) | 1
    soft = cv2.GaussianBlur(cv2.dilate(changed, np.ones((k, k), np.uint8)), (0, 0), k / 3)
    Minv = cv2.invertAffineTransform(np.asarray(p["M"], np.float64))
    back = cv2.warpAffine(processed.astype(np.float32), Minv, (w, h), flags=cv2.INTER_CUBIC, borderMode=cv2.BORDER_REPLICATE)
    wgt = np.clip(cv2.warpAffine(soft, Minv, (w, h), flags=cv2.INTER_LINEAR, borderValue=0), 0, 1)[..., None]
    out = original.astype(np.float32) * (1 - wgt) + back * wgt
    return np.clip(out, 0, 1).astype(np.float32), {"pasted": True, "angle": p["angle"], "changed_share": round(float((wgt > 0.5).mean()), 4)}


def find_face(img: np.ndarray, det) -> Optional[Sequence[float]]:
    """The biggest YuNet face in a float RGB picture, or None."""
    bgr = cv2.cvtColor(np.clip(np.round(img[..., :3] * 255), 0, 255).astype(np.uint8), cv2.COLOR_RGB2BGR)
    h, w = bgr.shape[:2]
    det.setInputSize((w, h))
    _, found = det.detect(bgr)
    if found is None or not len(found):
        return None
    return max(found, key=lambda f: f[2] * f[3]).tolist()


def upright_plan(img: np.ndarray, det) -> Dict:
    """plan() for a float RGB picture, the angle refined once: on a tilted face YuNet reads the eyes as more level
    than they are (a 41-degree tilt read as 27, 2 Nov), so the turned picture is read again and the rest added."""
    h, w = img.shape[:2]
    face = find_face(img, det)
    p = plan((w, h), face)
    if not p.get("turned"):
        return p
    again = find_face(turn(img, p), det)
    if again is not None:
        extra = roll_of(again)
        if 2.0 < abs(extra) < 30.0:
            p = {**plan((w, h), face, p["angle"] + extra), "refined_by": round(extra, 1)}
    return p


def dumps(p: Dict) -> str:
    return json.dumps(p)
