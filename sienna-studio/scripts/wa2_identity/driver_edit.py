"""Local (CPU) driver editing for WA2 identity pairs.

align_driver: rotate / scale / shift the WHOLE driver image so her head tilt, face size and face position match the
  target. Content is unchanged, so this cannot add Sienna information.
transfer_expression: move the driver's own face-mesh points by the target's *expression change* and warp her pixels.
  The change is measured in 3D after rigid alignment as (target - neutral Sienna photo), so Sienna's face shape cancels
  and only mouth/cheek/eye/brow movement transfers. The driver keeps her own skin, eyes, hair and face shape.
  Limits: it can't create pixels that aren't there (teeth / mouth interior for a closed-mouth source), and it does not
  change head yaw or pitch. Those need a generative step on the GPU (see README).
"""
import numpy as np
import cv2

# Landmarks that do not move with expression (forehead, nose bridge/tip, eye corners, temples, cheekbone edge)
RIGID = [10, 151, 9, 8, 168, 6, 197, 195, 5, 4, 1, 33, 133, 263, 362, 127, 356, 234, 454, 21, 251, 162, 389]


def similarity(src, dst, scale=True):
    """Least-squares similarity (Umeyama) mapping src -> dst, any dimension. Returns s, R, t with dst ~ s R src + t."""
    src, dst = np.asarray(src, float), np.asarray(dst, float)
    ms, md = src.mean(0), dst.mean(0); a, b = src - ms, dst - md
    U, S, Vt = np.linalg.svd(b.T @ a / len(src)); d = np.ones(len(S))
    if np.linalg.det(U @ Vt) < 0: d[-1] = -1
    R = U @ np.diag(d) @ Vt; s = (S * d).sum() / a.var(0).sum() if scale else 1.0
    return s, R, md - s * R @ ms


def align_driver(t_prof, d_prof, d_img, out_size):
    """Similarity on the 2D rigid landmarks (rotation + uniform scale + shift) mapping the driver face onto the
    target face; returns the warped driver (target canvas size) and the 2x3 matrix."""
    s, R, t = similarity(np.array(d_prof['lm'])[RIGID], np.array(t_prof['lm'])[RIGID])
    M = np.hstack([s * R, t[:, None]])
    W, H = out_size
    return cv2.warpAffine(d_img, M, (W, H), flags=cv2.INTER_CUBIC, borderMode=cv2.BORDER_REFLECT_101), M


def expression_delta(t_lm3, n_lm3):
    """Target expression change in the target's own 3D frame: target - (neutral Sienna rigidly aligned onto target)."""
    T, N = np.asarray(t_lm3, float), np.asarray(n_lm3, float)
    s, R, t = similarity(N[RIGID], T[RIGID])
    return T - (s * (R @ N.T).T + t), T


MOUTH_C, CHIN, TOP = 13, 152, 10


def region_weights(lm3, radius=0.5):
    """Smooth weight per landmark: 1 around the mouth, falling to 0 at `radius` x face height (eyes/brows excluded)."""
    L = np.asarray(lm3, float)[:, :2]; fh = np.linalg.norm(L[TOP] - L[CHIN])
    r = np.linalg.norm(L - (L[13] + L[14]) / 2, axis=1) / fh
    return np.clip(1 - (r / radius) ** 2, 0, 1)


def transfer_expression(d_img, d_lm3, t_lm3, n_lm3, strength=1.0, mouth_only=True, radius=0.5):
    """Warp the driver so her mesh = her own mesh + the target's expression change (rotated/scaled into her frame).
    mouth_only: keep only the mouth/cheek part of the change and remove its net sideways shift, so pose differences between
    the target and the neutral photo (which leak in through MediaPipe's depth estimates) don't turn the head."""
    delta, T = expression_delta(t_lm3, n_lm3)
    if mouth_only:
        w = region_weights(t_lm3, radius)[:, None]; delta = delta * w
        delta[:, 0] -= (delta[:, 0] * w[:, 0]).sum() / max(w.sum(), 1e-6) * w[:, 0]   # remove net sideways shift (yaw leak); keep the vertical lift of a smile
    D = np.asarray(d_lm3, float)
    s, R, _ = similarity(T[RIGID], D[RIGID])            # target frame -> driver frame (rotation + scale only)
    D2 = D + strength * s * (R @ delta.T).T
    src, dst = D[:, :2], D2[:, :2]
    return piecewise_warp(d_img, src, dst), dst


