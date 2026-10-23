"""Run: python3 -m pytest scripts/comfy_nodes/tests/test_sienna_figure.py"""
import os
import sys

import numpy as np

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "sienna_nodes"))
import sienna_figure as fg  # noqa: E402
from test_sienna_nodes import H, W, standing  # noqa: E402


def silhouette():
    """Her outline: head disc, torso and legs as one blob (hips 240..360 px wide at y 500)."""
    m = np.zeros((H, W), np.float32)
    yy, xx = np.mgrid[:H, :W]
    m[(yy - 120) ** 2 + (xx - 300) ** 2 < 60 ** 2] = 1
    m[180:990, 240:360] = 1
    return m


def test_region_is_the_hip_band_widened_sideways_only():
    kp = standing()
    hard, soft, info = fg.figure_region((H, W), silhouette(), kp)
    assert "skipped" not in info
    ys, xs = np.where(hard > 0.5)
    torso = info["torso"]
    assert ys.min() >= 500 - 0.30 * torso - 1 and ys.max() <= 500 + 0.62 * torso + 1  # waist to the glute fold
    assert ys.min() > 200  # never the chest or face
    g = int(0.06 * torso)
    assert xs.min() >= 240 - g - 1 and xs.max() <= 360 + g + 1  # a little past her outline, no further
    assert xs.min() < 240 and xs.max() > 359  # but it does reach past it (room for a rounder curve)
    assert soft.max() <= 1.0 and (soft[hard > 0.5] > 0.5).mean() > 0.9


def test_hands_and_arms_beside_the_hips_stay_out():
    kp = standing()
    hard, _, _ = fg.figure_region((H, W), silhouette(), kp)
    for wx, wy in (kp[4], kp[7]):  # wrists (225, 518) / (375, 518): the hands hang beside the hips
        assert hard[int(wy) + 10, int(wx)] == 0


def test_face_and_hair_classes_stay_out():
    kp = standing()
    hair = np.zeros((H, W), np.float32)
    hair[380:560, 280:320] = 1  # long hair down the back, over the hip band
    classes = [np.zeros((H, W), np.float32) for _ in range(6)]
    classes[fg.HAIR] = hair
    hard, _, _ = fg.figure_region((H, W), silhouette(), kp, classes)
    assert hard[450, 300] == 0 and hard[600, 300] > 0


def test_no_hips_or_outline_means_nothing_is_redrawn():
    kp = standing()
    kp[8] = kp[11] = None
    hard, soft, info = fg.figure_region((H, W), silhouette(), kp)
    assert info["skipped"] and not hard.any() and not soft.any()
    hard, _, info = fg.figure_region((H, W), None, standing())
    assert info["skipped"] and not hard.any()


def test_color_match_undoes_a_tan_and_a_grey_for_black_shift_inside_the_mask_only():
    src = np.zeros((H, W, 3), np.float32)
    src[..., :] = (0.3, 0.6, 0.8)  # pool
    src[180:990, 240:360] = (0.85, 0.65, 0.55)  # skin
    src[480:800, 240:360] = (0.05, 0.05, 0.06)  # black leggings
    red = src.copy()
    red[420:480, 240:360] = (0.70, 0.50, 0.40)  # darker skin in the region
    red[480:700, 240:360] = (0.45, 0.45, 0.47)  # leggings turned grey in the region
    mask = np.zeros((H, W), np.float32)
    mask[420:700, 200:400] = 1
    z = np.zeros((H, W), np.float32)
    classes = lambda img: [z, z, (img[..., 0] > 0.6).astype(np.float32), z, _clothes(img), z]  # bg, hair, skin, face, clothes, other
    out, info = fg.match_colors(src, red, mask, classes(src), classes(red))
    assert np.abs(out[450, 300] - src[450, 300]).max() < 0.03  # skin back to her own tone
    assert np.abs(out[600, 300] - src[600, 300]).max() < 0.03  # leggings black again
    assert np.array_equal(out[100, 100], red[100, 100]) and np.array_equal(out[900, 300], red[900, 300])  # outside: untouched
    assert set(info) == {"skin", "clothes"}


