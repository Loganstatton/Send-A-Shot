"""Copy Photo: the outfit's and skin's colours taken from the photo itself, not from words.

The keep-scene copy redraws the person from noise with a written description, so colours drift: a purple bikini came
out royal blue, a pale woman under grey light came out deeply bronzed and oily, a white bikini blue-tinted (1 Nov).
Here the photo and the copy are each split into skin and clothes (MediaPipe multiclass selfie segmenter, the same one
the garment redraw uses) and, inside the region where Sienna was drawn, each class's colour (mean and spread in LAB)
is moved onto the photo's. Shapes and shading stay the copy's; only colour moves, so her features and identity are
unchanged. Her skin (face and body together) moves most of the way (skin strength), to the photo's light; her hair is
never touched.

No ComfyUI imports: tested on CPU (tests/test_sienna_nodes.py).
"""
from typing import Dict, List, Optional, Tuple

import cv2
import numpy as np

BODY_SKIN, FACE_SKIN, CLOTHES = 2, 3, 4
MIN_PIXELS = 200


def _lab(img: np.ndarray) -> np.ndarray:
    return cv2.cvtColor(np.round(np.clip(img[..., :3], 0, 1) * 255).astype(np.uint8), cv2.COLOR_RGB2LAB).astype(np.float32)


def _robust(px: np.ndarray) -> Tuple[np.ndarray, np.ndarray]:
    """Median and a spread from the 16th-84th percentiles (one sigma for normal data), per LAB channel."""
    lo, med, hi = np.percentile(px, [16, 50, 84], axis=0)
    return med, (hi - lo) / 2 + 1e-3


def copy_colours(photo: np.ndarray, image: np.ndarray, region: np.ndarray, photo_classes: Optional[List[np.ndarray]],
                 image_classes: Optional[List[np.ndarray]], clothes: float = 1.0, skin: float = 0.8,
                 feather: int = 5, photo_region: Optional[np.ndarray] = None) -> Tuple[np.ndarray, Dict]:
    """`image` with its clothes and body-skin colours inside `region` moved onto `photo`'s (float32 RGB 0..1, same
    size). The photo's colours are read only inside `photo_region` (its person): the segmenter called foamy water
    "clothes" and turned a yellow bikini pale blue-white (1 Nov). Statistics are robust (median and spread of the
    middle of each class), so a stray patch can't drag them. Without classes (segmenter missing) the image is returned
    unchanged, with the reason in the report."""
    out = image[..., :3].astype(np.float32).copy()
    if photo_classes is None or image_classes is None:
        return out, {"changed": False, "reason": "segmenter unavailable"}
    m = np.asarray(region, np.float32) > 0.5
    a, b = _lab(photo), _lab(image)
    lab = b.copy()
    weight = np.zeros(m.shape, np.float32)
    info: Dict = {"changed": False}
    # skin is her face and body together, so they stay one tone (a bronzed face on a pale body would look pasted on)
    for name, cls, strength in (("clothes", (CLOTHES,), clothes), ("skin", (BODY_SKIN, FACE_SKIN), skin)):
        if strength <= 0:
            continue
        ms = np.logical_or.reduce([photo_classes[c] > 0.5 for c in cls])
        if photo_region is not None:
            ms &= np.asarray(photo_region, np.float32) > 0.5
        mr = m & np.logical_or.reduce([image_classes[c] > 0.5 for c in cls])
        if ms.sum() < MIN_PIXELS or mr.sum() < MIN_PIXELS:
            info[name] = {"skipped": f"too few pixels (photo {int(ms.sum())}, copy {int(mr.sum())})"}
            continue
        mu_s, sd_s = _robust(a[ms])
        mu_r, sd_r = _robust(b[mr])
        scale = np.clip(sd_s / sd_r, 0.6, 1.6)
        scale[0] = 1.0  # lightness spread stays the copy's: its folds and shading
        lab[mr] = (b[mr] - mu_r) * scale + mu_s
        weight[mr] = strength
        info[name] = {"shift_lab": [round(float(x), 1) for x in (mu_s - mu_r)], "pixels": int(mr.sum()), "strength": strength}
        info["changed"] = True
    if not info["changed"]:
        return out, info
    rgb = cv2.cvtColor(np.round(np.clip(lab, 0, 255)).astype(np.uint8), cv2.COLOR_LAB2RGB).astype(np.float32) / 255.0
    if feather > 0:  # no hard edge where a class ends (cup edge, skin by the hair)
        k = 2 * feather + 1
        weight = cv2.GaussianBlur(weight, (k, k), feather / 2)
    w = np.clip(weight, 0, 1)[..., None]
    return np.clip(out * (1 - w) + rgb * w, 0, 1).astype(np.float32), info
