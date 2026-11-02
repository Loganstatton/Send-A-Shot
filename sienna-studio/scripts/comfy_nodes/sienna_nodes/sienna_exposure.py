"""
Exposure check for outfits that have a top: did the image come out showing nipples anyway?

Uses NudeNet (MIT, bundled 320n ONNX detector, CPU). On 79 Sienna test images it flagged every one with a
visible nipple or areola (best score 0.63-0.88) and none of the covered ones (0 for all, deep V and
underboob included), so a 0.45 threshold sits well inside the gap.
NudeNet looks at the whole photo at 320 px, where a nipple through sheer mesh or peeking under a tiny cup is a few
pixels: it scored the see-through dress of 24 Oct as covered (exposed 0, covered 0.70). So a chest it calls covered
is looked at again in a close crop (chest_crop_box). On 832 saved photos the crop added 2 catches, both real (that
dress at 0.71, micro-bikini cups at 0.70), and no false alarms.
No ComfyUI imports; the summary is unit-tested in tests/test_sienna_nodes.py.
"""

from typing import Dict, List, Optional, Tuple

EXPOSED_CLASSES = ("FEMALE_BREAST_EXPOSED", "FEMALE_GENITALIA_EXPOSED")
DEFAULT_THRESHOLD = 0.45

_detector = None
_error: Optional[str] = None


def summarize(detections: List[Dict], threshold: float = DEFAULT_THRESHOLD) -> Dict:
    """One image's NudeNet detections → {exposed, score, classes} (+ crop: True when the chest crop found it)."""
    hits = [d for d in detections if d.get("class") in EXPOSED_CLASSES]
    score = max((float(d.get("score", 0)) for d in hits), default=0.0)
    out = {
        "exposed": score >= threshold,
        "score": round(score, 3),
        "classes": sorted({d["class"] for d in hits if float(d.get("score", 0)) >= threshold}),
    }
    if any(d.get("crop") and float(d.get("score", 0)) >= threshold for d in hits):
        out["crop"] = True
    return out


def chest_crop_box(detections: List[Dict], width: int, height: int, min_score: float = 0.3, margin: float = 0.35) -> Optional[Tuple[int, int, int, int]]:
    """(x0, y0, x1, y1) around every covered breast NudeNet found, padded by margin × the larger side; None if none."""
    boxes = [d["box"] for d in detections if d.get("class") == "FEMALE_BREAST_COVERED" and float(d.get("score", 0)) >= min_score]
    if not boxes:
        return None
    x0 = min(b[0] for b in boxes); y0 = min(b[1] for b in boxes)
    x1 = max(b[0] + b[2] for b in boxes); y1 = max(b[1] + b[3] for b in boxes)
    m = int(margin * max(x1 - x0, y1 - y0))
    return max(0, x0 - m), max(0, y0 - m), min(width, x1 + m), min(height, y1 + m)


class ChestCropDetector:
    """NudeNet, plus a second look at a covered chest in a close crop; crop hits come back in photo coordinates, marked crop."""

    def __init__(self, det, threshold: float = DEFAULT_THRESHOLD):
        self.det = det
        self.threshold = threshold

    def detect(self, path: str) -> List[Dict]:
        import os
        import tempfile

        import cv2

        dets = list(self.det.detect(path))
        # only a hit that already counts skips the second look: a faint one (0.2 on sheer mesh) is exactly what the
        # close crop is for
        if any(d.get("class") == "FEMALE_BREAST_EXPOSED" and float(d.get("score", 0)) >= self.threshold for d in dets):
            return dets
        img = cv2.imread(path)
        box = None if img is None else chest_crop_box(dets, img.shape[1], img.shape[0])
        if box is None:
            return dets
        x0, y0, x1, y1 = box
        fd, crop = tempfile.mkstemp(suffix=".png")
        os.close(fd)
        try:
            cv2.imwrite(crop, img[y0:y1, x0:x1])
            for d in self.det.detect(crop):
                if d.get("class") == "FEMALE_BREAST_EXPOSED":
                    b = d.get("box") or [0, 0, 0, 0]
                    dets.append({**d, "box": [b[0] + x0, b[1] + y0, b[2], b[3]], "crop": True})
        finally:
            os.remove(crop)
        return dets


# Cover-up (Copy Photo). Copying a micro top onto Sienna's own figure put a nipple just beside the photo's tiny cup on
# every try of the boat photo (1 Nov: 3 of 3 tries, scores 0.79-0.83, the photo itself scored covered); that patch is
# redrawn as fabric instead of throwing the copy away. First version (2 Nov): an ellipse at the middle of NudeNet's
# breast box, redrawn at 0.75 from the photo — every try still failed (the checker: nipples at the breasts' outer
# edges, outside the cups; and a partial redraw keeps the dark spot's shape). So the nipple is found by colour (the
# areola: darker and redder than the breast's own skin), and the patch is first filled with the garment's colour, so
# the redraw only adds fabric texture.
COVER_CENTRE = (0.5, 0.55)
COVER_RADIUS = 0.3


