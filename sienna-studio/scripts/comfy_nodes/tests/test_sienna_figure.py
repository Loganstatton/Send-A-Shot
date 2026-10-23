"""Run: python3 -m pytest scripts/comfy_nodes/tests/test_sienna_figure.py"""
import os
import sys

import cv2
import numpy as np

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "sienna_nodes"))
import sienna_figure as fg  # noqa: E402
from test_sienna_nodes import H, W, standing as standing_front  # noqa: E402


def standing(long_legs=1.0):
    """The test skeleton seen from behind: no face points, her right side on the image's right."""
    pts = standing_front(long_legs)
    pts[0] = pts[14] = pts[15] = pts[16] = pts[17] = None
    for a, b in ((2, 5), (3, 6), (4, 7), (8, 11), (9, 12), (10, 13)):
        pts[a], pts[b] = pts[b], pts[a]
    return pts


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
    assert ys.min() >= 500 - 0.30 * torso - 1 and ys.max() <= 500 + 0.90 * torso + 1  # waist to below the glute fold
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


def test_a_photo_that_came_out_facing_the_camera_is_left_alone():
    hard, soft, info = fg.figure_region((H, W), silhouette(), standing_front())
    assert "front view" in info["skipped"] and not hard.any() and not soft.any()
    assert fg.facing_camera(standing_front()) and not fg.facing_camera(standing())


def test_looking_back_over_her_shoulder_is_not_a_front_view():
    """Seen from behind, face in profile over her shoulder, and the pose model labelled her shoulders and hips as if
    she faced the camera (crop top + denim shorts s202, 23 Oct): still a rear photo."""
    kp = standing_front()  # front-view labels (right shoulder on the image's left)...
    sh = abs(kp[2][0] - kp[5][0])
    kp[0] = (kp[2][0] - 0.05 * sh, 110)  # ...but the face is a profile: nose past the eyes, eyes close together
    kp[14], kp[15] = (kp[2][0] + 0.02 * sh, 100), (kp[2][0] + 0.08 * sh, 100)
    assert not fg.facing_camera(kp)
    hard, _, info = fg.figure_region((H, W), silhouette(), kp)
    assert "skipped" not in info and hard.any()
    out, _, einfo = fg.enlarge(_skin_photo(), kp, silhouette(), None, 0.20)
    assert "skipped" not in einfo


def _bent():
    """Bent over, seen from behind: torso running off to the left at hip height, legs straight down."""
    kp = standing()
    kp[2], kp[5], kp[1] = (100, 470), (110, 560), (105, 515)  # shoulders level with the hips, to the left
    kp[3], kp[4], kp[6], kp[7] = (90, 600), (90, 700), (120, 640), (125, 740)  # arms hanging down
    kp[8], kp[11] = (330, 500), (270, 500)  # hip joints on the cheeks
    m = np.zeros((H, W), np.float32)
    m[470:560, 80:300] = 1  # torso
    m[430:990, 240:360] = 1  # butt and legs
    return kp, m


def test_bent_over_is_sized_from_her_width_at_the_hips():
    kp, m = _bent()
    f = fg.bent_frame((H, W), m, kp)
    assert f is not None and 110 <= f["W"] <= 125  # the cheek side (~60 px each way of the cleft), not the torso
    assert fg.bent_frame((H, W), silhouette(), standing()) is None  # upright: the standing geometry
    hard, _, info = fg.figure_region((H, W), m, kp)
    assert info.get("bent") and hard[520, 330] > 0 and not hard[100:400].any()  # the cheeks, not her back or head
    img = np.zeros((H, W, 3), np.float32)
    img[...] = (0.3, 0.6, 0.8)
    img[m > 0.5] = (0.85, 0.65, 0.55)
    out, person, einfo = fg.enlarge(img, kp, m, None, 0.20)
    assert einfo["bent"] and "skipped" not in einfo
    y = int(f["cy"])
    assert np.where(person[y, 300:] > 0.5)[0].max() > np.where(m[y, 300:] > 0.5)[0].max() + 5  # her outline grew outward
    assert np.abs(out[:350] - img[:350]).max() < 1e-5  # nothing well above her hips moves


def test_the_region_reaches_below_the_glute_fold():
    hard, _, info = fg.figure_region((H, W), silhouette(), standing(long_legs=1.3))  # real proportions: knees ~1.07 torso below the hips
    ys = np.where(hard.any(1))[0]
    fold = 500 + 0.45 * info["torso"]  # the crease under the buttocks sits about this far below the hip joints
    assert ys.max() - fold > 0.12 * H  # the paste-back's bottom fade (12% of the height) lies below it


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


