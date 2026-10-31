"""Run: python3 -m pytest scripts/comfy_nodes/tests  (or python3 scripts/comfy_nodes/tests/test_sienna_nodes.py)"""
import math
import os
import sys

import numpy as np

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "sienna_nodes"))
from sienna_crop import chin_crop, topmost_face_band  # noqa: E402
import sienna_body as sb  # noqa: E402
import sienna_redraw as rd  # noqa: E402
import sienna_exposure as ex  # noqa: E402
import sienna_face as sf  # noqa: E402
from sienna_garment import garment_composite  # noqa: E402
from sienna_pose import (  # noqa: E402
    BONES, angle_errors, measure_proportions, retarget_body, retarget_openpose, to_flat, to_points,
)

W, H = 600, 1000


def standing(long_legs=1.0, arm=1.0):
    """A frontal standing skeleton in pixels; torso (neck→mid-hip) = 300 px."""
    neck = (300, 200)
    pts = [None] * 18
    pts[1] = neck
    pts[0] = (300, 120)
    pts[14], pts[15], pts[16], pts[17] = (285, 105), (315, 105), (270, 112), (330, 112)
    pts[2], pts[5] = (240, 200), (360, 200)
    pts[3], pts[6] = (230, 200 + 174 * arm), (370, 200 + 174 * arm)
    pts[4], pts[7] = (225, 200 + 318 * arm), (375, 200 + 318 * arm)
    pts[8], pts[11] = (270, 500), (330, 500)
    pts[9], pts[12] = (270, 500 + 246 * long_legs), (330, 500 + 246 * long_legs)
    pts[10], pts[13] = (270, 500 + 486 * long_legs), (330, 500 + 486 * long_legs)
    return pts


def test_roundtrip_points():
    pts = standing()
    flat = to_flat(pts, W, H)
    back = to_points(flat, W, H)
    assert all((a is None and b is None) or (abs(a[0] - b[0]) < 1e-6 and abs(a[1] - b[1]) < 1e-6) for a, b in zip(pts, back))


def test_angles_preserved_and_neck_fixed():
    body = standing(long_legs=1.15, arm=0.9)
    target = measure_proportions(standing())
    new, factors = retarget_body(body, target, strength=1.0, max_change=0.3)
    assert new[1] == body[1]  # neck (composition anchor) unchanged
    errs = angle_errors(body, new)
    assert max(errs.values()) < 1e-6, errs  # every bone keeps its direction
    got = measure_proportions(new)
    assert abs(got["thigh"] - target["thigh"]) < 1e-3 and abs(got["forearm"] - target["forearm"]) < 1e-3
    assert factors["thigh"] < 1 < factors["forearm"]


def test_max_change_limits_distortion():
    body = standing(long_legs=1.6)  # implausible legs
    new, factors = retarget_body(body, measure_proportions(standing()), strength=1.0, max_change=0.2)
    assert abs(factors["thigh"] - 0.8) < 1e-9 and abs(factors["shin"] - 0.8) < 1e-9


def test_strength_zero_is_identity():
    body = standing(long_legs=1.2)
    new, factors = retarget_body(body, measure_proportions(standing()), strength=0.0)
    assert new == body and factors == {}


def test_head_tilt_kept():
    body = standing()
    # tilt the head 20 degrees about the nose
    a = math.radians(20)
    nx, ny = body[0]
    for i in (14, 15, 16, 17):
        x, y = body[i][0] - nx, body[i][1] - ny
        body[i] = (nx + x * math.cos(a) - y * math.sin(a), ny + x * math.sin(a) + y * math.cos(a))
    new, _ = retarget_body(body, {"head": 0.30, "thigh": 0.82}, strength=1.0, max_change=0.3)
    for i in (14, 15, 16, 17):
        t_old = math.atan2(body[i][1] - body[0][1], body[i][0] - body[0][0])
        t_new = math.atan2(new[i][1] - new[0][1], new[i][0] - new[0][0])
        assert abs(t_old - t_new) < 1e-9


def test_missing_joints_stay_missing():
    body = standing()
    body[10] = body[13] = None  # ankles out of frame
    new, _ = retarget_body(body, measure_proportions(standing()), strength=1.0)
    assert new[10] is None and new[13] is None and new[9] is not None


def test_render_and_dict():
    pose = {"people": [{"pose_keypoints_2d": to_flat(standing(1.1), W, H), "hand_right_keypoints_2d": None, "hand_left_keypoints_2d": None}],
            "canvas_width": W, "canvas_height": H}
    canvas, out, factors = retarget_openpose(pose, measure_proportions(standing()), 1.0)
    assert canvas.shape == (H, W, 3) and canvas.dtype == np.uint8 and canvas.sum() > 0
    assert out["canvas_width"] == W and len(out["people"][0]["pose_keypoints_2d"]) == 54
    # empty pose → black canvas, no crash
    canvas2, out2, _ = retarget_openpose({"people": [], "canvas_width": 64, "canvas_height": 96}, {}, 1.0)
    assert canvas2.shape == (96, 64, 3) and canvas2.sum() == 0 and out2["people"] == []


