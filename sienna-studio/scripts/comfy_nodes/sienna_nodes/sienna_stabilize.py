"""
Lock Camera: tripod-lock stabilization for generated videos (no ComfyUI imports; unit-tested).

Wan sometimes lets the "camera" drift (a slow tilt, pan or push) even when asked for a fixed camera. This removes that
drift so the background stays where it is in the first frame:

  1. Track the background only. Her body (person mask from the segmenter, dilated) is excluded, so her own movement
     never counts as camera movement. Every frame is matched directly to frame 0 (SIFT, ORB if SIFT is missing) and a
     similarity transform (uniform scale + rotation + shift) is fitted with RANSAC; frames that can't be matched to
     frame 0 are chained through the previous frame.
  2. Map each frame back onto frame 0's view with that transform. It is one rigid move of the whole frame: no
     shear and no local warping, so her proportions and anatomy cannot change. Nothing is cropped or zoomed; the
     thin strip at the frame edge that a moved frame no longer covers is filled from the previous locked frame, with a
     soft seam that never blends over her. A light sharpen, measured per video, offsets the resampling softness.
  3. Safety checks; if any fails the original video is kept (status "rejected" + reason):
       camera already steady (nothing to fix)          → "steady", original kept
       movement too large (an intentional camera move,  → rejected: locking it would need big filled edges
         or more than can be locked without cropping)
       she touches an edge that would need filling      → rejected: part of her would be cut off or smeared
       part of her moved outside the frame              → rejected (body cut off)
       filled edge > 10% of the frame / visible seam    → rejected
       sharpness of her body < 85% of the original      → rejected
       background still moves after locking             → rejected (unstable background, e.g. strong parallax):
         up to 2 px always passes; above that it must be ≤ 1% of the short side and ≤ 35% of the original drift

Frame count, order and timing are never changed: frame i of the output is frame i of the input, moved.
"""

import math
import time
from typing import Dict, List, Optional, Sequence, Tuple

import cv2
import numpy as np

LIMITS = {
    "steady_px": 1.5,       # largest corner movement (px) still counted as a steady camera
    "steady_frac": 0.005,   # ...or this share of the frame's short side (≈2.4 px at 480p), whichever is larger
    "max_move": 0.08,       # corner movement above this share of the frame (per axis) = intentional move / too much
    "max_scale": 0.05,      # zoom change above 5% = intentional push/pull
    "max_rot": 3.0,         # degrees
    "min_inliers": 12,      # background matches needed to trust a frame's transform
    "max_fill": 0.10,       # filled edge strip, share of the frame
    "max_body_lost": 0.002, # share of her body that may leave the frame (0.2%)
    "max_seam": 1.8,        # edge texture vs nearby background (gradient ratio); above = visible seam
    "min_seam": 0.35,       # below = smeared / stretched fill
    "min_sharp": 0.85,      # her body's sharpness vs the original
    "max_residual_px": 2.0,      # background movement left after locking that always passes (measurement noise ≈ 1 px)
    "max_residual_frac": 0.01,   # above that: at most 1% of the short side (invisible on a phone)...
    "max_residual_share": 0.35,  # ...and at most 35% of the original drift (the lock must clearly help)
}
ANALYSIS_SIDE = 640  # tracking runs on frames scaled to this long side (transforms are scaled back)


# ── helpers ──────────────────────────────────────────────────────────────────

def _odd(v: float) -> int:
    k = max(3, int(round(v)))
    return k if k % 2 else k + 1


def compose(a: np.ndarray, b: np.ndarray) -> np.ndarray:
    """a ∘ b for 2×3 affine matrices (apply b, then a)."""
    A = np.vstack([a, [0, 0, 1]])
    B = np.vstack([b, [0, 0, 1]])
    return (A @ B)[:2]


def decompose(m: np.ndarray) -> Dict[str, float]:
    return {"scale": float(math.hypot(m[0, 0], m[1, 0])), "rot": float(math.degrees(math.atan2(m[1, 0], m[0, 0]))), "tx": float(m[0, 2]), "ty": float(m[1, 2])}


