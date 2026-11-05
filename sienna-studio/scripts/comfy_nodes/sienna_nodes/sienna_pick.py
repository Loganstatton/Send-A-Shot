"""Photo Swap: the best of several swaps of the same photo.

The image editor's result depends a lot on its seed: the same photo came back from 0.64 to 0.75 against Sienna, and in
3 of 13 photos it moved her arms or hands (a waving hand became two hands on her chest, 5 Nov); in two of three seeds
it put a sweater over a cami. So it makes several, and this picks the one that changed the photo least outside her
head and hair, and, among those that kept the photo about as well as the best, looks most like Sienna.

"Changed" is measured where neither picture has hair (her hair is meant to change, and long loose hair covers more of
the photo than a ponytail): the share of pixels whose segmenter class (skin, clothes, background...) differs, plus the
share whose colour changed clearly. Calibrated on the car and cami photos (5 Nov): kept 0.06-0.09; arms moved 0.11 and
0.47; sweater for the cami 0.16-0.21.

No ComfyUI imports; unit-tested in tests/test_sienna_nodes.py.
"""
from typing import Dict, List, Optional, Sequence, Tuple

import cv2
import numpy as np

WORK = 512           # long side the photos are compared at
HAIR = 1             # MediaPipe multiclass: 0 bg, 1 hair, 2 body skin, 3 face skin, 4 clothes, 5 others
COLOUR_STEP = 0.15   # a colour change this big (0..1) counts as changed
CHANGE_SLACK = 1.2   # a candidate keeps the photo if its change is within this of the best one's ...
CHANGE_ABS = 0.01    # ... plus this
ISOLATED_TIMEOUT = 120


def small(img: np.ndarray) -> np.ndarray:
    h, w = img.shape[:2]
    s = WORK / max(h, w)
    return cv2.resize(img[..., :3].astype(np.float32), (max(1, int(round(w * s))), max(1, int(round(h * s)))), interpolation=cv2.INTER_AREA)


def head_box(face: Optional[Sequence[float]], w: int, h: int) -> Tuple[int, int, int, int]:
    """The region where the swap is meant to change things (her face and the hair above and beside it), from the photo's
    face box (x, y, w, h). Without a face: the top third of the picture."""
    if face is None:
        return 0, 0, w, h // 3
    x, y, fw, fh = face[:4]
    return max(0, int(x - 1.0 * fw)), 0, min(w, int(x + 2.0 * fw)), min(h, max(0, int(y + 1.5 * fh)))


def change(orig: np.ndarray, cand: np.ndarray, face: Optional[Sequence[float]],
           cls_o: Optional[np.ndarray] = None, cls_c: Optional[np.ndarray] = None) -> float:
    """How much the swap `cand` changed the photo `orig` outside her head and hair. Both at the same (small) size; face
    box in that size; cls_*: segmenter class maps (argmax) at that size, or None (then colour only, hair included)."""
    o, c = cv2.GaussianBlur(orig, (0, 0), 2), cv2.GaussianBlur(cand, (0, 0), 2)
    keep = np.ones(o.shape[:2], bool)
    x0, y0, x1, y1 = head_box(face, o.shape[1], o.shape[0])
    keep[y0:y1, x0:x1] = False
    layout = 0.0
    if cls_o is not None and cls_c is not None:
        keep &= (cls_o != HAIR) & (cls_c != HAIR)
        if keep.any():
            layout = float((cls_o != cls_c)[keep].mean())
    if not keep.any():
        return 0.0
    colour = float((np.abs(o - c).max(axis=2)[keep] > COLOUR_STEP).mean())
    return layout + colour


def choose(changes: Sequence[float], faces: Sequence[Optional[float]]) -> Tuple[int, List[bool]]:
    """Index of the best candidate: among those whose change is close to the smallest, the most like Sienna (no face found
    counts as least like her); ties go to the smaller change."""
    best = min(changes)
    kept = [c <= best * CHANGE_SLACK + CHANGE_ABS for c in changes]
    order = sorted((i for i in range(len(changes)) if kept[i]),
                   key=lambda i: (-(faces[i] if faces[i] is not None else -1.0), changes[i]))
    return order[0], kept


def pick(orig: np.ndarray, cands: Sequence[np.ndarray], face_box: Optional[Sequence[float]],
         face_sims: Sequence[Optional[float]], classes: Optional[Sequence[np.ndarray]] = None) -> Tuple[int, Dict]:
    """orig and cands full size (float RGB 0..1), face_box in orig's pixels; classes: class maps of [orig, *cands] at the
    small size, or None."""
    so = small(orig)
    s = so.shape[1] / orig.shape[1]
    box = None if face_box is None else [v * s for v in face_box[:4]]
    sc = [cv2.resize(small(c), (so.shape[1], so.shape[0])) for c in cands]
    cls = classes if classes is not None and len(classes) == len(cands) + 1 else None
    changes = [change(so, c, box, cls[0] if cls else None, cls[i + 1] if cls else None) for i, c in enumerate(sc)]
    i, kept = choose(changes, face_sims)
    return i, {"picked": i, "segmenter": cls is not None, "candidates": [
        {"change": round(c, 4), "face": None if f is None else round(float(f), 3), "kept_photo": k}
        for c, f, k in zip(changes, face_sims, kept)]}


def classes_isolated(images: Sequence[np.ndarray], timeout: float = ISOLATED_TIMEOUT) -> Optional[List[np.ndarray]]:
    """Segmenter class maps (argmax) of each image at the small size, the segmenter in a child process (as the hair
    step); None on any failure."""
    import os
    import subprocess
    import sys
    import tempfile

    with tempfile.TemporaryDirectory(prefix="sienna_pick_") as td:
        inp, res = os.path.join(td, "in.npz"), os.path.join(td, "out.npz")
        np.savez(inp, *[small(im) for im in images])
        try:
            p = subprocess.run([sys.executable, os.path.abspath(__file__), inp, res], capture_output=True, timeout=timeout)
        except subprocess.TimeoutExpired:
            return None
        if p.returncode != 0 or not os.path.exists(res):
            return None
        r = np.load(res, allow_pickle=False)
        return [r[f"arr_{i}"] for i in range(len(images))]


def _main(inp: str, res: str) -> None:
    import os
    import sys

    sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
    from sienna_redraw import segment_classes

    d = np.load(inp, allow_pickle=False)
    out = []
    for k in sorted(d.files, key=lambda n: int(n.split("_")[1])):
        cls = segment_classes(d[k])
        if cls is None:
            raise SystemExit(3)
        out.append(np.argmax(np.stack(cls), 0).astype(np.uint8))
    np.savez(res, *out)


if __name__ == "__main__":
    import sys

    _main(sys.argv[1], sys.argv[2])