def piecewise_warp(img, src, dst, ring=1.6):
    """Move src points to dst with a piecewise-affine warp (inverse mapping, so no seams). A fixed ring of anchors
    around the face plus the image corners keep everything outside the face untouched. Only the face's bounding
    region is resampled."""
    from skimage.transform import PiecewiseAffineTransform, warp
    H, W = img.shape[:2]
    c = src.mean(0); r = np.max(np.linalg.norm(src - c, axis=1)) * ring
    anchors = np.array([c + r * np.array([np.cos(t), np.sin(t)]) for t in np.linspace(0, 2 * np.pi, 32, endpoint=False)])
    x0, y0 = [int(max(0, v)) for v in anchors.min(0)]; x1, y1 = int(min(W, anchors[:, 0].max())), int(min(H, anchors[:, 1].max()))
    corners = np.array([[x0, y0], [x1 - 1, y0], [x0, y1 - 1], [x1 - 1, y1 - 1]], float)
    S = np.vstack([src, anchors, corners]) - [x0, y0]; D = np.vstack([dst, anchors, corners]) - [x0, y0]
    if hasattr(PiecewiseAffineTransform, 'from_estimate'):     # output coords -> input coords
        t = PiecewiseAffineTransform.from_estimate(D, S)
    else:
        t = PiecewiseAffineTransform(); t.estimate(D, S)
    roi = img[y0:y1, x0:x1].astype(np.float32) / 255
    out = img.copy(); w = warp(roi, t, output_shape=roi.shape[:2], order=1, mode='edge')
    # outside the anchor ring the transform is undefined (NaN/zeros): keep the original there
    ring_mask = np.zeros(roi.shape[:2], np.uint8); cv2.fillPoly(ring_mask, [np.int32(anchors - [x0, y0])], 1)
    out[y0:y1, x0:x1][ring_mask > 0] = (np.clip(w, 0, 1) * 255).astype(np.uint8)[ring_mask > 0]
    return out


def recolor_hair(img, hair_mask, lab_target, feather=7, refine=None):
    """Recolour the DRIVER's hair (segmenter class 1) to another colour, keeping its texture: hair pixels get the
    target mean L*a*b* plus their own deviation from their mean (L scaled to the new brightness)."""
    hard = cv2.resize(hair_mask.astype(np.uint8), (img.shape[1], img.shape[0]), interpolation=cv2.INTER_LINEAR)
    # the segmenter mask is coarse (256 px): keep only pixels whose colour is close to the hair's own colour,
    # so background/skin inside the coarse mask is not recoloured (that caused a glowing halo)
    lab0 = cv2.cvtColor(img, cv2.COLOR_BGR2LAB).astype(np.float32); core0 = cv2.erode(hard, np.ones((9, 9), np.uint8)) > 0
    ref = np.median(lab0[core0 if core0.sum() > 100 else hard > 0], 0)
    close = (np.abs(lab0[..., 1] - ref[1]) < 10) & (np.abs(lab0[..., 2] - ref[2]) < 12) & (np.abs(lab0[..., 0] - ref[0]) < 55)
    if refine is None: refine = lab_target[0] > ref[0]       # lightening shows every stray pixel; darkening doesn't
    core = ((hard > 0) & close) if refine else cv2.erode(hard, np.ones((5, 5), np.uint8)) > 0
    core = cv2.morphologyEx(core.astype(np.uint8), cv2.MORPH_OPEN, np.ones((3, 3), np.uint8))
    m = cv2.GaussianBlur(core.astype(np.float32), (5, 5) if refine else (feather * 2 + 1, feather * 2 + 1), 0) * hard
    m = m[..., None]
    lab = cv2.cvtColor(img, cv2.COLOR_BGR2LAB).astype(np.float32); sel = m[..., 0] > 0.5
    mu = lab[sel].mean(0); tgt = np.array(lab_target, np.float32)
    new = lab.copy(); new[..., 0] = tgt[0] + (lab[..., 0] - mu[0]) * (tgt[0] + 20) / (mu[0] + 20)
    new[..., 1:] = tgt[1:] + (lab[..., 1:] - mu[1:]) * 0.5
    out = cv2.cvtColor(np.clip(new, 0, 255).astype(np.uint8), cv2.COLOR_LAB2BGR).astype(np.float32)
    return (img * (1 - m) + out * m).astype(np.uint8)


def paired_crop(t_img, d_aligned, M, d_shape, face_box, aspect=528 / 768):
    """Largest crop of the given aspect (width/height), around the target face, inside which the aligned driver has
    real pixels (no padding). Crops target and driver identically so they stay aligned. Returns (t, d, box) or None."""
    H, W = t_img.shape[:2]
    valid = cv2.warpAffine(np.ones(d_shape[:2], np.uint8), M, (W, H), flags=cv2.INTER_NEAREST, borderValue=0)
    ii = cv2.integral(valid)
    cx, cy = (face_box[0] + face_box[2]) / 2, (face_box[1] + face_box[3]) / 2
    for h in range(H, 64, -8):
        w = int(h * aspect)
        if w > W: continue
        for dy in np.linspace(0, 1, 9):          # try vertical placements (face in the upper part preferred)
            y0 = int(np.clip(cy - h * (0.25 + 0.5 * dy), 0, H - h)); x0 = int(np.clip(cx - w / 2, 0, W - w))
            s = ii[y0 + h, x0 + w] - ii[y0, x0 + w] - ii[y0 + h, x0] + ii[y0, x0]
            if s == w * h and face_box[0] >= x0 and face_box[2] <= x0 + w and face_box[1] >= y0 and face_box[3] <= y0 + h:
                return t_img[y0:y0 + h, x0:x0 + w], d_aligned[y0:y0 + h, x0:x0 + w], (x0, y0, w, h)
    return None
