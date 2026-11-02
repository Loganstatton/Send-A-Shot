"""Copy Photo: the outfit's and skin's colours taken from the photo itself, not from words.

The keep-scene copy redraws the person from noise with a written description, so colours drift: a purple bikini came
out royal blue, a pale woman under grey light came out deeply bronzed and oily, a white bikini blue-tinted (1 Nov).
Here the photo and the copy are each split into skin and clothes (MediaPipe multiclass selfie segmenter, the same one
the garment redraw uses) and, inside the region where Sienna was drawn, each class's colour (mean and spread in LAB)
is moved: the clothes onto the photo's garment colour; her skin (face and body together) onto Sienna's own skin tone,
never the other woman's (the owner, 1 Nov: "skin color should still be Sienna's skin color"). Shapes and shading stay
the copy's; her features and hair are never touched.

No ComfyUI imports: tested on CPU (tests/test_sienna_nodes.py).
"""
from typing import Dict, List, Optional, Tuple

import cv2
import numpy as np

HAIR, BODY_SKIN, FACE_SKIN, CLOTHES = 1, 2, 3, 4
# how far past the photo's garment (share of the width) the copy's clothes may be recoloured
GARMENT_REACH = 0.05
MIN_PIXELS = 200
# Sienna's skin in OpenCV 8-bit LAB, the median over eight of her accepted copies (bed, gym, mirror, backless, towel,
# implied, two hot tubs; 1 Nov): its hue (a, b) is fixed; its lightness follows the scene's light and is only pulled
# back inside her normal range (a bronzed copy measured L 54, a blue-cast one b 118)
SIENNA_SKIN_AB = (145.0, 150.0)
SIENNA_SKIN_L = (100.0, 165.0)
# Lightness moves at most this far (8-bit LAB): a +35 lift of the skin the segmenter found left the patches it missed
# (her face, a strip of her stomach) as dark smudges, and a -34 drop turned a yellow bikini mustard (1 Nov). Hue is
# what drifts (purple drawn blue, skin bronzed or grey-blue); lightness is the scene's light.
MAX_L_SHIFT = 10.0


def _lab(img: np.ndarray) -> np.ndarray:
    return cv2.cvtColor(np.round(np.clip(img[..., :3], 0, 1) * 255).astype(np.uint8), cv2.COLOR_RGB2LAB).astype(np.float32)


def _robust(px: np.ndarray) -> Tuple[np.ndarray, np.ndarray]:
    """Median and a spread from the 16th-84th percentiles (one sigma for normal data), per LAB channel."""
    lo, med, hi = np.percentile(px, [16, 50, 84], axis=0)
    return med, (hi - lo) / 2 + 1e-3