def _clothes(img):
    return ((img.max(-1) < 0.5) & (np.abs(img[..., 0] - img[..., 2]) < 0.05)).astype(np.float32)


def test_composite_leaves_everything_outside_the_soft_mask_pixel_identical():
    rng = np.random.default_rng(0)
    src = rng.random((H, W, 3)).astype(np.float32)
    red = rng.random((H, W, 3)).astype(np.float32)
    hard, soft, _ = fg.figure_region((H, W), silhouette(), standing())
    out = fg.composite(src, red, soft)
    outside = soft == 0
    assert outside.mean() > 0.7 and np.array_equal(out[outside], src[outside])
    # inside, above the bottom ramp, the redraw is kept; only its local average tone near the edges is corrected
    # (random noise has none to speak of)
    ys = np.where(hard.any(1))[0]
    core = np.zeros((H, W), bool)
    core[ys.min() + 30:ys.max() - int(0.12 * H) - 5] = True
    core &= hard > 0.5
    assert core.any() and float(np.abs(out[core] - red[core]).mean()) < 0.02


def _leggings(tone):
    img = np.zeros((H, W, 3), np.float32)
    img[...] = (0.55, 0.55, 0.55)  # pavement
    img[180:990, 240:360] = tone   # black leggings down the whole leg
    return img


def test_no_tone_step_where_the_redraw_ends_on_black_leggings():
    """Stage A (23 Oct): the redraw's black came out a shade lighter; a plain feather left a line across the thighs."""
    src = _leggings((0.05, 0.05, 0.06))
    red = _leggings((0.11, 0.11, 0.12))  # the redraw's slightly lighter black inside the region
    hard, soft, _ = fg.figure_region((H, W), silhouette(), standing())
    out = fg.composite(src, red, soft)
    col = out[:, 300, 0]
    ys = np.where(hard[:, 300] > 0.5)[0]
    seg = col[ys.min() - 40:ys.max() + 40]
    assert np.abs(np.diff(seg)).max() < 0.004  # no step anywhere down the leg: the change is spread out
    assert abs(col[ys.max() + 30] - 0.05) < 1e-6  # below the region: the original exactly
    plain = (src * (1 - soft[..., None]) + red * soft[..., None])[:, 300, 0]
    assert np.abs(np.diff(plain[ys.min() - 40:ys.max() + 40])).max() > 0.004  # the old paste-back did have one


def test_the_new_shape_survives_the_blend():
    kp = standing()
    kp[3], kp[4], kp[6], kp[7] = (150, 300), (120, 200), (450, 300), (480, 200)  # hands on her head: hips clear
    src = _leggings((0.05, 0.05, 0.06))
    red = src.copy()
    red[480:560, 362:372] = (0.05, 0.05, 0.06)  # the curve now reaches 12 px further out at the side of the butt
    hard, soft, _ = fg.figure_region((H, W), silhouette(), kp)
    out = fg.composite(src, red, soft)
    assert hard[520, 366] > 0.5
    assert out[520, 366, 0] < 0.1  # drawn as leggings, not pavement


def test_a_hand_resting_on_the_hip_stays_out():
    kp = standing()
    kp[3], kp[4] = (250, 380), (262, 520)  # elbow and wrist: the hand rests on her hip, fingers pointing down
    classes = [np.zeros((H, W), np.float32) for _ in range(6)]
    classes[fg.BODY_SKIN][515:600, 245:285] = 1  # the hand's skin
    hard, _, _ = fg.figure_region((H, W), silhouette(), kp, classes)
    assert hard[515:600, 245:285].max() == 0
    assert hard[470, 300] > 0.5  # the rest of the hips still redrawn


def test_outline_change_reports_wider_hips():
    a = silhouette()
    b = a.copy()
    b[450:650, 228:372] = 1  # 12 px wider on each side in the hip band
    r = fg.outline_change(a, b, (450, 650))
    assert r["hip_width_src"] == 119 and abs(r["hip_width_change"] - 24 / 119) < 1e-3
    assert fg.outline_change(a, a, (450, 650))["hip_width_change"] == 0


if __name__ == "__main__":
    for k, v in list(globals().items()):
        if k.startswith("test_"):
            v()
    print("ok")
