"""
Edit Outfit body protection (experimental). No ComfyUI imports; unit-tested in tests/test_sienna_nodes.py.

  skin_model / skin_mask   skin colour learnt from the person's own face (works per photo and lighting)
  garment_only             clothing photo → garment pixels on grey (the model's skin and figure removed);
                           checks every expected piece is present, else falls back to the chin crop
  body_sheet               approved Sienna body references stitched into one image (Qwen's image 3)
  measure_body / compare   Sienna's proportions before vs after an edit, with guards for pose, camera
                           angle and clothing so it only reports what can actually be compared

Keypoints are OpenPose-18 body points (DWPose output), in pixels:
  0 nose 1 neck 2 r-shoulder 3 r-elbow 4 r-wrist 5 l-shoulder 6 l-elbow 7 l-wrist 8 r-hip 9 r-knee
  10 r-ankle 11 l-hip 12 l-knee 13 l-ankle 14 r-eye 15 l-eye 16 r-ear 17 l-ear
"""

import math
from typing import Dict, List, Optional, Sequence, Tuple

import cv2
import numpy as np

try:
    from .sienna_crop import chin_crop
    from .sienna_pose import to_points
except ImportError:  # imported as a top-level module by the tests
    from sienna_crop import chin_crop
    from sienna_pose import to_points

Point = Optional[Tuple[float, float]]


def _p(kp: Sequence[Point], i: int) -> Point:
    return kp[i] if kp is not None and i < len(kp) else None


def _mid(a: Point, b: Point) -> Point:
    if a is None or b is None:
        return a or b
    return ((a[0] + b[0]) / 2, (a[1] + b[1]) / 2)


def _dist(a: Point, b: Point) -> Optional[float]:
    return None if a is None or b is None else math.hypot(a[0] - b[0], a[1] - b[1])


def torso(kp) -> Optional[float]:
    """Neck → mid-hip length: the unit every measurement is divided by (pose- and zoom-independent)."""
    return _dist(_p(kp, 1), _mid(_p(kp, 8), _p(kp, 11)))


# ── skin ─────────────────────────────────────────────────────────────────────

def skin_model(img: np.ndarray, kp, face_mask: Optional[np.ndarray] = None):
    """Mean/std of the face's skin chroma (YCrCb), sampled on the cheeks; None if no face is visible."""
    ycc = cv2.cvtColor((np.clip(img, 0, 1) * 255).astype(np.uint8), cv2.COLOR_RGB2YCrCb).astype(np.float32)
    h, w = img.shape[:2]
    samples = []
    nose, reye, leye = _p(kp, 0), _p(kp, 14), _p(kp, 15)
    if nose and (reye or leye):
        eye_d = _dist(reye, leye) or 2 * _dist(nose, reye or leye)
        r = max(2, int(eye_d * 0.18))
        for eye in (reye, leye):
            if eye is None:
                continue
            cx, cy = int((nose[0] + eye[0]) / 2), int(nose[1] + 0.15 * eye_d)   # cheek, below the eye
            samples.append(ycc[max(0, cy - r):cy + r, max(0, cx - r):cx + r].reshape(-1, 3))
    elif face_mask is not None and face_mask.any():
        ys, xs = np.where(face_mask > 0.5)
        cy, cx = int(ys.mean() + 0.15 * (ys.max() - ys.min())), int(xs.mean())
        r = max(2, int((xs.max() - xs.min()) * 0.12))
        samples.append(ycc[max(0, cy - r):cy + r, max(0, cx - r):cx + r].reshape(-1, 3))
    if not samples:
        return None
    s = np.concatenate(samples)
    s = s[(s[:, 0] > 40) & (s[:, 0] < 245)]                                   # drop shadows / highlights
    if len(s) < 8:
        return None
    return {"mean": s[:, 1:].mean(0), "std": np.maximum(s[:, 1:].std(0), 3.0), "y": float(s[:, 0].mean())}


