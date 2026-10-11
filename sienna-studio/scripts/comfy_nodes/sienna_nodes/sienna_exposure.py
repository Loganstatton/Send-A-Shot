"""
Exposure check for outfits that have a top: did the image come out showing nipples anyway?

Uses NudeNet (MIT, bundled 320n ONNX detector, CPU). On 79 Sienna test images it flagged every one with a
visible nipple or areola (best score 0.63-0.88) and none of the covered ones (0 for all, deep V and
underboob included), so a 0.45 threshold sits well inside the gap.
No ComfyUI imports; the summary is unit-tested in tests/test_sienna_nodes.py.
"""

from typing import Dict, List, Optional

EXPOSED_CLASSES = ("FEMALE_BREAST_EXPOSED", "FEMALE_GENITALIA_EXPOSED")
DEFAULT_THRESHOLD = 0.45

_detector = None
_error: Optional[str] = None


def summarize(detections: List[Dict], threshold: float = DEFAULT_THRESHOLD) -> Dict:
    """One image's NudeNet detections → {exposed, score, classes}."""
    hits = [d for d in detections if d.get("class") in EXPOSED_CLASSES]
    score = max((float(d.get("score", 0)) for d in hits), default=0.0)
    return {
        "exposed": score >= threshold,
        "score": round(score, 3),
        "classes": sorted({d["class"] for d in hits if float(d.get("score", 0)) >= threshold}),
    }


def detector():
    """The NudeNet detector, loaded once; None (with detector_error()) if nudenet isn't installed."""
    global _detector, _error
    if _detector is None and _error is None:
        try:
            from nudenet import NudeDetector

            _detector = NudeDetector()
        except Exception as e:  # missing package or model: the app treats the check as unavailable
            _error = f"{type(e).__name__}: {e}"
    return _detector


def detector_error() -> Optional[str]:
    return _error
