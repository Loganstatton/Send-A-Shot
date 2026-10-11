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


def head_turn(f: Sequence[float]) -> Dict[str, float]:
    """How far a YuNet face is turned, from its box and five landmarks (right eye, left eye, nose, mouth corners).
    yaw: the nose's sideways offset from the eye midpoint, in eye-distances (about 0 facing the camera, 0.5+ in a
    strong three-quarter view). eye_ratio: eye distance over box width (about 0.45-0.5 facing the camera, smaller as
    the head turns)."""
    re, le, nose = np.asarray(f[4:6], np.float32), np.asarray(f[6:8], np.float32), np.asarray(f[8:10], np.float32)
    eye_d = float(np.linalg.norm(le - re))
    mid = (re + le) / 2
    return {"yaw": abs(float(nose[0] - mid[0])) / (eye_d + 1e-6), "eye_ratio": eye_d / (float(f[2]) + 1e-6)}


def appearance(bgr: np.ndarray, f: Sequence[float]) -> Dict[str, float]:
    """Secondary, lighting-tolerant colour signals around a YuNet face (never proof of identity):
    hair_rel: hair brightness over skin brightness in the same photo (Sienna's dark-brown hair: 0.14-0.65 in 99%
      of photos, whatever the light; blonde/grey hair: about 1 or more). Hair is sampled above and beside the face;
      a bright sky or white wall right behind her hair can push it up (0.3% of her photos).
    skin_hue: hue angle of the cheek skin in Lab, degrees (Sienna 40-56 from shade to golden hour).
    skin_l: cheek lightness 0-100; mono: true for black-and-white photos (no colour to judge)."""
    import cv2

    H, W = bgr.shape[:2]
    lab = cv2.cvtColor(bgr, cv2.COLOR_BGR2LAB).astype(np.float32)
    lab[..., 0] *= 100.0 / 255.0
    lab[..., 1:] -= 128.0
    bx, by, bw, bh = (float(v) for v in f[:4])
    re, le = np.asarray(f[4:6], np.float32), np.asarray(f[6:8], np.float32)
    ed = float(np.linalg.norm(le - re)) + 1e-6

    def patch(x0, y0, x1, y1):
        x0, y0, x1, y1 = (int(round(v)) for v in (max(0, x0), max(0, y0), min(W, x1), min(H, y1)))
        return lab[y0:y1, x0:x1].reshape(-1, 3) if x1 - x0 >= 3 and y1 - y0 >= 3 else None

    cheeks = [patch(c[0] - .25 * ed, c[1] + .35 * ed, c[0] + .25 * ed, c[1] + .75 * ed) for c in (re, le)]
    cheeks = [c for c in cheeks if c is not None]
    if not cheeks:
        return {}
    skin = np.median(np.concatenate(cheeks), 0)
    out = {"skin_l": round(float(skin[0]), 1), "skin_hue": round(float(np.degrees(np.arctan2(skin[2], skin[1]))), 1),
           "mono": bool(np.hypot(skin[1], skin[2]) < 3)}
    bands = [patch(bx + .1 * bw, by - .35 * bh, bx + .9 * bw, by - .02 * bh),
             patch(bx - .35 * bw, by + .15 * bh, bx - .05 * bw, by + .9 * bh),
             patch(bx + 1.05 * bw, by + .15 * bh, bx + 1.35 * bw, by + .9 * bh)]
    bands = [b for b in bands if b is not None]
    if bands and skin[0] >= 5:
        px = np.concatenate(bands)
        darkest = px[np.argsort(px[:, 0])][: max(10, int(len(px) * .7))]  # drop background highlights
        out["hair_rel"] = round(float(np.median(darkest[len(darkest) // 2:, 0]) / skin[0]), 3)
    return out


def faces(bgr: np.ndarray, det, rec) -> List[Dict]:
    """Every face found: box area, detector score, head turn and normalised embedding, largest first."""
    h, w = bgr.shape[:2]
    det.setInputSize((w, h))
    _, found = det.detect(bgr)
    out = []
    for f in found if found is not None else []:
        aligned = rec.alignCrop(bgr, f)
        e = np.asarray(rec.feature(aligned), dtype=np.float32).ravel()
        out.append({"area": float(f[2] * f[3]), "size": float(min(f[2], f[3])), "score": float(f[14]), **head_turn(f), **appearance(bgr, f),
                    "embedding": e / (np.linalg.norm(e) + 1e-9)})
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
    out = {"found": True, "similarity": round(s, 3), "size": round(size), "ok": s >= threshold or size < min_size, "faces": len(found)}
    # head turn and detector confidence, for the app's pose-aware verdict (older apps ignore them)
    for k in ("yaw", "eye_ratio", "score", "hair_rel", "skin_hue", "skin_l"):
        if k in found[0]:
            out["detector_score" if k == "score" else k] = round(float(found[0][k]), 3)
    if "mono" in found[0]:
        out["mono"] = bool(found[0]["mono"])
    return out
