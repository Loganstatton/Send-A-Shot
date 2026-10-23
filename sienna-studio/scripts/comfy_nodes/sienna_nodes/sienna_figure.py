"""Targeted figure pass (test only): redraw just her hips and butt, keep everything else pixel-identical.

A figure LoRA on the whole photo (Glute Goddess 0.55-0.7, 23 Oct) gave the fuller shape but also changed the leggings'
colour, darkened her skin, moved the background and widened her hips. Here the photo is made as usual, then only a
region around the pelvis is resampled with the figure LoRA, its colours are matched back to the original per class
(skin to skin, clothes to clothes) and it is pasted back with a feathered edge.

Region = her silhouette between the waist and the glute fold (from the DWPose hips and knees), widened a little
past the outline so the curve can grow outward, minus face, hair, hands and the arms beside her hips.
No ComfyUI imports: tested on CPU (tests/test_sienna_figure.py).
"""
import json
import os
import subprocess
import sys
import tempfile
import time
from typing import Dict, List, Optional, Sequence, Tuple

import cv2
import numpy as np

Point = Optional[Tuple[float, float]]
NOSE, NECK, R_SH, R_EL, R_WR, L_SH, L_EL, L_WR, R_HIP, R_KNEE, R_ANK, L_HIP, L_KNEE = 0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12
R_EYE, L_EYE = 14, 15
HAIR, BODY_SKIN, FACE_SKIN, CLOTHES = 1, 2, 3, 4


def _p(kp: Sequence[Point], i: int) -> Point:
    return kp[i] if kp is not None and i < len(kp) else None


def _mid(a: Point, b: Point) -> Point:
    if a and b:
        return ((a[0] + b[0]) / 2, (a[1] + b[1]) / 2)
    return a or b


def _disk(r: float) -> np.ndarray:
    r = max(1, int(r))
    return cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (2 * r + 1, 2 * r + 1))


def facing_camera(kp: Sequence[Point]) -> bool:
    """She faces the camera: nose and both eyes found and her right shoulder on the image's left (OpenPose labels
    the person's own sides). A "from behind" request came out facing the camera (Stage B, string bikini s202) and
    the pass redrew the front of her bikini bottoms; the view in the photo decides, not the request's wording."""
    rs, ls = _p(kp, R_SH), _p(kp, L_SH)
    if not (_p(kp, NOSE) and _p(kp, R_EYE) and _p(kp, L_EYE) and rs and ls):
        return False
    rh, lh = _p(kp, R_HIP), _p(kp, L_HIP)
    hips_front = rh[0] < lh[0] if rh and lh else True
    return rs[0] < ls[0] and hips_front