def _areola(img: "np.ndarray", box) -> "Optional[Tuple[float, float, float]]":
    """(cx, cy, r) of the areola inside a breast box of a float RGB 0..1 image: the largest patch clearly darker and
    redder than the box's median skin (not bluer, so a pink or red cup isn't taken for it); None if none is found."""
    import cv2
    import numpy as np

    H, W = img.shape[:2]
    x, y, w, h = (int(round(float(v))) for v in box)
    x0, y0, x1, y1 = max(0, x), max(0, y), min(W, x + w), min(H, y + h)
    if x1 - x0 < 8 or y1 - y0 < 8:
        return None
    crop = np.round(np.clip(img[y0:y1, x0:x1, :3], 0, 1) * 255).astype(np.uint8)
    lab = cv2.cvtColor(crop, cv2.COLOR_RGB2LAB).astype(np.float32)
    L, A, B = lab[..., 0], lab[..., 1], lab[..., 2]
    mL, mA, mB = (float(np.median(c)) for c in (L, A, B))
    cand = ((L < mL - 10) & (A > mA + 3) & (B > mB - 8)).astype(np.uint8)
    k = max(1, int(min(x1 - x0, y1 - y0) * 0.03))
    cand = cv2.morphologyEx(cand, cv2.MORPH_OPEN, np.ones((k, k), np.uint8))
    n, lbl, stats, cents = cv2.connectedComponentsWithStats(cand)
    if n <= 1:
        return None
    i = 1 + int(np.argmax(stats[1:, cv2.CC_STAT_AREA]))
    area = float(stats[i, cv2.CC_STAT_AREA])
    if area < 0.004 * (x1 - x0) * (y1 - y0):
        return None
    return float(cents[i][0] + x0), float(cents[i][1] + y0), float(np.sqrt(area / np.pi))


def cover_mask(detections: List[Dict], width: int, height: int, threshold: float = DEFAULT_THRESHOLD,
               radius: float = COVER_RADIUS, image=None):
    """float32 (height, width) mask, 1 over the nipple of every exposed breast NudeNet found at or above threshold, 0
    elsewhere (all 0 when none): the area a cover-up pass redraws as fabric. With the image, the areola found by colour
    (a circle 1.8x its size, at least 0.18 of the box); otherwise, or when none is found, an ellipse of `radius` of the
    box a little below its middle."""
    import cv2
    import numpy as np

    m = np.zeros((height, width), np.float32)
    for d in detections:
        if d.get("class") != "FEMALE_BREAST_EXPOSED" or float(d.get("score", 0)) < threshold:
            continue
        x, y, w, h = (float(v) for v in d.get("box") or (0, 0, 0, 0))
        if w <= 0 or h <= 0:
            continue
        found = _areola(image, (x, y, w, h)) if image is not None else None
        if found:
            cx, cy, r = found
            rr = max(1.8 * r, 0.18 * min(w, h))
            cv2.circle(m, (int(round(cx)), int(round(cy))), max(2, int(round(rr))), 1.0, -1)
        else:
            cx, cy = int(round(x + COVER_CENTRE[0] * w)), int(round(y + COVER_CENTRE[1] * h))
            cv2.ellipse(m, (cx, cy), (max(2, int(round(radius * w))), max(2, int(round(radius * h)))), 0, 0, 360, 1.0, -1)
    return m


def fill_patch(image, mask, rgb, keep_shading: float = 0.25):
    """The image with the mask's area painted the garment's colour (float RGB 0..1), keeping a little of the photo's
    light and shade so the redraw reads it as fabric on a curve; soft edge. The redraw over it then only adds texture
    (redrawn straight from the photo, the nipple's dark spot came back)."""
    import cv2
    import numpy as np

    img = image[..., :3].astype(np.float32)
    m = np.asarray(mask, np.float32)
    if not (m > 0.5).any():
        return img
    lum = img.mean(axis=2, keepdims=True)
    mean = float(lum[m > 0.5].mean()) + 1e-3
    colour = np.asarray(rgb, np.float32).reshape(1, 1, 3)
    patch = np.clip(colour * ((1 - keep_shading) + keep_shading * lum / mean), 0, 1)
    w = cv2.GaussianBlur(m, (0, 0), 2)[..., None]
    return np.clip(img * (1 - w) + patch * w, 0, 1).astype(np.float32)


def detector():
    """The NudeNet detector (with the chest-crop second look), loaded once; None (with detector_error()) if nudenet isn't installed."""
    global _detector, _error
    if _detector is None and _error is None:
        try:
            from nudenet import NudeDetector

            _detector = ChestCropDetector(NudeDetector())
        except Exception as e:  # missing package or model: the app treats the check as unavailable
            _error = f"{type(e).__name__}: {e}"
    return _detector


def detector_error() -> Optional[str]:
    return _error