def test_garment_only_keeps_garment_removes_skin_and_crops():
    img = np.zeros((200, 100, 3), np.float32)
    img[...] = (0.9, 0.7, 0.6)  # "skin"
    person = np.zeros((200, 100), np.float32); person[20:190, 20:80] = 1
    garment = np.zeros((200, 100), np.float32); garment[80:120, 25:75] = 1
    img[80:120, 25:75] = (0.1, 0.2, 0.9)  # "garment"
    face = np.zeros((200, 100), np.float32); face[20:50, 30:70] = 1
    out, mode = garment_composite(img, garment, person, face, edge_px=0, silhouette=True, margin=0.1)
    assert mode == "garment"
    assert out.shape[0] < 200  # cropped to the garment
    px = out.reshape(-1, 3).astype(np.float64)
    has = lambda c: bool((np.abs(px - np.array(c)).max(axis=1) < 1e-4).any())
    assert not has((0.9, 0.7, 0.6))  # no skin colour reaches the adapter
    assert has((0.1, 0.2, 0.9)) and has((0.62, 0.62, 0.62))  # garment + flat silhouette context


def test_garment_mask_clipped_to_person_and_face_removed():
    img = np.random.rand(100, 100, 3).astype(np.float32)
    person = np.zeros((100, 100), np.float32); person[10:90, 30:70] = 1
    garment = np.ones((100, 100), np.float32)  # sloppy mask covering background too
    face = np.zeros((100, 100), np.float32); face[10:30, 30:70] = 1
    out, mode = garment_composite(img, garment, person, face, edge_px=0, silhouette=False, margin=0)
    assert mode == "garment" and out.shape == (60, 40, 3)  # person minus face rows


def test_empty_garment_falls_back_and_says_so():
    img = np.random.rand(50, 40, 3).astype(np.float32)
    person = np.ones((50, 40), np.float32)
    out, mode = garment_composite(img, np.zeros((50, 40)), person, None)
    assert mode == "fallback-person" and out.shape == (50, 40, 3)


# ── Edit Outfit: below-the-chin reference crop ──────────────────────────────

def _face_mask(h, w, boxes):
    m = np.zeros((h, w), np.float32)
    for x1, y1, x2, y2 in boxes:
        m[y1:y2, x1:x2] = 1
    return m


def test_chin_crop_cuts_below_face_and_keeps_full_width_and_bottom():
    img = np.random.rand(1000, 600, 3).astype(np.float32)
    out, info = chin_crop(img, _face_mask(1000, 600, [(250, 80, 350, 180)]), margin=0.1)
    assert info["mode"] == "cropped"
    # box rows 80..179 → face height 100, cut at 180 + 10
    assert out.shape == (810, 600, 3)
    assert np.array_equal(out, img[190:])
    assert abs(info["cut"] - 0.19) < 1e-6


def test_chin_crop_no_face_returns_original():
    img = np.zeros((100, 80, 3), np.float32)
    out, info = chin_crop(img, None)
    assert out is img and info["mode"] == "no-face"
    out, info = chin_crop(img, np.zeros((100, 80), np.float32))
    assert out is img and info["mode"] == "no-face"


def test_chin_crop_face_too_low_is_not_cropped():
    img = np.zeros((1000, 600, 3), np.float32)
    out, info = chin_crop(img, _face_mask(1000, 600, [(250, 600, 350, 700)]), min_keep=0.35)
    assert out is img and info["mode"] == "face-too-low"


def test_chin_crop_uses_topmost_face_and_resizes_mask():
    # Two people stacked: the lower face must not decide the cut.
    m = _face_mask(500, 300, [(100, 40, 150, 90), (120, 300, 160, 340)])
    assert topmost_face_band(m) == (40, 89)
    img = np.zeros((1000, 600, 3), np.float32)
    out, info = chin_crop(img, m, margin=0.0)  # mask at half resolution
    assert info["mode"] == "cropped" and out.shape[0] == 1000 - 180


# ── Edit Outfit body protection ──────────────────────────────────────────────

SKIN = (0.80, 0.60, 0.48)
RED = (0.85, 0.08, 0.10)
GREY = (0.55, 0.55, 0.56)