def _skin_photo():
    img = np.zeros((H, W, 3), np.float32)
    img[...] = (0.3, 0.6, 0.8)  # pool
    img[silhouette() > 0.5] = (0.85, 0.65, 0.55)  # her
    img[480:600, 240:360] = (0.05, 0.05, 0.06)  # bikini bottoms
    return img


def test_enlarge_makes_her_butt_wider_and_leaves_her_waist_and_upper_body_alone():
    kp = standing()
    kp[3], kp[4], kp[6], kp[7] = (150, 300), (120, 200), (450, 300), (480, 200)  # hands on her head: hips clear
    img = _skin_photo()
    out, person, info = fg.enlarge(img, kp, silhouette(), None, 0.20)
    lo, hi = info["band"]
    assert info["hip_width_change"] > 0.03  # visibly wider at the cheeks (medium: +4-6% on real photos)
    row = lambda m, y: np.where(m[y] > 0.5)[0]
    y = int(lo + 0.62 * (hi - lo))  # the fullest part: low on the cheeks
    assert row(person, y).size >= row(silhouette(), y).size + 6  # 128 vs 120 px here
    assert np.abs(out[:lo - 1] - img[:lo - 1]).max() < 1e-5  # nothing above her waist moves (float rounding only)
    assert np.abs(out[960:] - img[960:]).max() < 0.02  # below mid-thigh: back to the photo as made


def test_enlarge_puts_her_arms_and_hands_back_unmoved():
    kp = standing()  # hands hanging beside her hips
    img = _skin_photo()
    for a, b in ((kp[3], kp[4]), (kp[6], kp[7])):
        cv2.line(img, tuple(map(int, a)), tuple(map(int, b)), (0.9, 0.7, 0.6), 18)
    person = np.maximum(silhouette(), (np.abs(img - (0.9, 0.7, 0.6)).max(-1) < 0.01).astype(np.float32))
    out, _, _ = fg.enlarge(img, kp, person, None, 0.20)
    for wx, wy in (kp[4], kp[7]):
        assert np.abs(out[int(wy) - 20, int(wx)] - img[int(wy) - 20, int(wx)]).max() < 0.02


def test_enlarge_does_nothing_on_a_front_view_or_when_off():
    img = _skin_photo()
    out, _, info = fg.enlarge(img, standing_front(), silhouette(), None, 0.20)
    assert out is img and "skipped" in info
    out, _, info = fg.enlarge(img, standing(), silhouette(), None, 0.0)
    assert out is img and info["skipped"] == "off"


def test_the_mask_step_returns_the_reshaped_photo_when_asked():
    kp = [[float(p[0]), float(p[1])] if p else None for p in standing()]
    img = _skin_photo()
    res, info = fg.run_isolated("mask", {"image": img, "person": silhouette()}, {"kp": kp, "grow": 0.2, "enlarge": 0.2}, timeout=60)
    assert res is not None, info
    assert not np.array_equal(res["image"], img) and info["enlarge"]["hip_width_change"] > 0.03
    res, info = fg.run_isolated("mask", {"image": img, "person": silhouette()}, {"kp": kp, "grow": 0.08}, timeout=60)
    assert np.array_equal(res["image"], img) and "enlarge" not in info


def test_a_stalled_step_is_killed_on_time_and_reported():
    import time
    t = time.time()
    res, info = fg.run_isolated("sleep", {}, {"seconds": 30}, timeout=2)
    assert res is None and "timed out after 2s" in info["error"]
    assert time.time() - t < 15  # killed, not waited out


def test_a_crashing_step_is_reported_not_raised():
    res, info = fg.run_isolated("no-such-task", {}, {}, timeout=30)
    assert res is None and "failed" in info["error"]


def test_mask_and_composite_run_in_the_worker_process():
    kp = standing()
    img = _leggings((0.05, 0.05, 0.06))
    res, info = fg.run_isolated("mask", {"image": img, "person": silhouette()},
                                {"kp": [[float(p[0]), float(p[1])] if p else None for p in kp[:14]], "grow": 0.08}, timeout=60)
    assert res is not None, info
    hard, soft = res["hard"], res["soft"]
    want, _, _ = fg.figure_region((H, W), silhouette(), kp[:14], None, None, grow=0.08)
    assert np.array_equal(hard, want) and "timing" in info
    red = _leggings((0.11, 0.11, 0.12))
    res2, info2 = fg.run_isolated("composite", {"src": img, "red": red, "hard": hard, "soft": soft}, {"color_match": 1.0}, timeout=60)
    assert res2 is not None, info2
    out = res2["image"]
    assert out.shape == img.shape and np.array_equal(out[soft == 0], img[soft == 0])
    assert "blend" in info2["timing"]

if __name__ == "__main__":
    for k, v in list(globals().items()):
        if k.startswith("test_"):
            v()
    print("ok")