def corner_motion(m: np.ndarray, w: int, h: int) -> Tuple[float, float, float]:
    """Largest movement of the frame's corners under m: (pixels, share of width in x, share of height in y)."""
    c = np.float32([[0, 0], [w, 0], [0, h], [w, h]])
    d = c @ m[:, :2].T + m[:, 2] - c
    return float(np.linalg.norm(d, axis=1).max()), float(np.abs(d[:, 0]).max() / w), float(np.abs(d[:, 1]).max() / h)


def _detector():
    try:
        return cv2.SIFT_create(4000), cv2.NORM_L2, "sift"
    except Exception:
        return cv2.ORB_create(4000), cv2.NORM_HAMMING, "orb"


def _features(det, gray: np.ndarray, mask: np.ndarray):
    kp, de = det.detectAndCompute(gray, mask.astype(np.uint8) * 255)
    return kp, de


def _match(det_norm, kp_a, de_a, kp_b, de_b, thr: float):
    """Similarity transform mapping points of a onto b, or (None, 0)."""
    if de_a is None or de_b is None or len(kp_a) < 8 or len(kp_b) < 8:
        return None, 0
    bf = cv2.BFMatcher(det_norm)
    pairs = bf.knnMatch(de_a, de_b, k=2)
    good = [p[0] for p in pairs if len(p) == 2 and p[0].distance < 0.75 * p[1].distance]
    if len(good) < 8:
        return None, 0
    src = np.float32([kp_a[g.queryIdx].pt for g in good])
    dst = np.float32([kp_b[g.trainIdx].pt for g in good])
    m, inl = cv2.estimateAffinePartial2D(src, dst, method=cv2.RANSAC, ransacReprojThreshold=thr, maxIters=4000, confidence=0.999)
    if m is None:
        return None, 0
    return m, int(inl.sum())


def background_masks(person: Sequence[np.ndarray], w: int, h: int) -> List[np.ndarray]:
    """Background = not her, with a safety ring (≈3.5% of the long side) so her outline never counts."""
    k = np.ones((_odd(0.035 * max(w, h)),) * 2, np.uint8)
    return [cv2.dilate(p.astype(np.uint8), k) == 0 for p in person]


# ── tracking ─────────────────────────────────────────────────────────────────

def track(frames: np.ndarray, background: Sequence[np.ndarray], min_inliers: int = LIMITS["min_inliers"]):
    """Per-frame similarity transforms mapping frame i onto frame 0 (full-resolution pixels), inlier counts, the
    detector used and whether every frame could be tracked."""
    n, h, w = frames.shape[:3]
    s = min(1.0, ANALYSIS_SIDE / max(h, w))
    det, norm, name = _detector()
    grays, feats = [], []
    for i in range(n):
        g = cv2.cvtColor(frames[i], cv2.COLOR_RGB2GRAY)
        msk = background[i]
        if s < 1:
            g = cv2.resize(g, (round(w * s), round(h * s)), interpolation=cv2.INTER_AREA)
            msk = cv2.resize(msk.astype(np.uint8), (g.shape[1], g.shape[0]), interpolation=cv2.INTER_NEAREST) > 0
        grays.append(g)
        feats.append(_features(det, g, msk))
    T = [np.eye(2, 3)]  # at analysis scale
    inliers = [0]
    ok = True
    for i in range(1, n):
        m, k = _match(norm, *feats[i], *feats[0], thr=1.5)
        if m is None or k < min_inliers:
            # chain through the previous frame (large occlusion, or the far background changed)
            b, k = _match(norm, *feats[i], *feats[i - 1], thr=1.5)
            if b is None or k < min_inliers:
                ok = False
                m, k = T[-1].copy(), 0
            else:
                m = compose(T[-1], b)
        T.append(np.asarray(m, np.float64))
        inliers.append(k)
    T = _repair(T, feats, norm, round(w * s), round(h * s), min_inliers)
    full = np.array(T, dtype=np.float64)
    full[:, :, 2] /= s  # same rotation/scale; shifts back to full-resolution pixels
    return full, inliers, name, ok


