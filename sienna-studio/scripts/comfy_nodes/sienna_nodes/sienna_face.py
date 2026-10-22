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


def landmark_shape(f: Sequence[float]) -> Dict[str, float]:
    """How face-like a YuNet detection's five landmarks are, independent of head roll. mouth_ratio: eye-midpoint to
    mouth-midpoint distance over eye distance (Sienna's real faces 0.86-1.49, 1st-99th percentile of 574 photos; a
    stomach detected as a face, 22 Oct: 1.87)."""
    re, le = np.asarray(f[4:6], np.float32), np.asarray(f[6:8], np.float32)
    ml, mr = np.asarray(f[10:12], np.float32), np.asarray(f[12:14], np.float32)
    eye_d = float(np.linalg.norm(le - re)) + 1e-6
    return {"mouth_ratio": float(np.linalg.norm((ml + mr) / 2 - (re + le) / 2)) / eye_d}


# A "clear" face: detector confidence and landmark layout inside what Sienna's real faces show (574 photos: score
# 0.90+, eye_ratio 0.36+, mouth_ratio 1.49- at the 1st/99th percentile), with margin. The false faces seen so far
# (a stomach, a navel and a crop-top hem, 22 Oct) scored 0.75-0.80 with eye_ratio 0.19-0.28 and mouth_ratio 1.6-1.9.
CLEAR_SCORE = 0.85
CLEAR_EYE_RATIO = 0.30
CLEAR_MOUTH_RATIO = 1.6


def is_clear(d: Dict) -> bool:
    return (d.get("score", 1.0) >= CLEAR_SCORE and d.get("eye_ratio", 1.0) >= CLEAR_EYE_RATIO
            and d.get("mouth_ratio", 1.0) <= CLEAR_MOUTH_RATIO)


def _below_another(d: Dict, others: List[Dict]) -> bool:
    """True when another detection sits above this one on the same body (overlapping columns, its box ending above
    this box's middle): a head is above the torso, so the lower one is a body part the detector mistook for a face."""
    if "box" not in d:
        return False
    x, y, w, h = d["box"]
    for o in others:
        if o is d or "box" not in o:
            continue
        ox, oy, ow, oh = o["box"]
        overlap = min(x + w, ox + ow) - max(x, ox)
        if overlap > 0.3 * min(w, ow) and oy + oh <= y + 0.5 * h and oy < y:
            return True
    return False


def rank_faces(found: List[Dict], min_size: float = 0) -> List[Dict]:
    """The detections, her face first. Never simply the largest region: big-enough faces before tiny ones, clear faces
    (is_clear) before unclear ones (the 22 Oct selfie: her stomach, larger than her face, was scored instead of her
    face), an unclear detection lying directly under another one on the same body after the rest, then the larger, then the more
    confident. Big enough comes first: a tiny clear face in the background (a poster, someone far away) must not
    replace her own turned head. Reports without geometry (older callers, tests) keep their order."""
    if not found or not any("box" in d for d in found):
        return list(found)

    def key(item):
        i, d = item
        clear = is_clear(d)
        # stacked under another detection only counts against an unclear one: two clear faces one above the other are
        # two real faces (a mirror, a second person), and the larger one is the subject
        return (d.get("size", min_size) < min_size, not clear, not clear and _below_another(d, found), -d.get("area", 0), -d.get("score", 0), i)

    return [d for _, d in sorted(enumerate(found), key=key)]


def faces(bgr: np.ndarray, det, rec) -> List[Dict]:
    """Every face found: box, area, detector score, head turn, landmark shape and normalised embedding, her face first
    (rank_faces)."""
    h, w = bgr.shape[:2]
    det.setInputSize((w, h))
    _, found = det.detect(bgr)
    out = []
    for f in found if found is not None else []:
        aligned = rec.alignCrop(bgr, f)
        e = np.asarray(rec.feature(aligned), dtype=np.float32).ravel()
        out.append({"box": [float(v) for v in f[:4]], "area": float(f[2] * f[3]), "size": float(min(f[2], f[3])), "score": float(f[14]),
                    **head_turn(f), **landmark_shape(f), **appearance(bgr, f), "embedding": e / (np.linalg.norm(e) + 1e-9)})
    return rank_faces(out)


def reference_embedding(embeddings: Sequence[Sequence[float]]) -> np.ndarray:
    """Mean of the approved photos' embeddings, renormalised."""
    m = np.mean(np.asarray(embeddings, dtype=np.float32), axis=0)
    return m / (np.linalg.norm(m) + 1e-9)


def similarity(embedding: np.ndarray, reference: np.ndarray) -> float:
    return float(np.dot(embedding, reference))


def check(found: List[Dict], reference: np.ndarray, threshold: float, min_size: float = 0) -> Dict:
    """Score her face (rank_faces) against the reference. Faces smaller than min_size px are reported but always
    pass: the embedding of a tiny face is too noisy to judge. clear=False says the face compared is not clearly a
    face facing the camera (turned away, or possibly not a face at all), so a low score there is not evidence of a
    different person."""
    if not found:
        return {"found": False, "similarity": None, "ok": True, "faces": 0}
    main = rank_faces(found, min_size)[0]
    s = similarity(main["embedding"], reference)
    size = main.get("size", min_size)
    out = {"found": True, "similarity": round(s, 3), "size": round(size), "ok": s >= threshold or size < min_size, "faces": len(found)}
    if "box" in main:
        out["clear"] = is_clear(main)
        out["box"] = [round(v) for v in main["box"]]
    # head turn and detector confidence, for the app's pose-aware verdict (older apps ignore them)
    for k in ("yaw", "eye_ratio", "mouth_ratio", "score", "hair_rel", "skin_hue", "skin_l"):
        if k in main:
            out["detector_score" if k == "score" else k] = round(float(main[k]), 3)
    if "mono" in main:
        out["mono"] = bool(main["mono"])
    return out