def figure_region(
    shape: Tuple[int, int],
    person: Optional[np.ndarray],
    kp: Sequence[Point],
    classes: Optional[List[np.ndarray]] = None,
    face_mask: Optional[np.ndarray] = None,
    top: float = 0.30,
    bottom: float = 0.90,
    grow: float = 0.06,
    feather_frac: float = 0.012,
) -> Tuple[np.ndarray, np.ndarray, Dict]:
    """(hard mask for sampling, feathered mask for the paste-back, info). Band from `top` x torso above the hips to
    `bottom` x torso below them (or 95% of the way to the knees, whichever is higher) — below the gluteal fold, so the
    paste-back's fade to the original lies on the thighs and the fold is drawn in full; widened by `grow` x torso
    past her outline on each side. Empty (and info["skipped"]) when the hips or her outline aren't found."""
    h, w = shape
    info: Dict = {"top": top, "bottom": bottom, "grow": grow}
    if facing_camera(kp):
        info["skipped"] = "front view in the photo: her butt is not in it, nothing redrawn"
        empty = np.zeros((h, w), np.float32)
        return empty, empty, info
    hips = (_p(kp, R_HIP), _p(kp, L_HIP))
    hip = _mid(*hips)
    shoulder = _mid(_p(kp, R_SH), _p(kp, L_SH)) or _p(kp, NECK)
    person_m = (np.asarray(person) > 0.5) if person is not None else None
    empty = np.zeros((h, w), np.float32)
    if not hip or not shoulder or person_m is None or not person_m.any():
        info["skipped"] = "hips or her outline not found"
        return empty, empty, info
    torso = float(np.hypot(hip[0] - shoulder[0], hip[1] - shoulder[1]))
    knee = _mid(_p(kp, R_KNEE), _p(kp, L_KNEE))
    y0 = hip[1] - top * torso
    y1 = hip[1] + bottom * torso
    if knee:
        y1 = min(y1, hip[1] + 0.95 * (knee[1] - hip[1]))
    band = np.zeros((h, w), bool)
    band[max(0, int(y0)):max(0, min(h, int(y1)))] = True
    # columns: her outline in the band, widened sideways only (not up or down)
    body = person_m & band
    if not body.any():
        info["skipped"] = "no body in the hip band"
        return empty, empty, info
    g = max(1, int(grow * torso))
    wide = cv2.dilate(body.astype(np.uint8), cv2.getStructuringElement(cv2.MORPH_RECT, (2 * g + 1, 1))) > 0
    region = wide & band
    # never: face, hair, hands, the arms hanging beside her hips (bare arms keep their shape and skin)
    keep_out = np.zeros((h, w), bool)
    if face_mask is not None:
        keep_out |= cv2.dilate((np.asarray(face_mask) > 0.5).astype(np.uint8), _disk(0.02 * h)) > 0
    if classes:
        keep_out |= classes[FACE_SKIN] > 0.5
        keep_out |= classes[HAIR] > 0.4
    arms = np.zeros((h, w), np.uint8)
    for a, b in ((R_EL, R_WR), (L_EL, L_WR), (R_SH, R_EL), (L_SH, L_EL)):
        pa, pb = _p(kp, a), _p(kp, b)
        if pa and pb:
            cv2.line(arms, (int(pa[0]), int(pa[1])), (int(pb[0]), int(pb[1])), 1, max(1, int(0.15 * torso)))
    # hands: a wide disc past the wrist toward the fingertips (a hand resting on her hip came out smeared at denoise
    # 0.7, 23 Oct), plus any bare skin of that hand the segmenter sees around it
    hands = np.zeros((h, w), np.uint8)
    for el, wr in ((_p(kp, R_EL), _p(kp, R_WR)), (_p(kp, L_EL), _p(kp, L_WR))):
        if wr:
            dx, dy = (wr[0] - el[0], wr[1] - el[1]) if el else (0.0, 1.0)
            n = max(1e-3, float(np.hypot(dx, dy)))
            c = (int(wr[0] + dx / n * 0.10 * torso), int(wr[1] + dy / n * 0.10 * torso))
            cv2.circle(hands, c, int(0.17 * torso), 1, -1)
    if classes and hands.any():
        near = cv2.dilate(hands, _disk(0.06 * torso)) > 0
        hands |= ((classes[BODY_SKIN] > 0.5) & near).astype(np.uint8)
    keep_out |= (arms > 0) | (cv2.dilate(hands, _disk(0.015 * h)) > 0)
    hard = region & ~keep_out
    hard = cv2.morphologyEx(hard.astype(np.uint8), cv2.MORPH_OPEN, _disk(0.004 * h)) > 0
    soft = cv2.GaussianBlur(hard.astype(np.float32), (0, 0), max(1.0, feather_frac * h))
    soft = np.clip(soft * 1.6, 0, 1) * (cv2.dilate(hard.astype(np.uint8), _disk(feather_frac * h)) > 0)
    info.update(mask=round(float(hard.mean()), 4), band=[int(y0), int(y1)], torso=round(torso, 1))
    return hard.astype(np.float32), soft.astype(np.float32), info


def _arm_mask(shape: Tuple[int, int], kp: Sequence[Point], torso: float, width: float) -> np.ndarray:
    """Her arms (shoulder-elbow-wrist lines `width` x torso thick) and hands (a disc past each wrist)."""
    m = np.zeros(shape, np.uint8)
    for a, b in ((R_SH, R_EL), (R_EL, R_WR), (L_SH, L_EL), (L_EL, L_WR)):
        pa, pb = _p(kp, a), _p(kp, b)
        if pa and pb:
            cv2.line(m, (int(pa[0]), int(pa[1])), (int(pb[0]), int(pb[1])), 1, max(1, int(width * torso)))
    for el, wr in ((_p(kp, R_EL), _p(kp, R_WR)), (_p(kp, L_EL), _p(kp, L_WR))):
        if wr:
            dx, dy = (wr[0] - el[0], wr[1] - el[1]) if el else (0.0, 1.0)
            n = max(1e-3, float(np.hypot(dx, dy)))
            cv2.circle(m, (int(wr[0] + dx / n * 0.08 * torso), int(wr[1] + dy / n * 0.08 * torso)), int(0.11 * torso), 1, -1)
    return m > 0


