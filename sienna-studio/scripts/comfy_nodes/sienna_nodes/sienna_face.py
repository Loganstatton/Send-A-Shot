"""
Face identity: how close a photo's face is to Sienna's approved face.

OpenCV YuNet (MIT) finds faces and five landmarks; OpenCV SFace (Apache-2.0, MobileFaceNet) turns the aligned face
into a 128-d embedding. Similarity is cosine; OpenCV's own same-person threshold for SFace is 0.363 — Sienna Studio
calibrates its own (tighter) threshold on approved photos. Models live in ComfyUI/models/sienna (bootstrap fetches them).
No ComfyUI imports; the maths is unit-tested in tests/test_sienna_nodes.py.
"""

import os
from typing import Dict, List, Optional, Sequence

import numpy as np

DETECTOR_FILE = "face_detection_yunet_2023mar.onnx"
RECOGNIZER_FILE = "face_recognition_sface_2021dec.onnx"

_models = None
_error: Optional[str] = None


def models(model_dir: str):
    """(detector, recognizer) loaded once, or None with model_error()."""
    global _models, _error
    if _models is None and _error is None:
        try:
            import cv2

            det = cv2.FaceDetectorYN.create(os.path.join(model_dir, DETECTOR_FILE), "", (320, 320), 0.7, 0.3, 5000)
            rec = cv2.FaceRecognizerSF.create(os.path.join(model_dir, RECOGNIZER_FILE), "")
            _models = (det, rec)
        except Exception as e:
            _error = f"{type(e).__name__}: {e}"
    return _models


def model_error() -> Optional[str]:
    return _error


def faces(bgr: np.ndarray, det, rec) -> List[Dict]:
    """Every face found: box area, detector score and normalised embedding, largest first."""
    h, w = bgr.shape[:2]
    det.setInputSize((w, h))
    _, found = det.detect(bgr)
    out = []
    for f in found if found is not None else []:
        aligned = rec.alignCrop(bgr, f)
        e = np.asarray(rec.feature(aligned), dtype=np.float32).ravel()
        out.append({"area": float(f[2] * f[3]), "size": float(min(f[2], f[3])), "score": float(f[14]), "embedding": e / (np.linalg.norm(e) + 1e-9)})
    return sorted(out, key=lambda d: -d["area"])


def reference_embedding(embeddings: Sequence[Sequence[float]]) -> np.ndarray:
    """Mean of the approved photos' embeddings, renormalised."""
    m = np.mean(np.asarray(embeddings, dtype=np.float32), axis=0)
    return m / (np.linalg.norm(m) + 1e-9)


def similarity(embedding: np.ndarray, reference: np.ndarray) -> float:
    return float(np.dot(embedding, reference))


def check(found: List[Dict], reference: np.ndarray, threshold: float, min_size: float = 0) -> Dict:
    """Score the main (largest) face against the reference. Faces smaller than min_size px are reported but always
    pass: the embedding of a tiny face is too noisy to judge."""
    if not found:
        return {"found": False, "similarity": None, "ok": True, "faces": 0}
    s = similarity(found[0]["embedding"], reference)
    size = found[0].get("size", min_size)
    return {"found": True, "similarity": round(s, 3), "size": round(size), "ok": s >= threshold or size < min_size, "faces": len(found)}