def _params(m: np.ndarray) -> np.ndarray:
    d = decompose(m)
    return np.array([d["scale"], math.radians(d["rot"]), d["tx"], d["ty"]])


def _matrix(p: np.ndarray) -> np.ndarray:
    s, r, tx, ty = p
    return np.array([[s * math.cos(r), -s * math.sin(r), tx], [s * math.sin(r), s * math.cos(r), ty]])


def _gap(a: np.ndarray, b: np.ndarray, w: int, h: int) -> float:
    """Largest distance between where two transforms put the frame's corners (px)."""
    c = np.float32([[0, 0], [w, 0], [0, h], [w, h]])
    return float(np.linalg.norm((c @ a[:, :2].T + a[:, 2]) - (c @ b[:, :2].T + b[:, 2]), axis=1).max())


def _repair(T: List[np.ndarray], feats, norm, w: int, h: int, min_inliers: int) -> List[np.ndarray]:
    """A single bad fit (matches mixing near and far ground) shows as one frame that disagrees with its neighbours.
    Such a frame is measured again independently, through the previous and the next frame: if that agrees with the
    neighbours, the direct fit was wrong and is replaced; if it agrees with the direct fit, the movement is real
    (e.g. handheld shake) and is kept."""
    n = len(T)
    if n < 5:
        return T
    P = np.array([_params(m) for m in T])
    thr = max(1.5, 0.002 * min(w, h))
    out = list(T)
    for i in range(1, n):
        lo, hi = max(0, i - 2), min(n, i + 3)
        med = _matrix(np.median(P[lo:hi], axis=0))
        if _gap(T[i], med, w, h) <= thr:
            continue
        alts = []
        for j in (i - 1, i + 1):
            if 0 <= j < n and j != i:
                b, k = _match(norm, *feats[i], *feats[j], thr=1.5)
                if b is not None and k >= min_inliers:
                    alts.append(compose(T[j], b))
        if any(_gap(a, T[i], w, h) <= thr for a in alts):
            continue  # independent measurement confirms the direct fit: real movement
        agree = [a for a in alts if _gap(a, med, w, h) <= 2 * thr]
        if agree:
            out[i] = agree[0]
    return out


def drift(T: np.ndarray, w: int, h: int) -> Dict[str, float]:
    px, fx, fy = zip(*(corner_motion(m, w, h) for m in T))
    d = [decompose(m) for m in T]
    return {
        "max_px": round(max(px), 2),
        "max_x_pct": round(100 * max(fx), 2),
        "max_y_pct": round(100 * max(fy), 2),
        "max_zoom_pct": round(100 * max(abs(x["scale"] - 1) for x in d), 2),
        "max_rot_deg": round(max(abs(x["rot"]) for x in d), 2),
    }


# ── locking ──────────────────────────────────────────────────────────────────

def _sharpness(img: np.ndarray, mask: np.ndarray) -> float:
    if mask.sum() < 50:
        return 0.0
    lap = cv2.Laplacian(cv2.cvtColor(img, cv2.COLOR_RGB2GRAY), cv2.CV_64F)
    return float(lap[mask].var())


def _sharpen(img: np.ndarray, amount: float) -> np.ndarray:
    if amount <= 0:
        return img
    f = img.astype(np.float32)
    return np.clip(f * (1 + amount) - cv2.GaussianBlur(f, (0, 0), 0.7) * amount, 0, 255).astype(np.uint8)


def _seam_ratio(out: np.ndarray, hole: np.ndarray, band_px: int) -> Optional[float]:
    """Edge texture where the fill meets the frame vs the background just inside it (1 = indistinguishable)."""
    if hole.sum() < 20:
        return None
    g = cv2.cvtColor(out, cv2.COLOR_RGB2GRAY).astype(np.float32)
    grad = np.hypot(cv2.Sobel(g, cv2.CV_32F, 1, 0, ksize=3), cv2.Sobel(g, cv2.CV_32F, 0, 1, ksize=3))
    k = np.ones((3, 3), np.uint8)
    edge = (cv2.dilate(hole.astype(np.uint8), k, iterations=band_px) > 0) & ~hole  # the seam zone on the frame side
    edge |= hole & ~(cv2.erode(hole.astype(np.uint8), k, iterations=2) > 0)
    ref = (cv2.dilate(hole.astype(np.uint8), k, iterations=band_px * 3) > 0) & ~(cv2.dilate(hole.astype(np.uint8), k, iterations=band_px) > 0)
    if edge.sum() < 20 or ref.sum() < 20:
        return None
    return float((grad[edge].mean() + 1.0) / (grad[ref].mean() + 1.0))


