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

    def __init__(self, det):
        self.det = det

    def detect(self, path: str) -> List[Dict]:
        import os
        import tempfile

        import cv2

        dets = list(self.det.detect(path))
        if any(d.get("class") == "FEMALE_BREAST_EXPOSED" for d in dets):
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