def figure(H=1000, W=600, leg_w=60, top=RED, bottom=RED, skin=SKIN, ties=True, legs_len=1.0):
    """Synthetic standing figure: skin body, a top and a bottom, thin ties at the hips, a face patch.
    Returns image, person mask, face mask, OpenPose-18 keypoints."""
    img = np.full((H, W, 3), 0.9, np.float32)
    person = np.zeros((H, W), bool)
    cx = W // 2
    kp = [None] * 18
    kp[0] = (cx, 110); kp[14] = (cx - 15, 95); kp[15] = (cx + 15, 95)
    kp[1] = (cx, 180); kp[2] = (cx - 70, 185); kp[5] = (cx + 70, 185)
    kp[8] = (cx - 40, 480); kp[11] = (cx + 40, 480)
    knee_y = 480 + int(240 * legs_len); ank_y = knee_y + int(230 * legs_len)
    kp[9] = (cx - 40, knee_y); kp[12] = (cx + 40, knee_y); kp[10] = (cx - 40, ank_y); kp[13] = (cx + 40, ank_y)
    kp[3] = (cx - 150, 330); kp[6] = (cx + 150, 330); kp[4] = (cx - 170, 450); kp[7] = (cx + 170, 450)
    def fill(y0, y1, x0, x1, col):
        img[y0:y1, x0:x1] = col; person[y0:y1, x0:x1] = True
    fill(60, 160, cx - 45, cx + 45, skin)                     # head (face)
    fill(160, 185, cx - 20, cx + 20, skin)                    # neck
    fill(185, 500, cx - 75, cx + 75, skin)                    # torso
    fill(500, min(H, ank_y + 20), cx - 40 - leg_w // 2, cx - 40 + leg_w // 2, skin)
    fill(500, min(H, ank_y + 20), cx + 40 - leg_w // 2, cx + 40 + leg_w // 2, skin)
    if top is not None:
        fill(220, 300, cx - 75, cx + 75, top)
    if bottom is not None:
        fill(450, 520, cx - 75, cx + 75, bottom)
        if ties:
            img[470:560, cx - 78:cx - 76] = bottom; person[470:560, cx - 78:cx - 76] = True   # thin string tie
    face = np.zeros((H, W), np.float32); face[60:160, cx - 45:cx + 45] = 1
    return img, person, face, kp


def test_skin_mask_separates_skin_from_garments():
    img, person, face, kp = figure(top=GREY)
    model = sb.skin_model(img, kp, face)
    sk = sb.skin_mask(img, model)
    assert sk[350, 300] and sk[700, 260]                      # belly, leg
    assert not sk[250, 300] and not sk[480, 300]              # grey top, red bottom
    assert not sk[30, 30]                                     # background


def test_garment_only_keeps_every_piece_and_ties_and_removes_skin():
    img, person, face, kp = figure()
    out, info = sb.garment_only(img, person, face, kp, ["upper", "lower"])
    assert info["mode"] == "garment-only", info
    cut = int(round(info["cut"] * img.shape[0]))
    o = lambda y, x: out[y - cut, x]
    assert np.allclose(o(250, 300), RED, atol=0.02) and np.allclose(o(480, 300), RED, atol=0.02)
    assert np.allclose(o(520, 223), RED, atol=0.02)          # the thin tie survives
    bg = np.array(info["backdrop"])
    assert np.allclose(o(350, 300), bg, atol=0.02)           # belly skin → backdrop
    assert np.allclose(o(700, 260), bg, atol=0.02)           # leg skin → backdrop
    assert cut > 60                                           # face removed


def test_garment_only_falls_back_when_a_piece_is_missing_or_skin_coloured():
    img, person, face, kp = figure(bottom=None)
    out, info = sb.garment_only(img, person, face, kp, ["upper", "lower"])
    assert info["mode"] == "fallback-chin-crop" and "bottom" in info["reason"]
    img, person, face, kp = figure(top=SKIN, bottom=SKIN)
    out, info = sb.garment_only(img, person, face, kp, ["upper", "lower"])
    assert info["mode"] == "fallback-chin-crop"
    img, person, face, kp = figure(bottom=None)
    out, info = sb.garment_only(img, person, face, kp, ["upper"])   # top-only edit: no bottom needed
    assert info["mode"] == "garment-only"


def test_backdrop_contrasts_with_light_grey_garments():
    assert sb.backdrop_for(np.tile(np.array([[0.5, 0.5, 0.5]], np.float32), (100, 1))) != (0.5, 0.5, 0.5)
    assert sb.backdrop_for(np.tile(np.array([[0.85, 0.1, 0.1]], np.float32), (100, 1))) == (0.5, 0.5, 0.5)


def test_body_sheet_stitches_at_one_height():
    a, b = np.zeros((400, 200, 3), np.float32), np.ones((800, 300, 3), np.float32)
    sheet = sb.body_sheet([a, b], height=200, gap=10)
    assert sheet.shape == (200, 100 + 10 + 75, 3)


def _m(**kw):
    img, person, face, kp = figure(**kw)
    return sb.measure_body(img, kp, person, face)


def test_compare_same_body_is_ok_and_wider_or_longer_legs_warn():
    base = _m(top=None, bottom=RED)
    assert sb.compare(base, base, [])["status"] == "ok"
    wider = sb.compare(base, _m(top=None, bottom=RED, leg_w=75), [])
    assert wider["status"] == "warn" and any(f["part"].startswith("thigh width") for f in wider["flags"])
    longer = sb.compare(base, _m(top=None, bottom=RED, legs_len=1.12), [])
    assert any("thigh" in f["part"] and "length" in f["part"] for f in longer["flags"])


def test_compare_guards_footwear_skirts_and_pose():
    base, longer = _m(top=None, bottom=RED), _m(top=None, bottom=RED, legs_len=1.12)
    r = sb.compare(base, longer, [], footwear_changed=True)
    assert not any("shin" in f["part"] for f in r["flags"]) and any(s["why"].startswith("footwear") for s in r["skipped"])
    r = sb.compare(base, longer, [], legs_hidden=True)
    assert not any("length" in f["part"] for f in r["flags"])
    turned = dict(base, view=base["view"] * 0.7)
    assert sb.compare(base, turned, [])["status"] == "insufficient"


def test_uncovered_parts_use_the_range_of_several_references_never_one():
    clothed = _m(top=None, bottom=GREY)
    clothed["widths"]["thigh"]["skin"] = 0.0                  # jeans in the original
    bare = _m(top=None, bottom=RED)
    one_ref = sb.compare(clothed, bare, [bare])
    assert not any(c["part"] == "thigh width" for c in one_ref["checked"])     # one photo is not enough
    refs = [_m(top=None, bottom=RED, leg_w=58), _m(top=None, bottom=RED, leg_w=64)]
    ok = sb.compare(clothed, bare, refs)
    assert any(c["part"] == "thigh width" and "references" in c["basis"] for c in ok["checked"])
    assert not any(f["part"] == "thigh width" for f in ok["flags"])
    much_wider = sb.compare(clothed, _m(top=None, bottom=RED, leg_w=76), refs)    # wider, legs still apart
    assert any(f["part"] == "thigh width" for f in much_wider["flags"])


def test_scene_change_separates_replaced_scenes():
    room = np.zeros((960, 640, 3), np.float32); room[:, :320] = (0.9, 0.9, 0.85); room[:, 320:] = (0.25, 0.2, 0.15)
    studio = np.full_like(room, 0.6)
    assert sb.scene_change(room, room) < 1
    assert sb.scene_change(room, studio) > sb.SCENE_CHANGED
    lit = np.clip(room * 1.08, 0, 1)                           # same scene, a little brighter: not a replacement
    assert sb.scene_change(room, lit) < sb.SCENE_CHANGED


def test_legs_together_are_not_measured_as_one_thigh():
    together = _m(top=None, bottom=RED, leg_w=100)          # legs overlap: a run would span both
    assert together["widths"].get("thigh", {}).get("arm_contact")


def test_body_sheet_cuts_references_to_the_person_on_grey():
    img = np.full((400, 200, 3), 0.9, np.float32); img[100:300, 60:140] = 0.2
    m = np.zeros((400, 200), np.float32); m[100:300, 60:140] = 1
    sheet = sb.body_sheet([img], height=200, masks=[m])
    assert np.allclose(sheet[2, 2], 0.5) and sheet.mean() < 0.5      # studio background gone, body kept


def test_scene_backdrop_removes_the_person_and_sheet_uses_it():
    scene = np.zeros((400, 200, 3), np.float32); scene[..., 2] = 0.8            # blue room
    scene[100:300, 70:130] = (0.9, 0.1, 0.1)                                     # red person in it
    pm = np.zeros((400, 200), np.float32); pm[100:300, 70:130] = 1
    bg = sb.scene_backdrop(scene, pm)
    assert bg.shape == scene.shape and bg[200, 100, 0] < 0.3 and bg[200, 100, 2] > 0.6   # person filled with the room
    img = np.full((400, 200, 3), 0.9, np.float32); img[100:300, 60:140] = 0.2
    m = np.zeros((400, 200), np.float32); m[100:300, 60:140] = 1
    sheet = sb.body_sheet([img, img], height=200, masks=[None, m], backdrop=bg)
    assert sheet[2, 110, 2] > 0.6 and sheet[100, 160, 0] < 0.3                  # gap and cut-out surround = room


def _classes(img, person, face, garment_col=None):
    """Stand-in for the MediaPipe segmenter on the synthetic figure: clothes = garment-coloured pixels."""
    col = np.array(garment_col if garment_col is not None else RED, np.float32)
    clothes = (np.abs(img - col).sum(2) < 0.05) & person
    body = person & ~clothes & (face < 0.5)
    z = np.zeros(img.shape[:2], np.float32)
    return [(~person).astype(np.float32), z, body.astype(np.float32), face.astype(np.float32), clothes.astype(np.float32), z]


def test_redraw_mask_covers_old_garment_and_ties_but_not_face_or_background():
    img, person, face, kp = figure()
    hard, soft, info = rd.garment_region(img, _classes(img, person, face), person.astype(np.float32), face, kp, "full", "garment")
    m = hard > 0.5
    assert m[260, 300] and m[480, 300]                       # top, bottom
    assert m[540, 300 - 77]                                   # thin string tie
    assert not m[100, 300]                                    # face
    assert not m[30, 30] and not m[700, 20]                   # background far from her
    assert info["uncovered"] < 0.02 and not info["empty"]
    assert (soft <= 1).all() and soft[260, 300] > 0.99 and soft[100, 300] == 0


def test_redraw_paste_back_leaves_everything_outside_the_mask_untouched():
    img, person, face, kp = figure()
    hard, soft, _ = rd.garment_region(img, _classes(img, person, face), person.astype(np.float32), face, kp, "full", "garment")
    edited = np.clip(img + 0.3, 0, 1)                         # stand-in for the editor's output
    out = rd.composite(img, edited, soft)
    outside = soft == 0
    assert np.abs(out - img)[outside].max() == 0
    assert np.allclose(out[260, 300], edited[260, 300])
    grey = rd.erase(img, hard)
    assert np.allclose(grey[260, 300], 0.5) and np.allclose(grey[100, 300], img[100, 300])


def test_redraw_mask_scope_grow_feet_and_arms():
    img, person, face, kp = figure()
    cl = _classes(img, person, face)
    top, _, _ = rd.garment_region(img, cl, person.astype(np.float32), face, kp, "top", "garment")
    bottom, _, _ = rd.garment_region(img, cl, person.astype(np.float32), face, kp, "bottom", "garment")
    assert top[260, 300] and not top[505, 300]                # top only: the bottom stays
    assert bottom[505, 300] and not bottom[260, 300]          # bottom only: the top stays
    plain, _, _ = rd.garment_region(img, cl, person.astype(np.float32), face, kp, "full", "garment")
    assert not plain[650, 260]                                # bare thigh not redrawn for a bikini
    legs, _, _ = rd.garment_region(img, cl, person.astype(np.float32), face, kp, "full", "body")
    assert legs[650, 260]                                     # a dress or trousers may cover the legs
    feet, _, _ = rd.garment_region(img, cl, person.astype(np.float32), face, kp, "full", "garment", include_feet=True)
    assert feet[kp[10][1] + 10, int(kp[10][0])] and not plain[kp[10][1] + 10, int(kp[10][0])]


def test_redraw_mask_without_segmenter_falls_back_to_pose_zones():
    img, person, face, kp = figure()
    hard, _, info = rd.garment_region(img, None, person.astype(np.float32), face, kp, "full", "garment")
    assert info["source"] == "pose" and hard[260, 300] and hard[480, 300] and not hard[100, 300]


def test_band_redraw_mask_has_no_garment_outline_and_spares_accessories():
    img, person, face, kp = figure()
    cl = _classes(img, person, face)
    pf = person.astype(np.float32)
    outline, _, _ = rd.garment_region(img, cl, pf, face, kp, "full", "garment", shape="outline")
    band, _, info = rd.garment_region(img, cl, pf, face, kp, "full", "garment", shape="band")
    assert info["shape"] == "band" and info["uncovered"] < 0.02
    # band rows are filled across her body: no cup/bottom silhouette for the editor to copy
    row = (band > 0.5)[260, 240:360]
    assert row.all()
    assert (band > 0.5).sum() >= (outline > 0.5).sum()
    assert not band[380, 300]                                 # midriff between the pieces is not redrawn
    assert not band[30, 30] and not band[100, 300]            # background, face
    # an accessory (segmenter "other" class) on the chest stays out of the mask
    cl2 = [c.copy() for c in cl]
    cl2[5][205:215, 295:305] = 1.0
    band2, _, _ = rd.garment_region(img, cl2, pf, face, kp, "full", "garment", shape="band")
    assert not band2[210, 300]




def test_exposure_summary_flags_exposed_breasts_above_threshold_only():
    covered = [{"class": "FEMALE_BREAST_COVERED", "score": 0.8}, {"class": "FACE_FEMALE", "score": 0.9}]
    assert ex.summarize(covered) == {"exposed": False, "score": 0.0, "classes": []}
    faint = covered + [{"class": "FEMALE_BREAST_EXPOSED", "score": 0.3}]
    assert ex.summarize(faint)["exposed"] is False and ex.summarize(faint)["score"] == 0.3
    shown = covered + [{"class": "FEMALE_BREAST_EXPOSED", "score": 0.63}]
    assert ex.summarize(shown) == {"exposed": True, "score": 0.63, "classes": ["FEMALE_BREAST_EXPOSED"]}
    assert ex.summarize(faint, threshold=0.25)["exposed"] is True
    via_crop = covered + [{"class": "FEMALE_BREAST_EXPOSED", "score": 0.71, "crop": True}]
    assert ex.summarize(via_crop) == {"exposed": True, "score": 0.71, "classes": ["FEMALE_BREAST_EXPOSED"], "crop": True}


def test_exposure_chest_crop_box_pads_covered_breasts_and_stays_in_frame():
    dets = [{"class": "FEMALE_BREAST_COVERED", "score": 0.7, "box": [300, 600, 100, 80]},
            {"class": "FEMALE_BREAST_COVERED", "score": 0.6, "box": [450, 610, 100, 80]},
            {"class": "FEMALE_BREAST_COVERED", "score": 0.1, "box": [0, 0, 50, 50]},   # too faint: ignored
            {"class": "FACE_FEMALE", "score": 0.9, "box": [350, 100, 150, 150]}]
    # union 300..550 x 600..690, padded by 0.35 × 250
    assert ex.chest_crop_box(dets, 832, 1216) == (213, 513, 637, 777)
    assert ex.chest_crop_box(dets, 600, 700) == (213, 513, 600, 700)
    assert ex.chest_crop_box([{"class": "FACE_FEMALE", "score": 0.9, "box": [1, 1, 5, 5]}], 832, 1216) is None


def test_exposure_detector_looks_again_at_a_covered_chest():
    import tempfile

    import cv2
    path = os.path.join(tempfile.mkdtemp(), "p.png")
    cv2.imwrite(path, np.zeros((1216, 832, 3), np.uint8))

    class Fake:
        def __init__(self, full, crop):
            self.full, self.crop, self.calls = full, crop, []

        def detect(self, p):
            self.calls.append(p)
            return self.full if p == path else self.crop

    covered = [{"class": "FEMALE_BREAST_COVERED", "score": 0.7, "box": [300, 600, 250, 90]}]
    f = Fake(covered, [{"class": "FEMALE_BREAST_EXPOSED", "score": 0.71, "box": [10, 20, 30, 30]}])
    out = ex.ChestCropDetector(f).detect(path)
    assert len(f.calls) == 2 and out[-1] == {"class": "FEMALE_BREAST_EXPOSED", "score": 0.71, "box": [223, 533, 30, 30], "crop": True}
    assert ex.summarize(out)["exposed"] is True
    # nothing covered: no second look; already exposed: no second look
    f2 = Fake([{"class": "FACE_FEMALE", "score": 0.9, "box": [1, 1, 5, 5]}], [])
    assert ex.ChestCropDetector(f2).detect(path) == f2.full and len(f2.calls) == 1
    f3 = Fake(covered + [{"class": "FEMALE_BREAST_EXPOSED", "score": 0.8, "box": [1, 1, 5, 5]}], [])
    ex.ChestCropDetector(f3).detect(path)
    assert len(f3.calls) == 1
    # a faint exposed hit (below the threshold) still gets the close look
    f4 = Fake(covered + [{"class": "FEMALE_BREAST_EXPOSED", "score": 0.2, "box": [1, 1, 5, 5]}], [{"class": "FEMALE_BREAST_EXPOSED", "score": 0.7, "box": [10, 20, 30, 30]}])
    out4 = ex.ChestCropDetector(f4).detect(path)
    assert len(f4.calls) == 2 and ex.summarize(out4)["exposed"] is True


def test_face_reference_and_check():
    a = np.array([1, 0, 0], np.float32); b = np.array([0.8, 0.6, 0], np.float32)
    ref = sf.reference_embedding([a, b])
    assert abs(np.linalg.norm(ref) - 1) < 1e-5
    assert sf.check([], ref, 0.5) == {"found": False, "similarity": None, "ok": True, "faces": 0}
    good = sf.check([{"embedding": a}], ref, 0.5)
    assert good["found"] and good["ok"] and good["similarity"] > 0.9
    far = sf.check([{"embedding": np.array([0, 0, 1], np.float32), "size": 120}, {"embedding": a}], ref, 0.5, min_size=64)
    assert far["ok"] is False and far["faces"] == 2 and far["size"] == 120
    tiny = sf.check([{"embedding": np.array([0, 0, 1], np.float32), "size": 40}], ref, 0.5, min_size=64)
    assert tiny["ok"] is True and tiny["similarity"] < 0.5


def test_face_head_turn_from_landmarks():
    # box x, y, w, h, then right eye, left eye, nose, mouth corners, score
    frontal = [0, 0, 100, 120, 30, 50, 70, 50, 50, 75, 35, 95, 65, 95, 0.95]
    turned = [0, 0, 100, 120, 40, 50, 66, 50, 70, 75, 50, 95, 70, 95, 0.9]
    f, t = sf.head_turn(frontal), sf.head_turn(turned)
    assert f["yaw"] < 0.05 and abs(f["eye_ratio"] - 0.4) < 1e-3
    assert t["yaw"] > 0.6 and t["eye_ratio"] < 0.3


def test_face_check_reports_head_turn():
    a = np.array([1, 0, 0], np.float32)
    r = sf.check([{"embedding": a, "size": 150, "yaw": 0.4123, "eye_ratio": 0.351, "score": 0.93}], a, 0.74, min_size=64)
    assert (r["yaw"], r["eye_ratio"], r["detector_score"]) == (0.412, 0.351, 0.93)
    assert "yaw" not in sf.check([{"embedding": a}], a, 0.74)


def _portrait(hair_bgr, skin_bgr=(120, 150, 215)):
    """Synthetic 400x400 photo: hair-coloured head area with a skin-coloured face box at (150,150)-(250,270)."""
    img = np.full((400, 400, 3), 235, np.uint8)
    img[60:330, 90:310] = hair_bgr
    img[150:270, 150:250] = skin_bgr
    f = [150, 150, 100, 120, 175, 190, 225, 190, 200, 220, 180, 245, 220, 245, 0.95]
    return img, f


def test_face_appearance_hair_and_skin():
    dark, f = _portrait((20, 30, 45))      # dark brown hair
    blonde, _ = _portrait((140, 200, 225))  # blonde hair, same skin
    a, b = sf.appearance(dark, f), sf.appearance(blonde, f)
    assert a["hair_rel"] < 0.4 and b["hair_rel"] > 1.0
    assert 30 < a["skin_hue"] < 65 and a["mono"] is False
    grey, _ = _portrait((60, 60, 60), (150, 150, 150))
    assert sf.appearance(grey, f)["mono"] is True


def test_face_appearance_is_lighting_relative():
    img, f = _portrait((20, 30, 45))
    dim = (img.astype(np.float32) * 0.55).astype(np.uint8)   # same photo, much darker light
    a, b = sf.appearance(img, f), sf.appearance(dim, f)
    assert abs(a["hair_rel"] - b["hair_rel"]) < 0.15
    assert abs(a["skin_hue"] - b["skin_hue"]) < 6


# ── safe framing (video) ─────────────────────────────────────────────────────
import sienna_frame as fr  # noqa: E402


def _seg(h, w, top, bottom, left, right, face=None):
    """Synthetic segmenter output: background 1 everywhere except the person box; optional face-skin box."""
    bg = np.ones((h, w), np.float32)
    bg[top:bottom, left:right] = 0.0
    cl = [bg, np.zeros((h, w), np.float32), np.zeros((h, w), np.float32), np.zeros((h, w), np.float32)]
    if face:
        t, b, l, r = face
        cl[3][t:b, l:r] = 1.0
    return cl


def test_safe_frame_jump_on_tight_photo_adds_only_headroom():
    # 4:5 photo, head at the very top, feet in the photo (like the approved body set)
    box = fr.subject_box(_seg(1400, 1120, 10, 1340, 400, 720))
    assert box["top"] == 10 and box["bottom"] == 1340
    p = fr.plan_pads(box, {"top": 0.24, "bottom": 0.03, "side": 0.08})
    hb = 1330
    assert abs(p["top"] - (0.24 * hb - 10)) <= fr.ALIGN
    assert p["bottom"] == fr._up(0.03 * hb - 60)  # 60 px already below her feet
    assert p["left"] == 0 and p["right"] == 0     # 400 px each side already > 0.08 * 1330
    assert p["changed"] and not p["capped"] and p["feet_in_photo"]


def test_safe_frame_leaves_a_roomy_photo_alone():
    box = fr.subject_box(_seg(1600, 1000, 400, 1450, 350, 650))
    p = fr.plan_pads(box, {"top": 0.24, "bottom": 0.03, "side": 0.08})
    assert not p["changed"] and p["top"] == p["bottom"] == p["left"] == p["right"] == 0


def test_safe_frame_no_room_below_a_cropped_body():
    # cropped at the thighs: no bottom pad, body height from the face (9 × face height)
    box = fr.subject_box(_seg(1000, 800, 5, 1000, 250, 550, face=(40, 190, 350, 450)))
    assert fr.body_height(box) == 1350.0  # 9 x 150 px face > the 995 px visible
    p = fr.plan_pads(box, {"top": 0.24, "bottom": 0.05, "side": 0.0})
    assert p["bottom"] == 0 and p["top"] >= 0.24 * 1350 - 5 and not p["feet_in_photo"]


def test_safe_frame_side_room_follows_visible_body_when_cropped():
    # thigh-cropped photo, narrow margins at the sides: side room from the visible 995 px, not the 9 x face estimate
    box = fr.subject_box(_seg(1000, 800, 5, 1000, 300, 500, face=(40, 290, 350, 450)))
    assert fr.body_height(box) == 2250.0
    p = fr.plan_pads(box, {"top": 0.0, "bottom": 0.0, "side": 0.1})
    assert p["left"] == 0 and p["right"] == 0  # 300 px each side > 0.1 x 995
    p2 = fr.plan_pads(box, {"top": 0.0, "bottom": 0.0, "side": 0.4})
    assert p2["left"] == fr._up(0.4 * 995 - 300) and not p2["capped"]


def test_safe_frame_keeps_phone_shape_and_caps():
    box = fr.subject_box(_seg(1000, 600, 0, 990, 200, 400))
    p = fr.plan_pads(box, {"top": 0.6, "bottom": 0.0, "side": 0.0}, max_pad=0.4, min_aspect=9 / 16)
    assert p["capped"] and p["top"] <= fr._up(0.4 * 1000)
    nw, nh = 600 + p["left"] + p["right"], 1000 + p["top"] + p["bottom"]
    assert nw / nh >= 9 / 16 - 0.01  # less headroom instead of a frame taller than 9:16
    assert p["left"] == p["right"] == 0  # never side strips (side fills showed seams in the Phase 2 test)
    assert p["top"] == int((600 / (9 / 16) - 1000)) // fr.ALIGN * fr.ALIGN


def test_safe_frame_pad_image_and_sizes():
    img = np.random.RandomState(0).rand(100, 80, 3).astype(np.float32)
    out, mask = fr.pad_image(img, {"top": 24, "bottom": 0, "left": 8, "right": 8}, feather=10)
    assert out.shape == (124, 96, 3) and mask.shape == (124, 96)
    assert mask[:24].min() == 1.0 and mask[:, :8].min() == 1.0
    assert np.allclose(out[24 + 20:, 8 + 20:88 - 20], img[20:, 20:60])  # the photo itself is untouched
    assert mask[24 + 50, 8 + 40] == 0.0 and 0 < mask[24 + 2, 8 + 40] < 1  # ramp only near the new edge
    same, m0 = fr.pad_image(img, {"top": 0, "bottom": 0, "left": 0, "right": 0})
    assert np.array_equal(same, img) and m0.max() == 0
    w, h = fr.fit_area(1120, 1648, 832 * 480)
    assert w % 16 == 0 and h % 16 == 0 and abs(w * h - 832 * 480) / (832 * 480) < 0.06 and abs(w / h - 1120 / 1648) < 0.03
    fw, fh = fr.fill_size(1120, 1648)
    assert fw * fh <= 1_100_000 and fw % 8 == 0


# --- which face is hers (rank_faces). Landmark vectors are the real YuNet detections from the studio's photos. ---
# box x, y, w, h, then right eye, left eye, nose, mouth corners, score
SELFIE_FACE = [313.3, 113.7, 179.6, 258.4, 363.6, 207.0, 446.2, 221.6, 394.1, 263.3, 352.8, 295.7, 424.7, 308.6, 0.93]
SELFIE_STOMACH = [299.2, 735.0, 274.9, 270.6, 399.8, 856.9, 450.1, 847.0, 434.0, 914.1, 417.5, 951.8, 453.2, 943.1, 0.75]
HEM_FACE = [323.0, 122.0, 186.0, 220.0, 368.0, 200.0, 456.0, 199.0, 412.0, 248.0, 377.0, 283.0, 447.0, 282.0, 0.94]
HEM_FALSE = [340.0, 847.0, 152.0, 152.0, 390.0, 900.0, 433.0, 900.0, 413.0, 930.0, 398.0, 970.0, 431.0, 970.0, 0.80]
SIENNA, OTHER = np.array([1, 0, 0], np.float32), np.array([0, 0, 1], np.float32)


def _det(f, emb=SIENNA):
    """What sienna_face.faces() reports for one detection, without the models."""
    return {"box": [float(v) for v in f[:4]], "area": f[2] * f[3], "size": min(f[2], f[3]), "score": f[14],
            **sf.head_turn(f), **sf.landmark_shape(f), "embedding": emb}


def _shift(f, dx=0.0, dy=0.0, scale=1.0, score=None):
    """The same face moved/scaled (box and landmarks), optionally with another detector score."""
    out = [f[0] * scale + dx, f[1] * scale + dy, f[2] * scale, f[3] * scale]
    for i in range(5):
        out += [f[4 + 2 * i] * scale + dx, f[5 + 2 * i] * scale + dy]
    return out + [f[14] if score is None else score]


def _rot90(f):
    """The face turned 90 degrees in the picture (lying on her side): landmarks rotated about the box centre."""
    cx, cy = f[0] + f[2] / 2, f[1] + f[3] / 2
    pts = [(cx - (f[5 + 2 * i] - cy), cy + (f[4 + 2 * i] - cx)) for i in range(5)]
    return [cx - f[3] / 2, cy - f[2] / 2, f[3], f[2]] + [v for p in pts for v in p] + [f[14]]


def test_face_selfie_stomach_is_not_her_face():
    face, stomach = _det(SELFIE_FACE), _det(SELFIE_STOMACH, OTHER)
    assert stomach["area"] > face["area"]           # the old rule (largest) picked the stomach
    assert sf.is_clear(face) and not sf.is_clear(stomach)
    for order in ([stomach, face], [face, stomach]):
        r = sf.check(order, SIENNA, 0.74, 64)
        assert r["similarity"] > 0.99 and r["ok"] and r["clear"] is True and r["box"] == [313, 114, 180, 258]


def test_face_crop_top_hem_below_face_is_ignored():
    r = sf.check([_det(HEM_FALSE, OTHER), _det(HEM_FACE)], SIENNA, 0.74, 64)
    assert r["similarity"] > 0.99 and r["faces"] == 2


def test_face_unclear_body_part_under_a_turned_head_is_ignored():
    # her head turned away (unclear, smaller) above the stomach detection (unclear, larger): the head is above the body
    turned = _shift(SELFIE_FACE, score=0.78)
    turned[6], turned[7] = turned[4] + 30, turned[5]      # eyes close together: strong head turn
    head = _det(turned)
    assert not sf.is_clear(head)
    r = sf.check([_det(SELFIE_STOMACH, OTHER), head], SIENNA, 0.74, 64)
    assert r["similarity"] > 0.99 and r["clear"] is False


def test_face_single_unclear_face_is_still_compared_and_flagged():
    # cropped or turned: the only detection is compared, and the report says it wasn't a clear face
    r = sf.check([_det(SELFIE_STOMACH, OTHER)], SIENNA, 0.74, 64)
    assert r["found"] and r["clear"] is False and r["ok"] is False


def test_face_cropped_at_top_edge_is_found():
    edge = _shift(SELFIE_FACE, dy=-150)                  # box starts above the picture, as in a top-cropped photo
    r = sf.check([_det(edge)], SIENNA, 0.74, 64)
    assert r["found"] and r["clear"] is True and r["ok"]


def test_face_full_body_small_face_beats_tiny_background_face():
    hers = _det(_shift(SELFIE_FACE, scale=0.4))          # about 72 px: a full-body photo
    poster = _det(_shift(SELFIE_FACE, dx=500, scale=0.15), OTHER)   # 27 px face on a poster
    r = sf.check([poster, hers], SIENNA, 0.74, 64)
    assert r["similarity"] > 0.99 and r["size"] >= 64
    # her head turned away still wins over a tiny clear face in the background
    turned = _shift(SELFIE_FACE, scale=0.4, score=0.78)
    turned[6] = turned[4] + 12
    r = sf.check([poster, _det(turned)], SIENNA, 0.74, 64)
    assert r["similarity"] > 0.99 and r["clear"] is False


def test_face_lying_on_her_side_is_clear():
    side = _det(_rot90(SELFIE_FACE))
    assert sf.is_clear(side)
    # her stomach is beside her face when she lies down; clarity still picks the face
    beside = _det(_rot90(_shift(SELFIE_STOMACH, dx=500, dy=-620)), OTHER)
    r = sf.check([beside, side], SIENNA, 0.74, 64)
    assert r["similarity"] > 0.99


def test_face_two_clear_faces_stacked_keeps_the_larger():
    # a mirror or a second person: two clear faces one above the other are both real faces; the larger is the subject
    big = _det(_shift(SELFIE_FACE, dy=500, scale=1.2))
    small_above = _det(_shift(SELFIE_FACE, scale=0.7), OTHER)
    assert sf.check([small_above, big], SIENNA, 0.74, 64)["similarity"] > 0.99


def test_face_none_found_is_reported_not_guessed():
    assert sf.check([], SIENNA, 0.74, 64) == {"found": False, "similarity": None, "ok": True, "faces": 0}


if __name__ == "__main__":
    fails = 0
    for name, fn in list(globals().items()):
        if name.startswith("test_"):
            try:
                fn(); print("ok  ", name)
            except Exception as e:  # noqa: BLE001
                fails += 1; print("FAIL", name, repr(e))
    sys.exit(1 if fails else 0)