def copy_colours(photo: np.ndarray, image: np.ndarray, region: np.ndarray, photo_classes: Optional[List[np.ndarray]],
                 image_classes: Optional[List[np.ndarray]], clothes: float = 1.0, skin: float = 0.8,
                 feather: int = 12, photo_region: Optional[np.ndarray] = None, local: float = 0.0) -> Tuple[np.ndarray, Dict]:
    """`image` with its clothes and body-skin colours inside `region` moved onto `photo`'s (float32 RGB 0..1, same
    size). The photo's colours are read only inside `photo_region` (its person): the segmenter called foamy water
    "clothes" and turned a yellow bikini pale blue-white (1 Nov). Statistics are robust (median and spread of the
    middle of each class), so a stray patch can't drag them. Without classes (segmenter missing) the image is returned
    unchanged, with the reason in the report.

    `local` (0..1, source-locked copies, where she lies exactly where the photo's woman did): the clothes' colour is
    also matched place by place, each part of the copy's garment onto the photo's garment round the same spot, and
    every piece of the photo's clothing joined to its garment counts. With one shift for the whole garment a sleeve
    drawn blue stayed bluer than the grey body of the top (cut-out top, 2 Nov)."""
    out = image[..., :3].astype(np.float32).copy()
    if photo_classes is None or image_classes is None:
        return out, {"changed": False, "reason": "segmenter unavailable"}
    m = np.asarray(region, np.float32) > 0.5
    a, b = _lab(photo), _lab(image)
    lab = b.copy()
    weight = np.zeros(m.shape, np.float32)
    info: Dict = {"changed": False}
    # skin is her face and body together, so they stay one tone (a bronzed face on a pale body would look pasted on)
    local_ms = None
    for name, cls, strength in (("clothes", (CLOTHES,), clothes), ("skin", (BODY_SKIN, FACE_SKIN), skin)):
        if strength <= 0:
            continue
        ms = np.logical_or.reduce([photo_classes[c] > 0.5 for c in cls])
        if photo_region is not None:
            pr = np.asarray(photo_region, np.float32) > 0.5
            ms &= pr
            # a tiny garment the segmenter calls skin: the garment mask itself, its edge trimmed off
            if name == "clothes" and ms.sum() < MIN_PIXELS:
                ms = cv2.erode(pr.astype(np.uint8), np.ones((7, 7), np.uint8)) > 0
        mr = m & np.logical_or.reduce([image_classes[c] > 0.5 for c in cls])
        if name == "clothes" and photo_region is not None:
            # only clothes in and near the photo's garment: the segmenter called her legs in bubbling water "clothes" and
            # they were dyed the bikini's green, with a green glow at her hip (hot-tub copy, 2 Nov)
            k = max(3, int(GARMENT_REACH * m.shape[1])) | 1
            garment = np.asarray(photo_region, np.float32) > 0.5
            near = cv2.dilate(garment.astype(np.uint8), np.ones((k, k), np.uint8)) > 0
            local_ms = ms
            if local > 0:
                # the photo's other clothing pieces of the garment's colour (a raised sleeve cut off from the top by her
                # hair), never foam or a towel of another colour; the copy's arm may sit a little off, so they reach
                # further
                extra = _same_garment(photo_classes[CLOTHES] > 0.5, garment, a)
                if extra.any():
                    near |= cv2.dilate(extra.astype(np.uint8), np.ones((2 * k + 1, 2 * k + 1), np.uint8)) > 0
                    local_ms = ms | extra
                    info["garment_pieces_added"] = int(extra.sum())
            mr &= near
        if name == "clothes" and ms.any() and mr.any():
            # closeness to the photo: how much the copy's garment overlaps the photo's (intersection over union)
            info["garment_iou"] = round(float((ms & mr).sum()) / float((ms | mr).sum()), 3)
        if (name != "skin" and ms.sum() < MIN_PIXELS) or mr.sum() < MIN_PIXELS:
            info[name] = {"skipped": f"too few pixels (photo {int(ms.sum())}, copy {int(mr.sum())})"}
            continue
        mu_r, sd_r = _robust(b[mr])
        if name == "skin":  # Sienna's own tone, in this scene's light
            mu_s = np.array([np.clip(mu_r[0], *SIENNA_SKIN_L), *SIENNA_SKIN_AB], np.float32)
            scale = np.ones(3, np.float32)
        else:
            mu_s, sd_s = _robust(a[ms])
            scale = np.clip(sd_s / sd_r, 0.6, 1.6)
            scale[0] = 1.0  # lightness spread stays the copy's: its folds and shading
        shift = mu_s - mu_r
        shift[0] = float(np.clip(shift[0], -MAX_L_SHIFT, MAX_L_SHIFT))
        mu_s = mu_r + shift
        lab[mr] = (b[mr] - mu_r) * scale + mu_s
        if name == "clothes" and local > 0:
            # place by place: the copy's garment hue moved onto the photo's garment hue round the same spot (a sleeve
            # drawn blue on a grey top, 2 Nov), its own shading and texture kept; where the photo has no garment near
            # (her arm sits a little elsewhere) each separate piece is moved onto the photo garment's overall hue
            local_lab, reach = _local_hue(a, b, local_ms if photo_region is not None else ms, mr, mu_s, float(local))
            lab = np.where(reach[..., None], local_lab, lab)
            weight = np.maximum(weight, np.where(reach, strength, 0).astype(np.float32))
            info["clothes_local"] = round(float(local), 2)
        weight[mr] = strength
        info[name] = {"shift_lab": [round(float(x), 1) for x in (mu_s - mu_r)], "pixels": int(mr.sum()), "strength": strength}
        info["changed"] = True
    if not info["changed"]:
        return out, info
    rgb = cv2.cvtColor(np.round(np.clip(lab, 0, 255)).astype(np.uint8), cv2.COLOR_LAB2RGB).astype(np.float32) / 255.0
    if feather > 0:  # no hard edge where a class ends (cup edge, skin by the hair)
        k = 2 * feather + 1
        weight = cv2.GaussianBlur(weight, (k, k), feather / 2)
    # never her hair: the feathered skin shift bled orange into the strands round her face (red-tinted hair, 2 Nov)
    hair = (np.asarray(image_classes[HAIR], np.float32) > 0.5).astype(np.float32)
    weight = weight * (1 - cv2.GaussianBlur(hair, (0, 0), 1.5))
    w = np.clip(weight, 0, 1)[..., None]
    return np.clip(out * (1 - w) + rgb * w, 0, 1).astype(np.float32), info


