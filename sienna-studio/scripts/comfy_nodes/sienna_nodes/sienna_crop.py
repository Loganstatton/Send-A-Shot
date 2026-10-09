"""
Clothing-reference crop for Edit Outfit: remove everything above the chin so the editor can't copy
the reference person's face, while keeping the complete garment (full width, down to the bottom,
neck included so halter ties and necklines survive).

No ComfyUI imports; unit-tested in tests/test_sienna_nodes.py.
"""

import numpy as np


def topmost_face_band(mask: np.ndarray, threshold: float = 0.5):
    """(top, bottom) rows of the topmost face in a face-box mask, or None.

    Several faces can be in the mask (detector boxes are merged into one mask); the topmost
    contiguous band of masked rows is taken, so a second person lower in the photo is ignored.
    """
    rows = np.where((mask > threshold).any(axis=1))[0]
    if rows.size == 0:
        return None
    top = int(rows[0])
    gaps = np.where(np.diff(rows) > 1)[0]
    bottom = int(rows[gaps[0]]) if gaps.size else int(rows[-1])
    return top, bottom


def chin_crop(img: np.ndarray, face_mask, margin: float = 0.08, min_keep: float = 0.35):
    """Crop `img` (H×W×C) just below the chin.

    face_mask: H×W face-box mask (from a face bbox detector), or None.
    margin:    extra cut below the box bottom, as a fraction of the face height (clears the chin).
    min_keep:  if less than this fraction of the height would remain, the face is too low for a
               below-the-chin crop (seated / close-up photo) and the image is returned uncropped.

    Returns (image, info) where info = {"mode": "cropped"|"no-face"|"face-too-low", "cut": rows removed / H}.
    """
    h = img.shape[0]
    if face_mask is None:
        return img, {"mode": "no-face", "cut": 0.0}
    m = np.asarray(face_mask, dtype=np.float32)
    if m.shape[:2] != img.shape[:2]:
        # Resize the mask to the image with nearest-neighbour sampling.
        ys = (np.arange(img.shape[0]) * m.shape[0] / img.shape[0]).astype(int)
        xs = (np.arange(img.shape[1]) * m.shape[1] / img.shape[1]).astype(int)
        m = m[ys][:, xs]
    band = topmost_face_band(m)
    if band is None:
        return img, {"mode": "no-face", "cut": 0.0}
    top, bottom = band
    cut = min(h, int(round(bottom + 1 + margin * (bottom - top + 1))))
    if h - cut < min_keep * h:
        return img, {"mode": "face-too-low", "cut": 0.0}
    return img[cut:], {"mode": "cropped", "cut": round(cut / h, 4)}
