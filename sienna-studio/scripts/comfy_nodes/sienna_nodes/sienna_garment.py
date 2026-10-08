"""
Garment isolation for the outfit reference (pure numpy/cv2, unit-tested locally).

The original method sends the whole person minus a face box to the clothing adapter, so
skin tone, tan and body shape travel with the outfit. This builds a garment-only image:

  * garment pixels kept as-is (mask from Florence-2 referring-expression segmentation,
    intersected with the person mask so background bleed is removed, minus the face box);
  * the rest of the person drawn as a flat, slightly lighter grey silhouette — enough
    context for where the garment sits and how it fits the body, without skin colour,
    texture or face;
  * neutral grey background;
  * cropped to the garment with a margin, so the 224 px CLIP view spends its pixels on
    the clothes instead of the whole frame.

If the garment mask is empty (segmentation found nothing) it falls back to the original
person-minus-face composite and says so — never silently.
"""

from __future__ import annotations

from typing import Optional, Tuple

import numpy as np

BG = 0.5
SILHOUETTE = 0.62


def _binary(mask: Optional[np.ndarray], shape: Tuple[int, int]) -> np.ndarray:
    if mask is None:
        return np.zeros(shape, dtype=bool)
    m = np.asarray(mask, dtype=np.float32)
    if m.ndim == 3:
        m = m[..., 0] if m.shape[-1] in (1, 3) else m[0]
    if m.shape != shape:
        import cv2

        m = cv2.resize(m, (shape[1], shape[0]), interpolation=cv2.INTER_NEAREST)
    return m > 0.5


def _dilate(mask: np.ndarray, px: int) -> np.ndarray:
    if px <= 0 or not mask.any():
        return mask
    import cv2

    k = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (2 * px + 1, 2 * px + 1))
    return cv2.dilate(mask.astype(np.uint8), k) > 0


def garment_composite(
    image: np.ndarray,
    garment_mask: Optional[np.ndarray],
    person_mask: Optional[np.ndarray],
    face_mask: Optional[np.ndarray] = None,
    edge_px: int = 6,
    silhouette: bool = True,
    margin: float = 0.12,
) -> Tuple[np.ndarray, str]:
    """
    image: HxWx3 float 0..1. Masks: HxW (any numeric, >0.5 = inside).
    Returns (cropped composite HxWx3 float, mode) with mode 'garment' or 'fallback-person'.
    """
    h, w = image.shape[:2]
    person = _binary(person_mask, (h, w))
    face = _binary(face_mask, (h, w))
    garment = _binary(garment_mask, (h, w))
    if person.any():
        # Florence polygons are coarse: keep a few pixels past the edge (thin straps survive),
        # but never beyond the (slightly grown) person outline.
        garment = _dilate(garment, edge_px) & _dilate(person, edge_px)
    garment &= ~face

    out = np.full((h, w, 3), BG, dtype=np.float32)
    if not garment.any():
        keep = person & ~face
        out[keep] = image[keep]
        return out, "fallback-person"

    if silhouette and person.any():
        out[person & ~face] = SILHOUETTE
    out[garment] = image[garment]

    ys, xs = np.nonzero(garment)
    y0, y1, x0, x1 = ys.min(), ys.max() + 1, xs.min(), xs.max() + 1
    pad = int(round(margin * max(y1 - y0, x1 - x0)))
    y0, x0 = max(0, y0 - pad), max(0, x0 - pad)
    y1, x1 = min(h, y1 + pad), min(w, x1 + pad)
    return out[y0:y1, x0:x1], "garment"