def enlarge(img: np.ndarray, kp: Sequence[Point], person: Optional[np.ndarray], classes: Optional[List[np.ndarray]],
            amount: float) -> Tuple[np.ndarray, Optional[np.ndarray], Dict]:
    """Her butt made bigger by reshaping the photo before the redraw (the redraw alone kept her outline: hip width
    +0% in every "fuller" photo, and the change didn't show at normal size, 23 Oct). Two smooth "bloat" fields, one
    per cheek, centred low on the cheeks (fullest at the lower cheeks): nothing above her waist moves, the effect
    fades out down the thighs. `amount` 0.20 = "medium" (picked by the owner from offline previews, 23 Oct).
    Her arms and hands are in front of her hips: they are put back unmoved on top. Returns (image, person mask
    reshaped the same way, info); unchanged when the photo faces the camera or her hips aren't found."""
    h, w = img.shape[:2]
    info: Dict = {"amount": amount}
    hip = _mid(_p(kp, R_HIP), _p(kp, L_HIP))
    shoulder = _mid(_p(kp, R_SH), _p(kp, L_SH)) or _p(kp, NECK)
    if amount <= 0 or facing_camera(kp) or not hip or not shoulder:
        info["skipped"] = "front view or hips not found" if amount > 0 else "off"
        return img, person, info
    torso = float(np.hypot(hip[0] - shoulder[0], hip[1] - shoulder[1]))
    top, crease = hip[1] - 0.17 * torso, hip[1] + 0.35 * torso  # her waist and the fold under her cheeks
    arms = _arm_mask((h, w), kp, torso, 0.15)
    # her width at the cheeks: the outline's run through her midline, arms taken out; else from the hip joints
    W = 0.0
    hips_apart = abs(_p(kp, R_HIP)[0] - _p(kp, L_HIP)[0]) if _p(kp, R_HIP) and _p(kp, L_HIP) else 0.0
    if person is not None:
        y = int(min(h - 1, hip[1] + 0.12 * torso))
        row = (np.asarray(person)[y] > 0.5) & ~arms[y]
        x = int(np.clip(hip[0], 0, w - 1))
        if row[x]:
            l = r = x
            while l > 0 and row[l - 1]:
                l -= 1
            while r < w - 1 and row[r + 1]:
                r += 1
            W = float(r - l)
    if not (1.6 * hips_apart <= W <= 3.2 * hips_apart) and hips_apart:
        W = 2.3 * hips_apart
    if W < 0.05 * w:
        info["skipped"] = "her width at the hips not found"
        return img, person, info
    yy, xx = np.mgrid[:h, :w].astype(np.float32)
    cy = top + 0.62 * (crease - top)
    up, down = cy - top, (crease - cy) + 0.55 * (crease - top)
    dx, dy = np.zeros_like(xx), np.zeros_like(yy)
    for side in (-1, 1):
        cx = hip[0] + side * 0.25 * W
        ry = np.where(yy < cy, up, down)
        f = np.clip(1 - ((xx - cx) / (0.62 * W)) ** 2 - ((yy - cy) / ry) ** 2, 0, None) ** 2
        dx += amount * f * (xx - cx)
        dy += amount * f * (yy - cy) * np.where(yy > cy, 1.0, 0.6)
    mx, my = xx - dx, yy - dy
    out = cv2.remap(np.ascontiguousarray(img, np.float32), mx, my, cv2.INTER_CUBIC, borderMode=cv2.BORDER_REFLECT)
    pout = None
    if person is not None:
        pout = cv2.remap(np.ascontiguousarray(person, np.float32), mx, my, cv2.INTER_LINEAR, borderMode=cv2.BORDER_REFLECT)
    # arms and hands back on top, unmoved: their own pixels (skin or sleeve) near the pose lines
    near = _arm_mask((h, w), kp, torso, 0.11)
    if classes:
        near &= (classes[BODY_SKIN] > 0.5) | (classes[CLOTHES] > 0.5)
    elif person is not None:
        near &= np.asarray(person) > 0.5
    a = cv2.GaussianBlur(near.astype(np.float32), (0, 0), 1.5)[..., None]
    out = np.clip(out * (1 - a) + np.asarray(img, np.float32) * a, 0, 1)
    if pout is not None:
        pout = np.maximum(pout, near.astype(np.float32))
    info.update(width=round(W, 1), torso=round(torso, 1), band=[int(top), int(crease)])
    if person is not None and pout is not None:
        info.update(outline_change(person, pout, (int(top), int(crease))))
    return out.astype(np.float32), pout, info


def _lab(img: np.ndarray) -> np.ndarray:
    return cv2.cvtColor((np.clip(img[..., :3], 0, 1) * 255).astype(np.uint8), cv2.COLOR_RGB2LAB).astype(np.float32)