# a clothing piece within this hue distance (8-bit LAB a, b) of the garment, and this lightness (shade: a raised sleeve
# in shadow measured L 113 against the top's 150), is the same garment
SAME_GARMENT_DE = 8.0
SAME_GARMENT_DL = 50.0
SAME_GARMENT_SIZE = 1.5  # ... and no bigger than this many times the garment (foam, a duvet)


def _same_garment(clothes: np.ndarray, garment: np.ndarray, lab: np.ndarray) -> np.ndarray:
    """The pieces of the segmenter's `clothes` outside the garment finder's `garment` that are the garment's colour."""
    gpx = garment & clothes
    if gpx.sum() < MIN_PIXELS:
        return np.zeros_like(clothes)
    ref = np.median(lab[gpx], axis=0)
    rest = clothes & ~(cv2.dilate(garment.astype(np.uint8), np.ones((5, 5), np.uint8)) > 0)
    n, comp = cv2.connectedComponents(rest.astype(np.uint8), connectivity=8)
    out = np.zeros_like(clothes)
    for i in range(1, n):
        sel = comp == i
        size = int(sel.sum())
        if size < MIN_PIXELS or size > SAME_GARMENT_SIZE * gpx.sum():
            continue
        d = np.median(lab[sel], axis=0) - ref
        if float(np.hypot(d[1], d[2])) <= SAME_GARMENT_DE and abs(float(d[0])) <= SAME_GARMENT_DL:
            out |= sel
    return out


LOCAL_SIGMA = 0.05    # the neighbourhood a local hue is read over (share of the width)
LOCAL_MIN = 0.12      # how much of that neighbourhood must be garment for its hue to count
LOCAL_EDGE = 0.006    # the copy's garment grown by this share of the width: its soft edge is recoloured too (the
                      # per-piece version left a blue fringe round the sleeves, 2 Nov)


def _local_hue(a: np.ndarray, b: np.ndarray, ms: np.ndarray, mr: np.ndarray, target: np.ndarray, local: float):
    """LAB image with the copy's garment hue (a, b) moved onto the photo's, place by place, and the grown garment
    region it applies to. Lightness is untouched (folds, shading)."""
    h, w = mr.shape
    sig = max(2.0, LOCAL_SIGMA * w)
    blur = lambda x: cv2.GaussianBlur(x.astype(np.float32), (0, 0), sig)
    wp, wr = blur(ms), blur(mr)
    k = max(3, int(LOCAL_EDGE * w)) | 1
    reach = cv2.dilate(mr.astype(np.uint8), np.ones((k, k), np.uint8)) > 0
    # each piece's own hue, for the places the photo has no garment near
    n, comp = cv2.connectedComponents(reach.astype(np.uint8), connectivity=8)
    piece = np.zeros((h, w, 2), np.float32)
    for i in range(1, n):
        sel = comp == i
        core = sel & mr
        src = b[core] if core.sum() >= MIN_PIXELS else b[sel]
        piece[sel] = np.median(src[:, 1:], axis=0)
    out = b.copy()
    conf = np.clip(np.minimum(wp, wr) / LOCAL_MIN, 0, 1)
    for c in (1, 2):
        photo_local = blur(a[..., c] * ms) / np.maximum(wp, 1e-4)
        copy_local = blur(b[..., c] * mr) / np.maximum(wr, 1e-4)
        local_shift = photo_local - copy_local
        piece_shift = target[c] - piece[..., c - 1]
        shift = conf * local_shift + (1 - conf) * piece_shift
        out[..., c] = np.where(reach, b[..., c] + local * shift, b[..., c])
    return out, reach


