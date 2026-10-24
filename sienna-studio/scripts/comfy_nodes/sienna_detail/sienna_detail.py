"""
Close-up detail pass for nude photos (24 Oct). The Real Pussy LoRAs only show their detail in close-ups: on a
full-body photo the area is ~60-90 px across and the LoRA changed nothing visible (fig20). So NudeNet finds the exposed
genital area, a square around it is cut out and enlarged to SDXL size, redrawn there with the LoRA (the app's graph:
VAEEncode → SetLatentNoiseMask → KSampler → VAEDecode), then scaled back and pasted in with a feathered oval, colours
matched to the original. Only an area NudeNet already sees as exposed is touched: covered or clothed photos come back
unchanged (and the app adds the pass to nude / bottomless requests only).
On fig20 and earlier nude photos the detector found the area at 0.31-0.64 in front views (legs apart) and kneeling rear
views, and nothing when her legs were closed, so 0.3 is the default threshold; nothing found → photo unchanged.
No ComfyUI imports; unit-tested in tests/test_sienna_detail.py.
"""

from typing import Dict, List, Optional, Tuple

import numpy as np

GENITAL_CLASSES = ("FEMALE_GENITALIA_EXPOSED",)
DETECT_THRESHOLD = 0.3
# square side = SCALE × the box's larger side: enough skin around it for the redraw to blend, small enough to be a close-up
SCALE = 2.6
MIN_SIDE = 160
NOT_FOUND_SIDE = 64

_detector = None
_error: Optional[str] = None


def find_box(detections: List[Dict], threshold: float = DETECT_THRESHOLD) -> Optional[Tuple[int, int, int, int, float]]:
    """Best exposed-genitals box (x, y, w, h, score) at or above threshold, or None."""
    hits = [d for d in detections if d.get("class") in GENITAL_CLASSES and float(d.get("score", 0)) >= threshold]
    if not hits:
        return None
    d = max(hits, key=lambda h: float(h["score"]))
    x, y, w, h = (int(v) for v in d["box"])
    return x, y, w, h, round(float(d["score"]), 3)


def region(box: Tuple[int, int, int, int], width: int, height: int, scale: float = SCALE, min_side: int = MIN_SIDE) -> Tuple[int, int, int]:
    """(x0, y0, side): a square centred on the box, side = scale × its larger side, moved (not shrunk) to stay in frame."""
    x, y, w, h = box
    side = int(min(max(min_side, round(scale * max(w, h))), width, height))
    cx, cy = x + w / 2, y + h / 2
    x0 = int(min(max(0, round(cx - side / 2)), width - side))
    y0 = int(min(max(0, round(cy - side / 2)), height - side))
    return x0, y0, side


def oval_masks(side: int, box_in_crop: Tuple[float, float, float, float], grow: float = 1.6, feather: float = 0.18) -> Tuple[np.ndarray, np.ndarray]:
    """(hard, soft) side×side masks: an oval around the box (radii = grow × half its size), the soft one fading out
    over feather × side past the oval's edge."""
    bx, by, bw, bh = box_in_crop
    cx, cy = bx + bw / 2, by + bh / 2
    rx, ry = max(4.0, grow * bw / 2), max(4.0, grow * bh / 2)
    yy, xx = np.mgrid[0:side, 0:side].astype(np.float32)
    r = np.sqrt(((xx + 0.5 - cx) / rx) ** 2 + ((yy + 0.5 - cy) / ry) ** 2)
    hard = (r <= 1.0).astype(np.float32)
    band = max(1e-3, feather * side / max(rx, ry))
    soft = np.clip(1.0 - (r - 1.0) / band, 0.0, 1.0)
    soft = soft * soft * (3 - 2 * soft)  # smoothstep: no visible ring at either end
    return hard, soft.astype(np.float32)


def color_match(redrawn: np.ndarray, original: np.ndarray, weight: np.ndarray, limit: float = 0.08) -> Tuple[np.ndarray, List[float]]:
    """Redrawn crop shifted so its weighted mean colour equals the original's (each channel's shift capped at limit)."""
    w = weight[..., None]
    total = float(weight.sum())
    if total < 1:
        return redrawn, [0.0, 0.0, 0.0]
    shift = ((original * w).sum((0, 1)) - (redrawn * w).sum((0, 1))) / total
    shift = np.clip(shift, -limit, limit)
    return np.clip(redrawn + shift, 0, 1), [round(float(s) * 255, 1) for s in shift]


def resize(img: np.ndarray, side: int) -> np.ndarray:
    import cv2

    if img.shape[0] == side and img.shape[1] == side:
        return img
    interp = cv2.INTER_AREA if img.shape[0] > side else cv2.INTER_LANCZOS4
    return np.clip(cv2.resize(img, (side, side), interpolation=interp), 0, 1)


def plan(detections: List[Dict], width: int, height: int, size: int = 1024, threshold: float = DETECT_THRESHOLD) -> Dict:
    """What the region node does for one photo: the square to cut (or skipped), as JSON-able info for the paste node."""
    found = find_box(detections, threshold)
    if not found:
        return {"found": False, "skipped": "no exposed genital area found", "size": NOT_FOUND_SIDE}
    x, y, w, h, score = found
    x0, y0, side = region((x, y, w, h), width, height)
    return {"found": True, "score": score, "box": [x, y, w, h], "x0": x0, "y0": y0, "side": side, "size": size}


def cut(image: np.ndarray, info: Dict) -> Tuple[np.ndarray, np.ndarray]:
    """(crop enlarged to info.size, hard mask at that size). Not found: a tiny corner crop and an empty mask, so the
    sampler has almost nothing to do and the paste returns the photo unchanged."""
    if not info.get("found"):
        n = NOT_FOUND_SIDE
        return np.ascontiguousarray(image[:n, :n]), np.zeros((n, n), np.float32)
    x0, y0, side, size = info["x0"], info["y0"], info["side"], info["size"]
    crop = resize(image[y0:y0 + side, x0:x0 + side], size)
    k = size / side
    bx, by, bw, bh = info["box"]
    hard, _ = oval_masks(size, ((bx - x0) * k, (by - y0) * k, bw * k, bh * k))
    return crop, hard


def paste(image: np.ndarray, redrawn: np.ndarray, info: Dict) -> Tuple[np.ndarray, Dict]:
    """The photo with the redrawn square scaled back, colour-matched and blended in through the soft oval."""
    if not info.get("found"):
        return image, {"skipped": info.get("skipped", "nothing to paste")}
    x0, y0, side = info["x0"], info["y0"], info["side"]
    bx, by, bw, bh = info["box"]
    orig = image[y0:y0 + side, x0:x0 + side]
    back = resize(redrawn, side)
    _, soft = oval_masks(side, (bx - x0, by - y0, bw, bh))
    back, shift = color_match(back, orig, soft)
    out = image.copy()
    out[y0:y0 + side, x0:x0 + side] = orig * (1 - soft[..., None]) + back * soft[..., None]
    changed = float(np.abs(out - image).mean() * 255)
    return out, {"pasted": True, "side": side, "score": info.get("score"), "color_shift": shift, "mean_change": round(changed, 3)}


def detector():
    """NudeNet, loaded once; None (with detector_error()) if it isn't installed."""
    global _detector, _error
    if _detector is None and _error is None:
        try:
            from nudenet import NudeDetector

            _detector = NudeDetector()
        except Exception as e:  # missing package or model: the region node reports it and skips
            _error = f"{type(e).__name__}: {e}"
    return _detector


def detector_error() -> Optional[str]:
    return _error