def skin_mask(img: np.ndarray, model, k: float = 3.0, min_tol: float = 9.0, edge_px: int = 6) -> np.ndarray:
    """Skin pixels. Shaded skin along the body's outline (darker, slightly off-colour) is added when it touches
    clear skin, so no outline of the figure survives; strings and ties in garment colours stay out."""
    ycc = cv2.cvtColor((np.clip(img, 0, 1) * 255).astype(np.uint8), cv2.COLOR_RGB2YCrCb).astype(np.float32)
    tol = np.maximum(model["std"] * k, min_tol)
    d = (np.abs(ycc[..., 1:] - model["mean"]) / tol).max(-1)
    core = (d <= 1.0) & (ycc[..., 0] > 35)
    if edge_px <= 0 or not core.any():
        return core
    near = cv2.dilate(core.astype(np.uint8), np.ones((2 * edge_px + 1, 2 * edge_px + 1), np.uint8)) > 0
    # shaded skin: same warm tint (Cr clearly above neutral 128, like the face), darker than the face.
    # Neutral greys, blacks and whites never qualify, so grey panels, black strings and white trims stay garment.
    warm = (ycc[..., 1] - 128) > 0.5 * (model["mean"][0] - 128)
    darker = ycc[..., 0] < model.get("y", 255)
    return core | (near & (d <= 2.0) & warm & darker & (ycc[..., 0] > 12))


# ── A: garment-only clothing reference ───────────────────────────────────────

def _zones(kp, person: np.ndarray, cut: int) -> Dict[str, Tuple[int, int]]:
    """Rows where an upper (top) and a lower (bottom) garment must show up."""
    h = person.shape[0]
    sh, hip = _mid(_p(kp, 2), _p(kp, 5)), _mid(_p(kp, 8), _p(kp, 11))
    t = torso(kp)
    if sh and hip and t:
        return {"upper": (int(max(cut, sh[1])), int(hip[1] - 0.18 * t)), "lower": (int(hip[1] - 0.12 * t), int(min(h, hip[1] + 0.35 * t)))}
    rows = np.where(person[cut:].any(1))[0]                                   # no pose: split the body below the chin
    if rows.size == 0:
        return {}
    top, n = cut + int(rows[0]), int(rows[-1] - rows[0])
    return {"upper": (top, top + int(0.30 * n)), "lower": (top + int(0.33 * n), top + int(0.55 * n))}


BACKDROPS = [(0.5, 0.5, 0.5), (0.96, 0.96, 0.96), (0.08, 0.08, 0.08), (0.24, 0.48, 0.55)]