def match_colors(src: np.ndarray, red: np.ndarray, mask: np.ndarray, src_classes: Optional[List[np.ndarray]],
                 red_classes: Optional[List[np.ndarray]], strength: float = 1.0) -> Tuple[np.ndarray, Dict]:
    """The redrawn image with each class's colour inside the mask (skin, clothes) shifted to the original's mean and
    spread there. Shape is untouched; a figure LoRA's tan or a grey-for-black garment shift is undone. Images are
    float32 RGB 0..1. Without classes the whole mask is matched as one region."""
    m = np.asarray(mask) > 0.5
    a, b = _lab(src), _lab(red)
    out = b.copy()
    info: Dict = {}
    groups = [("all", m, m)]
    if src_classes and red_classes:
        groups = [(name, m & (src_classes[c] > 0.5), m & (red_classes[c] > 0.5)) for name, c in (("skin", BODY_SKIN), ("clothes", CLOTHES))]
    for name, ms, mr in groups:
        if ms.sum() < 200 or mr.sum() < 200:
            continue
        mu_s, sd_s = a[ms].mean(0), a[ms].std(0) + 1e-3
        mu_r, sd_r = b[mr].mean(0), b[mr].std(0) + 1e-3
        scale = np.clip(sd_s / sd_r, 0.6, 1.6)
        shifted = (b[mr] - mu_r) * scale + mu_s
        out[mr] = b[mr] + strength * (shifted - b[mr])
        info[name] = [round(float(x), 1) for x in (mu_s - mu_r)]
    rgb = cv2.cvtColor(np.clip(out, 0, 255).astype(np.uint8), cv2.COLOR_LAB2RGB).astype(np.float32) / 255.0
    # pixels with no class match keep the redrawn colours exactly
    res = red[..., :3].copy()
    changed = np.zeros(m.shape, bool)
    for _, _, mr in groups:
        changed |= mr
    res[changed] = rgb[changed]
    return res.astype(np.float32), info


