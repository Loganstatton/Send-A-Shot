"""Photo Swap: the photo's own fine texture put back on the swap, and a fine grain over it.

The image editor works at about 1 MP, so everything but the redrawn face came back scaled up ~1.8x from a 3 MP photo:
skin, fabric and background soft and waxy ("her skin looks plastic", owner, 5 Nov). Wherever the swap kept the photo's
picture (all but her new face and hair), the photo's fine texture (skin, denim, droplets) replaces the editor's
smoothed one. Strong lines in the photo the swap moved or dropped (a necklace chain, a sticker's text) are left out,
as they would ghost. Then a fine luminance grain, so the redrawn face reads as the same photo as the rest.

No ComfyUI imports; unit-tested in tests/test_sienna_nodes.py.
"""
from typing import Dict, Tuple

import cv2
import numpy as np

GRAIN = 0.010          # grain strength (0..1 scale), mid-tones; 0.014 was visibly noisy on a small face
SAME_TOL = 0.035       # how far the swap may differ from the photo at the editor's scale and still count as the same
SAME_SOFT = 0.05
LINE = 0.022           # photo detail stronger than this (a line, not texture) comes over only where the swap has it too


def align(orig: np.ndarray, edit: np.ndarray) -> np.ndarray:
    """`orig` warped onto `edit` (the editor shifts and rescales the picture slightly); unchanged if that fails."""
    s = 800 / max(orig.shape[:2])

    def g(im):
        small = cv2.resize(im, None, fx=s, fy=s, interpolation=cv2.INTER_AREA)
        return cv2.GaussianBlur(cv2.cvtColor(small, cv2.COLOR_RGB2GRAY), (0, 0), 1.5)

    warp = np.eye(2, 3, dtype=np.float32)
    try:
        _, warp = cv2.findTransformECC(g(edit), g(orig), warp, cv2.MOTION_AFFINE,
                                       (cv2.TERM_CRITERIA_EPS | cv2.TERM_CRITERIA_COUNT, 100, 1e-5), None, 5)
    except cv2.error:
        return orig
    if np.abs(warp[:, :2] - np.eye(2)).max() > 0.05:  # not a small shift: a wrong match
        return orig
    warp[:, 2] /= s
    return cv2.warpAffine(orig, warp, (orig.shape[1], orig.shape[0]), flags=cv2.INTER_CUBIC | cv2.WARP_INVERSE_MAP,
                          borderMode=cv2.BORDER_REFLECT)


def transfer(orig: np.ndarray, edit: np.ndarray, sigma: float = 0.0) -> Tuple[np.ndarray, np.ndarray]:
    """The swap `edit` with the photo `orig`'s fine texture wherever the swap kept the photo's picture (float RGB 0..1).
    Returns the image and the share map (1 = the photo's texture)."""
    edit = edit[..., :3].astype(np.float32)
    h, w = edit.shape[:2]
    orig = orig[..., :3].astype(np.float32)
    if orig.shape[:2] != (h, w):
        orig = cv2.resize(orig, (w, h), interpolation=cv2.INTER_CUBIC)
    orig = align(orig, edit)
    sigma = sigma or max(1.0, 0.9 * (h * w / 1.0e6) ** 0.5)
    lo, le = cv2.GaussianBlur(orig, (0, 0), sigma), cv2.GaussianBlur(edit, (0, 0), sigma)
    ho, he = orig - lo, edit - le
    big = 3 * sigma
    d = np.abs(cv2.GaussianBlur(orig, (0, 0), big) - cv2.GaussianBlur(edit, (0, 0), big)).max(axis=2)
    m = np.clip(1 - (d - SAME_TOL) / SAME_SOFT, 0, 1)
    yo, ye = ho.mean(axis=2), he.mean(axis=2)
    strength = cv2.GaussianBlur(np.abs(yo), (0, 0), sigma)
    b = lambda x: cv2.GaussianBlur(x, (0, 0), 2 * sigma)  # noqa: E731
    corr = b(yo * ye) / np.sqrt(b(yo * yo) * b(ye * ye) + 1e-8)
    m = m * np.maximum(np.exp(-(strength / LINE) ** 2), np.clip(corr, 0, 1))
    m = cv2.GaussianBlur(cv2.erode(m, np.ones((5, 5), np.uint8)), (0, 0), sigma * 1.5)
    out = le + m[..., None] * ho + (1 - m[..., None]) * he
    return np.clip(out, 0, 1).astype(np.float32), m.astype(np.float32)


def grain(img: np.ndarray, amount: float = GRAIN, seed: int = 0) -> np.ndarray:
    """Fine luminance grain, strongest in the mid-tones."""
    if amount <= 0:
        return img
    rng = np.random.default_rng(seed)
    n = cv2.GaussianBlur(rng.standard_normal(img.shape[:2]).astype(np.float32), (0, 0), 0.7)
    n /= n.std() + 1e-8
    y = img.mean(axis=2, keepdims=True)
    return np.clip(img + amount * n[..., None] * (0.4 + 2.4 * y * (1 - y)), 0, 1).astype(np.float32)


def photo_texture(orig: np.ndarray, edit: np.ndarray, amount: float = GRAIN, seed: int = 0) -> Tuple[np.ndarray, Dict]:
    out, m = transfer(orig, edit)
    return grain(out, amount, seed), {"photo_texture_share": round(float((m > 0.5).mean()), 3), "grain": amount}