def backdrop_for(pixels: np.ndarray) -> Tuple[float, float, float]:
    """Flat background colour that contrasts with every part of the garment (a light-grey panel on a grey
    backdrop would be invisible to the editor): the candidate whose closest garment colours are farthest away."""
    if len(pixels) == 0:
        return BACKDROPS[0]
    px = pixels[:: max(1, len(pixels) // 20000)]
    scores = [float(np.percentile(np.linalg.norm(px - np.array(c, np.float32), axis=1), 2)) for c in BACKDROPS]
    for c, sc in zip(BACKDROPS, scores):          # neutral first (grey, white, black) when clearly visible
        if sc >= 0.15:
            return c
    return BACKDROPS[int(np.argmax(scores))]


def garment_only(img: np.ndarray, person: np.ndarray, face_mask: Optional[np.ndarray], kp, expect: Sequence[str],
                 min_piece: float = 0.08, min_skin: float = 0.02, drop_feet: bool = False, shrink_frac: float = 0.0):
    """Clothing photo → only the clothes, on flat grey, cropped below the chin.

    Everything on the person that is not skin is kept (so straps, ties and strings survive even where a
    segmenter would miss them); the model's skin, figure outline and background become grey, so the editor
    has no body to copy. Falls back to the plain chin crop (with the reason) when a garment piece that the
    description expects is missing, or when skin can't be told apart from the clothes.
    Returns (image, info).
    """
    h = img.shape[0]
    # The GPU's segmenter runs a few pixels wider than the body; shrink it slightly so the body's shaded edge
    # falls in the edge band the cleanup below removes (a tight mask needs no shrink).
    person = np.asarray(person) > 0.5
    shrink = int(shrink_frac * h)
    if shrink > 0:
        person = cv2.erode(person.astype(np.uint8), np.ones((2 * shrink + 1, 2 * shrink + 1), np.uint8)) > 0
    fallback_img, crop_info = chin_crop(img, face_mask)
    cut = int(round(crop_info["cut"] * h)) if crop_info["mode"] == "cropped" else 0

    def fallback(reason):
        return fallback_img, {"mode": "fallback-chin-crop", "reason": reason, "cut": crop_info["cut"], "chin": crop_info["mode"]}

    if not person[cut:].any():
        return fallback("no person found in the clothing photo")
    model = skin_model(img, kp, face_mask)
    if model is None:
        return fallback("no face visible to learn the skin colour from")
    skin = skin_mask(img, model) & person
    below = np.zeros_like(person)
    below[cut:] = True
    body = person & below
    skin_frac = skin[below].sum() / max(1, body.sum())
    if skin_frac < min_skin:
        return fallback("skin and clothing look alike (skin-coloured fabric?) — can't separate them safely")
    garment = body & ~skin
    k = np.ones((3, 3), np.uint8)
    garment = cv2.dilate(garment.astype(np.uint8), k, iterations=1).astype(bool) & body           # keep edges
    # Thin parts of a garment piece in a colour that is not one of that piece's main colours (a skin outline
    # fused to the fabric) are removed; thin parts in the garment's own colours (ties, straps, strings) stay.
    thin = garment & ~(cv2.morphologyEx(garment.astype(np.uint8), cv2.MORPH_OPEN, np.ones((5, 5), np.uint8)) > 0)
    n, lab, stats, _ = cv2.connectedComponentsWithStats(garment.astype(np.uint8), 8)
    for i in range(1, n):
        comp = lab == i
        if not (thin & comp).any() or stats[i, cv2.CC_STAT_AREA] < 50:
            continue
        px = img[comp].astype(np.float32)
        k = min(3, len(px))
        _, labels, centers = cv2.kmeans(px, k, None, (cv2.TERM_CRITERIA_EPS + cv2.TERM_CRITERIA_MAX_ITER, 20, 1e-3), 2, cv2.KMEANS_PP_CENTERS)
        share = np.bincount(labels.ravel(), minlength=k) / len(px)
        main = centers[share >= 0.15]
        t_idx = thin & comp
        d = np.min(np.linalg.norm(img[t_idx][:, None, :] - main[None], axis=2), axis=1)
        drop = np.zeros_like(garment)
        drop[t_idx] = d > 0.25
        garment &= ~drop
    # Keep a piece if it is a real garment part (sizeable, mostly inside the silhouette) or touches one — so a
    # thin tie hanging off a bikini stays. Shaded-skin outlines of the figure run along the silhouette edge and
    # touch no garment part, so they go (they would show the editor the model's body shape).
    e = max(3, int(0.006 * h))
    edge = person & ~(cv2.erode(person.astype(np.uint8), np.ones((2 * e + 1, 2 * e + 1), np.uint8)) > 0)
    n, lab, stats, _ = cv2.connectedComponentsWithStats(garment.astype(np.uint8), 8)
    min_area = max(30, int(0.004 * body.sum()))
    anchors = np.zeros_like(garment)
    for i in range(1, n):
        comp = lab == i
        if stats[i, cv2.CC_STAT_AREA] >= min_area and edge[comp].mean() < 0.6:
            anchors |= comp
    alab = cv2.connectedComponents(anchors.astype(np.uint8), connectivity=8)[1]
    acol = {j: img[alab == j].mean(0) for j in np.unique(alab[anchors])}
    reach = cv2.dilate(alab.astype(np.uint16), np.ones((7, 7), np.uint8))          # nearest anchor label within 3 px
    for i in range(1, n):
        comp = lab == i
        if anchors[comp].any():
            continue
        touched = [j for j in np.unique(reach[comp]) if j in acol]
        col = img[comp].mean(0)
        # attached AND garment-coloured (a red tie on a red bikini), not a brown skin outline touching orange fabric
        if not any(float(np.linalg.norm(col - acol[j])) <= 0.3 for j in touched):
            garment[comp] = False
    feet = None
    if drop_feet:
        ankles = [p for p in (_p(kp, 10), _p(kp, 13)) if p]
        if ankles:
            feet = int(max(a[1] for a in ankles) + 0.01 * h)
            garment[feet:] = False
    zones = _zones(kp, person, cut)
    coverage = {}
    for piece in expect:
        if piece not in zones:
            continue
        a, b = zones[piece]
        if b <= a:
            continue
        zone_body = body[a:b].sum()
        coverage[piece] = round(float(garment[a:b].sum() / max(1, zone_body)), 3)
        if coverage[piece] < min_piece:
            return fallback(f"the {'top' if piece == 'upper' else 'bottom'} wasn't found in the photo")
    out = np.empty_like(img)
    out[...] = backdrop_for(img[garment])
    out[garment] = img[garment]
    info = {"mode": "garment-only", "cut": round(cut / h, 4), "coverage": coverage, "skin": round(float(skin_frac), 3),
            "backdrop": [round(float(v), 2) for v in out[0, 0]]}
    if feet is not None:
        info["feet_removed_below"] = round(feet / h, 4)
    return out[cut:], info


# ── B: body reference sheet ──────────────────────────────────────────────────

def scene_backdrop(img: np.ndarray, person: Optional[np.ndarray] = None, small: int = 160) -> np.ndarray:
    """The source photo's own scene with the person removed and blurred: a backdrop for body cut-outs.

    Flat grey behind the cut-outs made the editor turn her room into a grey studio; if it copies this backdrop,
    it copies her own scene."""
    im = np.clip(img[..., :3], 0, 1)
    h, w = im.shape[:2]
    sw, sh = max(8, round(w * small / h)), small
    lo = cv2.resize((im * 255).astype(np.uint8), (sw, sh), interpolation=cv2.INTER_AREA)
    if person is not None and (np.asarray(person) > 0.5).any():
        pm = cv2.resize((np.asarray(person) > 0.5).astype(np.uint8), (sw, sh), interpolation=cv2.INTER_NEAREST)
        pm = cv2.dilate(pm, np.ones((5, 5), np.uint8))
        lo = cv2.inpaint(lo, pm * 255, 7, cv2.INPAINT_TELEA)
    lo = cv2.GaussianBlur(lo, (0, 0), sh * 0.02)
    return cv2.resize(lo, (w, h), interpolation=cv2.INTER_CUBIC).astype(np.float32) / 255


def _cover(bg: np.ndarray, w: int, h: int) -> np.ndarray:
    """bg scaled to cover w x h and centre-cropped."""
    s = max(w / bg.shape[1], h / bg.shape[0])
    r = cv2.resize(bg, (max(w, round(bg.shape[1] * s)), max(h, round(bg.shape[0] * s))), interpolation=cv2.INTER_LINEAR)
    y, x = (r.shape[0] - h) // 2, (r.shape[1] - w) // 2
    return r[y:y + h, x:x + w]


def body_sheet(images: List[np.ndarray], height: int = 768, gap: int = 16, masks: Optional[List[Optional[np.ndarray]]] = None,
               backdrop: Optional[np.ndarray] = None) -> np.ndarray:
    """Approved Sienna references side by side at the same height (one image for Qwen's third input).

    With person masks, each reference is cut to her body: in the first GPU comparison the editor copied the
    references' studio background into the edit, so only the body is shown. The cut-outs sit on flat grey, or on
    `backdrop` (see scene_backdrop) when given."""
    tiles = []
    for k, im in enumerate(images):
        m = masks[k] if masks and k < len(masks) else None
        im = im[..., :3]
        if m is not None and (np.asarray(m) > 0.5).any():
            m = np.asarray(m) > 0.5
            if m.shape != im.shape[:2]:
                m = cv2.resize(m.astype(np.uint8), (im.shape[1], im.shape[0]), interpolation=cv2.INTER_NEAREST) > 0
            ys, xs = np.where(m)
            pad = int(0.03 * im.shape[0])
            y0, y1 = max(0, ys.min() - pad), min(im.shape[0], ys.max() + pad)
            x0, x1 = max(0, xs.min() - pad), min(im.shape[1], xs.max() + pad)
            im, m = im[y0:y1, x0:x1], m[y0:y1, x0:x1]
            bg = 0.5 if backdrop is None else _cover(backdrop[..., :3].astype(np.float32), im.shape[1], im.shape[0])
            im = np.where(m[..., None], im, bg)
        h, w = im.shape[:2]
        tiles.append(cv2.resize(im.astype(np.float32), (max(1, round(w * height / h)), height), interpolation=cv2.INTER_AREA))
    width = sum(t.shape[1] for t in tiles) + gap * (len(tiles) - 1)
    sheet = (np.full((height, max(1, width), 3), 0.5, np.float32) if backdrop is None
             else _cover(backdrop[..., :3].astype(np.float32), max(1, width), height))
    x = 0
    for t in tiles:
        sheet[:, x:x + t.shape[1]] = t[..., :3]
        x += t.shape[1] + gap
    return sheet


# ── C: body measurements and comparison ──────────────────────────────────────

# width sample points: (name, (joint a, joint b), fraction from a to b); torso parts use neck→mid-hip
WIDTHS = [
    ("waist", "torso", 0.68),
    ("hips", "hips", 0.0),
    ("thigh", ((8, 9), (11, 12)), 0.40),
    ("knee", ((8, 9), (11, 12)), 0.97),
    ("calf", ((9, 10), (12, 13)), 0.35),
]
# Leg bones only: arm keypoints are unreliable with hands in pockets / on hips, and arms don't define her figure.
LENGTHS = {"thigh": ((8, 9), (11, 12)), "shin": ((9, 10), (12, 13))}


def _run_width(person: np.ndarray, skin: np.ndarray, p: Tuple[float, float], d: Tuple[float, float], max_len: float):
    """Width of the person mask along direction d through p (the contiguous run containing p) and its skin fraction."""
    h, w = person.shape
    n = int(max_len)
    ts = np.arange(-n, n + 1)
    xs = np.round(p[0] + ts * d[0]).astype(int)
    ys = np.round(p[1] + ts * d[1]).astype(int)
    inside = (xs >= 0) & (xs < w) & (ys >= 0) & (ys < h)
    vals = np.zeros(len(ts), bool)
    sk = np.zeros(len(ts), bool)
    vals[inside] = person[ys[inside], xs[inside]]
    sk[inside] = skin[ys[inside], xs[inside]]
    c = n
    if not vals[c]:
        return None, 0.0, None
    lo, hi = c, c
    while lo > 0 and vals[lo - 1]:
        lo -= 1
    while hi < len(vals) - 1 and vals[hi + 1]:
        hi += 1
    if lo == 0 or hi == len(vals) - 1:              # ran off the sample line: mask touches something else
        return None, 0.0, None
    ends = ((float(xs[lo]), float(ys[lo])), (float(xs[hi]), float(ys[hi])))
    return float(hi - lo + 1), float(sk[lo:hi + 1].mean()), ends


def _seg_dist(p, a, b) -> float:
    """Distance from point p to segment a–b."""
    ax, ay, bx, by = a[0], a[1], b[0], b[1]
    L2 = (bx - ax) ** 2 + (by - ay) ** 2
    u = 0.0 if L2 == 0 else max(0.0, min(1.0, ((p[0] - ax) * (bx - ax) + (p[1] - ay) * (by - ay)) / L2))
    return math.hypot(p[0] - (ax + u * (bx - ax)), p[1] - (ay + u * (by - ay)))


def pose_shift(src: Dict, res: Dict) -> Optional[float]:
    """Mean joint movement in torso lengths after aligning neck and scale — near 0 when the edit kept the pose."""
    a, b = src.get("joints") or [], res.get("joints") or []
    if not a or not b or not a[1] or not b[1]:
        return None
    ta, tb = src["torso_px"], res["torso_px"]
    d = [math.hypot((p[0] - a[1][0]) / ta - (q[0] - b[1][0]) / tb, (p[1] - a[1][1]) / ta - (q[1] - b[1][1]) / tb)
         for p, q in zip(a, b) if p and q]
    return float(np.mean(d)) if d else None


def measure_body(img: np.ndarray, kp, person: np.ndarray, face_mask: Optional[np.ndarray] = None) -> Dict:
    """Proportions in torso lengths, each with how reliable it is (visible, bare skin, foreshortening)."""
    person = np.asarray(person) > 0.5
    t = torso(kp)
    out = {"valid": False}
    if not t or t < 20:
        return out
    model = skin_model(img, kp, face_mask)
    skin = skin_mask(img, model) & person if model else np.zeros_like(person)
    sh = _dist(_p(kp, 2), _p(kp, 5))
    out.update(valid=True, torso_px=t, view=round(sh / t, 3) if sh else None, skin_model=model is not None)
    lengths, angles = {}, {}
    for name, sides in LENGTHS.items():
        for side, (a, b) in zip("rl", sides):
            pa, pb = _p(kp, a), _p(kp, b)
            if pa and pb:
                lengths[f"{name}_{side}"] = round(_dist(pa, pb) / t, 4)
                angles[f"{name}_{side}"] = round(math.degrees(math.atan2(pb[1] - pa[1], pb[0] - pa[0])), 1)
    out["lengths"], out["angles"] = lengths, angles
    arms = [(_p(kp, a), _p(kp, b)) for a, b in ((2, 3), (3, 4), (5, 6), (6, 7)) if _p(kp, a) and _p(kp, b)]  # arm bones
    out["joints"] = [list(q) if q else None for q in kp[:14]]
    neck, hip = _p(kp, 1), _mid(_p(kp, 8), _p(kp, 11))
    axis = ((hip[0] - neck[0]) / t, (hip[1] - neck[1]) / t)
    perp_torso = (-axis[1], axis[0])
    widths = {}
    for name, spec, f in WIDTHS:
        samples = []
        if spec == "torso":
            pts = [((neck[0] + f * (hip[0] - neck[0]), neck[1] + f * (hip[1] - neck[1])), perp_torso, None)]
        elif spec == "hips":
            pts = [((hip[0], hip[1] + 0.06 * t), perp_torso, None)]
        else:
            pts = []
            for a, b in spec:
                pa, pb = _p(kp, a), _p(kp, b)
                L = _dist(pa, pb)
                if not L:
                    continue
                d = ((pb[0] - pa[0]) / L, (pb[1] - pa[1]) / L)
                pts.append(((pa[0] + f * (pb[0] - pa[0]), pa[1] + f * (pb[1] - pa[1])), (-d[1], d[0]), L / t))
        arm_contact = False
        other_legs = [q[0] for q in pts] if spec not in ("torso", "hips") else []
        for p, d, bone in pts:
            wpx, sk, ends = _run_width(person, skin, p, d, max_len=0.9 * t)
            if not wpx:
                continue
            # an elbow or hand at the end of the run means the arm is part of the measured width
            if any(_seg_dist(e, a, b) < 0.08 * t for a, b in arms for e in ends):
                arm_contact = True
                continue
            # legs together: the run across one thigh reaches the other leg's centre line → both legs measured
            if any(q is not p and _seg_dist(q, ends[0], ends[1]) < 0.05 * t for q in other_legs):
                arm_contact = True
                continue
            samples.append((wpx / t, sk, bone))
        if samples:
            widths[name] = {
                "w": round(float(np.mean([s[0] for s in samples])), 4),
                "skin": round(float(np.mean([s[1] for s in samples])), 3),
                "bone": round(float(np.mean([s[2] for s in samples])), 4) if samples[0][2] is not None else None,
            }
        elif arm_contact:
            widths[name] = {"arm_contact": True}
    out["widths"] = widths
    return out


def compare(src: Dict, res: Dict, refs: List[Dict], tol_len: float = 0.06, tol_w: float = 0.10, bare: float = 0.6,
            max_view_change: float = 0.15, max_angle: float = 10.0, min_refs: int = 2, footwear_changed: bool = False,
            legs_hidden: bool = False) -> Dict:
    """Did Sienna's body change in the edit? Only compares what is really comparable:

    - leg bone lengths (clothing doesn't change them) against the source image, per limb, only where the limb
      points the same way in both images (a bent or turned limb looks shorter in 2-D); shins are skipped when
      the footwear changed (shoes move the ankle point) and legs are skipped under loose clothing (skirts);
    - widths against the source only where the part is bare skin in both images and no arm touches it;
    - widths of parts the edit uncovered (jeans → bikini) against her approved references, using the RANGE
      over at least `min_refs` references that show that part bare from a similar camera angle — never a
      single photo;
    - nothing when the camera angle / body turn changed.
    Returns {status: ok|warn|insufficient, flags, checked, skipped}.
    """
    report = {"status": "insufficient", "flags": [], "checked": [], "skipped": []}
    skip = lambda part, why: report["skipped"].append({"part": part, "why": why})
    if not (src.get("valid") and res.get("valid")):
        skip("all", "body pose not detected")
        return report
    if not (src.get("view") and res.get("view") and abs(res["view"] / src["view"] - 1) <= max_view_change):
        skip("all", "the camera angle or body turn changed — not comparable")
        return report
    shift = pose_shift(src, res)
    if shift is not None and shift > 0.12:
        skip("all", "the pose changed — not comparable")
        return report
    sw, rw = src.get("widths", {}), res.get("widths", {})
    loose = legs_hidden          # the app knows from the outfit texts when a skirt or dress covers the legs
    for name, v in res.get("lengths", {}).items():
        s, bone = src.get("lengths", {}).get(name), name.rsplit("_", 1)[0]
        if not s:
            continue
        if loose:
            skip(name, "legs hidden under a skirt or dress in one image")
            continue
        if bone == "shin" and footwear_changed:
            skip(name, "footwear changed — shoes move the ankle point")
            continue
        da = abs((res["angles"][name] - src["angles"][name] + 180) % 360 - 180)
        if da > max_angle:
            skip(name, "limb points a different way — length not comparable in 2-D")
            continue
        chg = v / s - 1
        item = {"part": name.replace("_r", " (right)").replace("_l", " (left)") + " length", "change": round(chg, 3), "basis": "source", "tol": tol_len}
        report["checked"].append(item)
        if abs(chg) > tol_len:
            report["flags"].append(item)
    for name, r in rw.items():
        s = sw.get(name)
        if r.get("arm_contact") or (s and s.get("arm_contact")):
            skip(name, "an arm or hand touches this part — width not measurable")
            continue
        if r["skin"] < bare:
            skip(name, "covered by clothing after the edit")
            continue
        if s and "w" in s and s["skin"] >= bare:
            chg = r["w"] / s["w"] - 1
            item = {"part": f"{name} width", "change": round(chg, 3), "basis": "source", "tol": tol_w}
            flagged = abs(chg) > tol_w
        else:
            vals = [ref["widths"][name]["w"] for ref in refs
                    if ref.get("valid") and "w" in ref.get("widths", {}).get(name, {}) and ref["widths"][name]["skin"] >= bare
                    and ref.get("view") and abs(ref["view"] / res["view"] - 1) <= 0.25]
            if len(vals) < min_refs:
                skip(name, f"covered in the original and fewer than {min_refs} approved references show it bare from a similar angle")
                continue
            lo, hi = min(vals) * (1 - tol_w), max(vals) * (1 + tol_w)
            chg = 0.0 if lo <= r["w"] <= hi else (r["w"] / hi - 1 if r["w"] > hi else r["w"] / lo - 1)
            item = {"part": f"{name} width", "change": round(chg, 3), "basis": f"{len(vals)} references", "tol": tol_w,
                    "range": [round(min(vals), 3), round(max(vals), 3)], "value": round(r["w"], 3)}
            flagged = chg != 0.0
        report["checked"].append(item)
        if flagged:
            report["flags"].append(item)
    for f in report["flags"]:
        excess = abs(f["change"]) / f["tol"] if f["basis"] == "source" else 1 + abs(f["change"]) / f["tol"]
        f["severity"] = "likely" if excess > 1.7 else "possible"
    report["status"] = "warn" if report["flags"] else ("ok" if report["checked"] else "insufficient")
    return report


def scene_change(src: np.ndarray, res: np.ndarray) -> float:
    """Mean colour change (0–255) of the outer frame (side strips + top band), where the body rarely is.
    Edits that kept the scene measured 4–22; one that replaced the whole scene with the clothing photo's
    studio measured 57."""
    a = cv2.resize(src[..., :3].astype(np.float32), (64, 96), interpolation=cv2.INTER_AREA)
    b = cv2.resize(res[..., :3].astype(np.float32), (64, 96), interpolation=cv2.INTER_AREA)
    d = np.abs(a - b).mean(-1) * (255.0 if max(a.max(), b.max()) <= 1.5 else 1.0)
    sides = np.concatenate([d[:, :10], d[:, -10:]], 1)
    return round(float((sides.mean() + d[:12].mean()) / 2), 1)


SCENE_CHANGED = 35.0


def keypoints_from_pose(pose_keypoint) -> Tuple[List[Point], int, int]:
    """First person's body points from a DWPose POSE_KEYPOINT entry (pixels), and the canvas size."""
    pose = pose_keypoint[0] if isinstance(pose_keypoint, list) else pose_keypoint
    w, h = int(pose.get("canvas_width") or 0), int(pose.get("canvas_height") or 0)
    people = pose.get("people") or []
    if not people:
        return [], w, h
    return to_points(people[0].get("pose_keypoints_2d"), w, h), w, h


def scale_points(kp: List[Point], sx: float, sy: float) -> List[Point]:
    return [(p[0] * sx, p[1] * sy) if p else None for p in kp]