def composite(src: np.ndarray, red: np.ndarray, soft: np.ndarray, tone_sigma: float = 0.02, tone_fade: float = 0.075,
              ramp: float = 0.12, content_change: float = 0.1) -> np.ndarray:
    """The redrawn region pasted into the original without a visible edge (a plain feather left a straight tone step
    across both thighs in every Stage A photo, 23 Oct):
      1. tone: the redraw's low-frequency difference from the original, measured in a band just inside the edge, is
         removed at the edge and faded out over `tone_fade` x height toward the inside; pixels whose content changed
         (more than `content_change`, e.g. the new curve over old background) are left out of the measurement;
      2. bottom edge (mid-thigh): a long vertical ramp, `ramp` x height, back to the original instead of a ~15 px feather.
    Pixels outside the feathered mask are the original's exactly."""
    s = np.clip(np.asarray(soft, np.float32), 0, 1)
    src3, red3 = src[..., :3].astype(np.float32), red[..., :3].astype(np.float32)
    hard = s > 0.5
    if not hard.any():
        return src3.copy()
    h, w = s.shape
    used = s > 1e-3  # every pixel the paste-back touches, the feathered rim included
    d = red3 - src3
    # only where the content is the same and just the tone drifted (a new curve over old background is a real change,
    # not a tone error — correcting it would leave a halo around the new outline)
    same = used & (np.abs(d).max(-1) < content_change)
    # the tone correction is low-frequency by design, so it is measured and smoothed at 1/8 size (small kernels only;
    # the full-size version stalled on the GPU machine, 23 Oct) and the correction is scaled back up
    k = 8
    sw, sh = max(8, w // k), max(8, h // k)
    small = lambda a: cv2.resize(np.ascontiguousarray(a, np.float32), (sw, sh), interpolation=cv2.INTER_AREA)
    used_s = small(used.astype(np.float32)) > 0.5
    inner_s = cv2.erode(used_s.astype(np.uint8), _disk(0.04 * sh)) > 0
    band_s = (used_s & ~inner_s).astype(np.float32)
    same_s = small(same.astype(np.float32)) * band_s
    diff_s = small(np.where(same[..., None], d, 0)) * band_s[..., None]
    sig = max(1.0, tone_sigma * sh)
    wsum = cv2.GaussianBlur(same_s, (0, 0), sig) + 1e-4
    low_s = cv2.GaussianBlur(diff_s, (0, 0), sig) / wsum[..., None]
    dist_s = cv2.distanceTransform(used_s.astype(np.uint8), cv2.DIST_L2, 3)
    fade_s = np.clip(1 - dist_s / max(1.0, tone_fade * sh), 0, 1) * used_s
    corr = cv2.resize(np.ascontiguousarray(low_s * fade_s[..., None], np.float32), (w, h), interpolation=cv2.INTER_LINEAR)
    red2 = red3 - corr * used[..., None]
    # top (waist) and bottom (mid-thigh) edges: ramps back to the original; the bottom one long, as tested offline
    ys = np.where(used.any(1))[0]
    top, bot = int(ys.min()), int(ys.max())
    r = np.zeros(h, np.float32)
    y_top = min(bot, top + int(0.04 * h))
    y_bot = max(y_top, bot - int(ramp * h))
    r[top:y_top] = np.linspace(0, 1, y_top - top, endpoint=False)
    r[y_top:y_bot] = 1
    r[y_bot:bot + 1] = np.linspace(1, 0, bot + 1 - y_bot)
    wgt = (s * r[:, None])[..., None]
    return np.clip(src3 * (1 - wgt) + red2 * wgt, 0, 1).astype(np.float32)


def outline_change(src_person: np.ndarray, res_person: np.ndarray, band: Sequence[int]) -> Dict:
    """How much wider her outline got in the hip band (left-to-right extent per row, median): a hip-widening guard."""
    y0, y1 = int(band[0]), int(band[1])
    widths = []
    for m in (np.asarray(src_person) > 0.5, np.asarray(res_person) > 0.5):
        rows = []
        for y in range(max(0, y0), min(m.shape[0], y1)):
            xs = np.where(m[y])[0]
            if xs.size:
                rows.append(xs.max() - xs.min())
        widths.append(float(np.median(rows)) if rows else 0.0)
    return {"hip_width_src": widths[0], "hip_width_res": widths[1],
            "hip_width_change": round((widths[1] - widths[0]) / widths[0], 4) if widths[0] else None}


WORKER = os.path.join(os.path.dirname(os.path.abspath(__file__)), "sienna_figure_worker.py")
MASK_TIMEOUT = 60
COMPOSITE_TIMEOUT = 90


def log(msg: str) -> None:
    print(f"[SiennaFigure] {time.strftime('%H:%M:%S')} {msg}", flush=True)


def run_isolated(task: str, arrays: Dict[str, np.ndarray], params: Dict, timeout: float) -> Tuple[Optional[Dict[str, np.ndarray]], Dict]:
    """Runs one step in sienna_figure_worker.py as a separate process and kills it after `timeout` seconds: a stalled
    step (two did on the GPU machine, 23 Oct) can't hold up the photo. Returns (arrays, info) or (None, {"error": ...})."""
    t0 = time.time()
    log(f"{task}: start (timeout {timeout:.0f}s)")
    with tempfile.TemporaryDirectory(prefix="sienna_fig_") as td:
        inp, out = os.path.join(td, "in.npz"), os.path.join(td, "out.npz")
        np.savez(inp, task=np.array(task), params=np.array(json.dumps(params)), **{k: v for k, v in arrays.items() if v is not None})
        err = os.path.join(td, "worker.log")
        with open(err, "w") as f:
            # own process group, output to a file (no pipes to block on): a timeout kills everything it started
            p = subprocess.Popen([sys.executable, WORKER, inp, out], stdout=f, stderr=f, start_new_session=True)
            try:
                rc = p.wait(timeout=timeout)
            except subprocess.TimeoutExpired:
                try:
                    os.killpg(p.pid, 9)
                except OSError:
                    p.kill()
                try:
                    p.wait(timeout=10)
                except subprocess.TimeoutExpired:
                    pass
                rc = None
        tail = open(err, errors="replace").read()[-600:]
        if rc is None:
            log(f"{task}: TIMED OUT after {timeout:.0f}s, worker killed. Last worker output: {tail.strip()[-300:]}")
            return None, {"error": f"{task} timed out after {timeout:.0f}s", "worker_log": tail}
        for line in tail.strip().splitlines()[-12:]:
            log(f"{task}: {line}")
        if rc != 0 or not os.path.exists(out):
            log(f"{task}: FAILED (exit {rc})")
            return None, {"error": f"{task} failed (exit {rc})", "worker_log": tail}
        res = np.load(out, allow_pickle=False)
        info = json.loads(str(res["info"]))
        result = {k: res[k] for k in res.files if k != "info"}
    info["seconds"] = round(time.time() - t0, 2)
    log(f"{task}: done in {info['seconds']:.2f}s")
    return result, info