def lock_camera(frames: np.ndarray, person: Optional[Sequence[np.ndarray]], limits: Optional[Dict] = None):
    """frames: uint8 RGB [N,H,W,3]; person: bool masks [N][H,W] (None = segmenter unavailable).
    Returns (frames to use, report). The input is returned unchanged unless the report's status is "applied"."""
    L = {**LIMITS, **(limits or {})}
    t0 = time.time()
    n, h, w = frames.shape[:3]
    rep: Dict = {"status": "rejected", "frames": int(n), "size": [int(w), int(h)]}

    def done(status: str, reason: str, out=frames):
        rep.update(status=status, reason=reason, ms=int((time.time() - t0) * 1000))
        return out, rep

    if n < 8:
        return done("rejected", "the video is too short to measure the camera")
    if person is None:
        return done("unavailable", "her outline could not be found (segmenter unavailable), so the background can't be told apart from her")
    person = [np.asarray(p, bool) for p in person]
    if np.mean([p.mean() for p in person]) > 0.7:
        return done("rejected", "she fills almost the whole frame, so there is too little background to lock")

    bg = background_masks(person, w, h)
    T, inliers, method, ok = track(frames, bg, L["min_inliers"])
    rep["method"] = method
    rep["inliers_min"] = int(min(inliers[1:]) if n > 1 else 0)
    before = drift(T, w, h)
    rep["before"] = before
    if not ok:
        return done("rejected", "the background couldn't be tracked in every frame (too little texture or too much of it hidden)")

    steady = max(L["steady_px"], L["steady_frac"] * min(w, h))
    if before["max_px"] <= steady:
        return done("steady", "the camera is already steady; nothing to correct")
    if before["max_x_pct"] > 100 * L["max_move"] or before["max_y_pct"] > 100 * L["max_move"]:
        return done("rejected", "the camera moves a lot (looks intentional, e.g. a pan or follow); locking it would need large filled edges")
    if before["max_zoom_pct"] > 100 * L["max_scale"]:
        return done("rejected", "the camera zooms or pushes in a lot (looks intentional); locking it would need large filled edges")
    if before["max_rot_deg"] > L["max_rot"]:
        return done("rejected", "the camera rotates too much to lock without large filled edges")

    # ── warp + fill ──
    k3 = np.ones((3, 3), np.uint8)
    band = max(4, int(round(0.018 * max(w, h))))  # soft seam width (≈15 px at 832)
    pad = int(round(0.25 * max(w, h)))
    full = np.full((h, w), 255, np.uint8)
    warped, holes, pmask, lost = [], [], [], []
    for i in range(n):
        m = T[i]
        warped.append(cv2.warpAffine(frames[i], m, (w, h), flags=cv2.INTER_LANCZOS4, borderMode=cv2.BORDER_REPLICATE))
        valid = cv2.warpAffine(full, m, (w, h), flags=cv2.INTER_NEAREST, borderValue=0) > 0
        holes.append(~(cv2.erode(valid.astype(np.uint8), np.ones((5, 5), np.uint8)) > 0))
        p8 = person[i].astype(np.uint8)
        pmask.append(cv2.warpAffine(p8, m, (w, h), flags=cv2.INTER_NEAREST) > 0)
        # how much of her lands outside the frame (warp into a padded canvas)
        mp = m.copy()
        mp[:, 2] += pad
        big = cv2.warpAffine(p8, mp, (w + 2 * pad, h + 2 * pad), flags=cv2.INTER_NEAREST) > 0
        inside = big[pad:pad + h, pad:pad + w].sum()
        lost.append(float((big.sum() - inside) / max(1, big.sum())))
    rep["fill_pct"] = round(100 * max(hh.mean() for hh in holes), 2)
    rep["body_lost_pct"] = round(100 * max(lost), 3)
    if max(lost) > L["max_body_lost"]:
        return done("rejected", "locking would push part of her body out of the frame")
    if max(hh.mean() for hh in holes) > L["max_fill"]:
        return done("rejected", f"locking would need {rep['fill_pct']}% of the frame filled at the edges (limit {100 * L['max_fill']:.0f}%)")

    raw: List[np.ndarray] = []
    out_person = []  # where she is in each locked frame (including any filled-in pixels)
    seams = []
    for i in range(n):
        img = warped[i].astype(np.float32)
        hole = holes[i]
        near_her = cv2.dilate(pmask[i].astype(np.uint8), k3, iterations=3) > 0
        if i > 0 and hole.any():
            if (hole & near_her).any() or (hole & out_person[-1]).any():
                return done("rejected", "she is at the frame edge where the locked frame needs filling; that part of her would be cut off or smeared")
            a = cv2.GaussianBlur(cv2.dilate(hole.astype(np.uint8), np.ones((band, band), np.uint8)).astype(np.float32), (0, 0), band / 2)
            a = np.maximum(a, hole.astype(np.float32))
            a[near_her & ~hole] = 0  # the soft seam never blends over her
            img = img * (1 - a[..., None]) + raw[-1] * a[..., None]
            out_person.append(pmask[i] | (out_person[-1] & hole))
        else:
            out_person.append(pmask[i])
        raw.append(img)

    # sharpness: pick the light sharpen that brings her back to the original (measured on up to 8 frames)
    idx = sorted(set(np.linspace(0, n - 1, min(8, n)).round().astype(int).tolist()))
    er = [cv2.erode(person[i].astype(np.uint8), k3, iterations=2) > 0 for i in idx]
    erw = [cv2.erode(out_person[i].astype(np.uint8), k3, iterations=2) > 0 for i in idx]
    s_in = sum(_sharpness(frames[i], e) for i, e in zip(idx, er))
    best, best_amt = None, 0.0
    for amt in (0.0, 0.05, 0.1, 0.15, 0.2, 0.25, 0.3):
        s_out = sum(_sharpness(_sharpen(np.clip(raw[i], 0, 255).astype(np.uint8), amt), e) for i, e in zip(idx, erw))
        r = s_out / max(1e-6, s_in)
        if best is None or abs(r - 1) < abs(best - 1):
            best, best_amt = r, amt
        if r >= 1.0:
            break
    rep["sharpen"] = best_amt
    rep["sharpness_ratio"] = round(float(best), 3) if best is not None else None
    if best is not None and best < L["min_sharp"]:
        return done("rejected", f"the locked video would be noticeably softer ({best:.0%} of the original sharpness)")
    out = np.stack([_sharpen(np.clip(r, 0, 255).astype(np.uint8), best_amt) for r in raw])

    # seams: texture where the fill meets the frame vs the background next to it
    for i in range(1, n):
        if holes[i].any():
            s = _seam_ratio(out[i], holes[i], band)
            if s is not None:
                seams.append(s)
    rep["seam_ratio"] = round(float(max(seams)), 2) if seams else None
    if seams and max(seams) > L["max_seam"]:
        return done("rejected", "the filled edge would show a visible seam")
    if seams and min(seams) < L["min_seam"]:
        return done("rejected", "the filled edge would look smeared")

    # verify: the background of the locked video must now hold still
    T2, _, _, ok2 = track(out, background_masks(out_person, w, h), L["min_inliers"])
    after = drift(T2, w, h)
    rep["after"] = after
    small = after["max_px"] <= L["max_residual_px"]
    good = after["max_px"] <= L["max_residual_frac"] * min(w, h) and after["max_px"] <= L["max_residual_share"] * before["max_px"]
    if not ok2 or not (small or good):
        return done("rejected", f"the background still moves after locking ({after['max_px']} px; likely depth/parallax the lock can't remove)")
    return done("applied", "camera locked", out)
