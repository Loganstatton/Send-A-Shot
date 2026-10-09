"""Run: python3 -m pytest scripts/comfy_nodes/tests  (or python3 scripts/comfy_nodes/tests/test_sienna_nodes.py)"""
import math
import os
import sys

import numpy as np

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "sienna_nodes"))
from sienna_crop import chin_crop, topmost_face_band  # noqa: E402
import sienna_body as sb  # noqa: E402
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


if __name__ == "__main__":
    fails = 0
    for name, fn in list(globals().items()):
        if name.startswith("test_"):
            try:
                fn(); print("ok  ", name)
            except Exception as e:  # noqa: BLE001
                fails += 1; print("FAIL", name, repr(e))
    sys.exit(1 if fails else 0)