def fill_gaps(img: np.ndarray, gap: np.ndarray, avoid: np.ndarray, scale: float = 0.5) -> np.ndarray:
    """Where the photo's person was but Sienna isn't (`gap`), the scene continued from the background round it: the
    redraw invented things there (a green rail by her thigh, water where the tub's edge was, 1 Nov). Filled by Telea
    inpainting from background pixels only (Sienna, `avoid`, is never a source), at half size for speed, softened, and
    pasted into the gap alone. A light diffusion pass afterwards gives it texture."""
    g = np.asarray(gap, np.float32) > 0.5
    if not g.any():
        return img[..., :3].astype(np.float32)
    h, w = g.shape
    hole = (g | (np.asarray(avoid, np.float32) > 0.5)).astype(np.uint8)
    sw, sh = max(8, int(w * scale)), max(8, int(h * scale))
    f8 = cv2.resize(np.clip(np.round(img[..., :3] * 255), 0, 255).astype(np.uint8), (sw, sh), interpolation=cv2.INTER_AREA)
    m8 = (cv2.resize(hole, (sw, sh), interpolation=cv2.INTER_NEAREST) > 0).astype(np.uint8)
    filled = cv2.inpaint(f8, m8, 7, cv2.INPAINT_TELEA)
    filled = cv2.GaussianBlur(filled, (0, 0), 2)
    filled = cv2.resize(filled, (w, h), interpolation=cv2.INTER_LINEAR).astype(np.float32) / 255
    wgt = cv2.GaussianBlur(g.astype(np.float32), (0, 0), 2)[..., None]
    wgt = np.where(g[..., None], 1.0, wgt) * (1 - (np.asarray(avoid, np.float32)[..., None] > 0.5))
    out = img[..., :3].astype(np.float32)
    return np.clip(out * (1 - wgt) + filled * wgt, 0, 1).astype(np.float32)


# ── run in its own process ────────────────────────────────────────────────────
# The segmenter (MediaPipe) ran inside ComfyUI's process; three times on 1 Nov ComfyUI died mid-copy (every call a
# 502 while the pod kept running). A crash or hang in its own process can only skip the colour step.
ISOLATED_TIMEOUT = 120


def copy_colours_isolated(photo: np.ndarray, image: np.ndarray, region: np.ndarray, photo_region: Optional[np.ndarray],
                          clothes: float, skin: float, timeout: float = ISOLATED_TIMEOUT, local: float = 0.0) -> Tuple[np.ndarray, Dict]:
    """copy_colours with the segmentation and the colour moves in a child process; on a crash, stall or error the
    image comes back unchanged and the report says why."""
    import json
    import os
    import subprocess
    import sys
    import tempfile

    out = image[..., :3].astype(np.float32)
    with tempfile.TemporaryDirectory(prefix="sienna_cc_") as td:
        inp, res = os.path.join(td, "in.npz"), os.path.join(td, "out.npz")
        arrays = {"photo": photo[..., :3].astype(np.float32), "image": out, "region": np.asarray(region, np.float32)}
        if photo_region is not None:
            arrays["photo_region"] = np.asarray(photo_region, np.float32)
        np.savez(inp, params=np.array(json.dumps({"clothes": clothes, "skin": skin, "local": local})), **arrays)
        log = os.path.join(td, "worker.log")
        with open(log, "w") as f:
            p = subprocess.Popen([sys.executable, os.path.abspath(__file__), inp, res], stdout=f, stderr=f, start_new_session=True)
            try:
                rc = p.wait(timeout=timeout)
            except subprocess.TimeoutExpired:
                try:
                    os.killpg(p.pid, 9)
                except OSError:
                    p.kill()
                return out, {"changed": False, "error": f"colour step timed out after {timeout:.0f}s"}
        tail = open(log, errors="replace").read()[-400:]
        if rc != 0 or not os.path.exists(res):
            return out, {"changed": False, "error": f"colour step failed (exit {rc})", "worker_log": tail}
        r = np.load(res, allow_pickle=False)
        return r["image"].astype(np.float32), json.loads(str(r["info"]))


def _main(inp: str, res: str) -> None:
    import json
    import os
    import sys

    sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
    from sienna_redraw import segment_classes, segmenter_error

    d = np.load(inp, allow_pickle=False)
    params = json.loads(str(d["params"]))
    photo, image = d["photo"], d["image"]
    pc, ic = segment_classes(photo), segment_classes(image)
    out, info = copy_colours(photo, image, d["region"], pc, ic, float(params["clothes"]), float(params["skin"]),
                             photo_region=d["photo_region"] if "photo_region" in d.files else None,
                             local=float(params.get("local", 0.0)))
    if pc is None or ic is None:
        info["segmenter_error"] = segmenter_error()
    np.savez(res, image=out.astype(np.float32), info=np.array(json.dumps(info)))


if __name__ == "__main__":
    import sys

    _main(sys.argv[1], sys.argv[2])
