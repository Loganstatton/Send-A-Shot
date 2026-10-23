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
    inside = soft == 1
    assert inside.any() and np.allclose(out[inside], red[inside])


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
