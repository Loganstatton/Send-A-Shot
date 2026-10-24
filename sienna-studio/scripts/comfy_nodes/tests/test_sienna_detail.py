"""Run: python3 scripts/comfy_nodes/tests/test_sienna_detail.py"""
import os
import sys

import numpy as np

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "sienna_detail"))
import sienna_detail as sd  # noqa: E402

GEN = {"class": "FEMALE_GENITALIA_EXPOSED", "score": 0.57, "box": [847, 364, 64, 75]}


def test_find_box_takes_the_best_hit_above_threshold():
    dets = [{"class": "BUTTOCKS_EXPOSED", "score": 0.9, "box": [1, 1, 400, 300]}, GEN,
            {"class": "FEMALE_GENITALIA_EXPOSED", "score": 0.31, "box": [10, 10, 50, 50]}]
    assert sd.find_box(dets) == (847, 364, 64, 75, 0.57)
    assert sd.find_box(dets, threshold=0.6) is None
    assert sd.find_box([{"class": "FEMALE_GENITALIA_COVERED", "score": 0.9, "box": [1, 1, 9, 9]}]) is None


def test_region_is_a_square_around_the_box_kept_in_frame():
    x0, y0, side = sd.region((847, 364, 64, 75), 1216, 832)
    assert side == 195 and (x0, y0) == (782, 304)        # 2.6 × 75, centred on (879, 401.5)
    # near the edge: moved in, not shrunk
    x0, y0, side = sd.region((1180, 800, 30, 30), 1216, 832)
    assert side == 160 and x0 == 1216 - 160 and y0 == 832 - 160
    # never bigger than the photo
    assert sd.region((0, 0, 900, 900), 832, 1216)[2] == 832


def test_oval_masks_cover_the_box_and_fade_out():
    hard, soft = sd.oval_masks(200, (80, 80, 40, 40))
    assert hard[100, 100] == 1 and soft[100, 100] == 1      # centre
    assert hard[100, 131] == 1                                 # just past the box, inside the 1.6× oval
    assert hard[100, 140] == 0 and 0 < soft[100, 140] < 1     # feathered band
    assert soft[0, 0] == 0 and hard[0, 0] == 0                 # corner untouched


def test_plan_cut_paste_round_trip_changes_only_the_oval():
    rng = np.random.default_rng(0)
    img = rng.uniform(0.3, 0.7, (832, 1216, 3)).astype(np.float32)
    info = sd.plan([GEN], 1216, 832, size=512)
    assert info["found"] and info["side"] == 195 and info["size"] == 512
    crop, mask = sd.cut(img, info)
    assert crop.shape == (512, 512, 3) and mask.shape == (512, 512) and mask[256, 256] == 1
    redrawn = np.clip(crop + 0.1, 0, 1)                         # brighter redraw: the colour match takes it back
    out, rep = sd.paste(img, redrawn, info)
    assert rep["pasted"] and rep["color_shift"][0] < 0
    x0, y0, side = info["x0"], info["y0"], info["side"]
    assert np.array_equal(out[:y0], img[:y0]) and np.array_equal(out[:, :x0], img[:, :x0])   # outside the square: identical
    assert np.array_equal(out[y0, x0], img[y0, x0])                                            # square corner: outside the oval
    assert not np.allclose(out[y0 + side // 2, x0 + side // 2], img[y0 + side // 2, x0 + side // 2], atol=1e-4)


def test_nothing_found_leaves_the_photo_unchanged():
    img = np.full((832, 1216, 3), 0.5, np.float32)
    info = sd.plan([{"class": "BUTTOCKS_EXPOSED", "score": 0.8, "box": [1, 1, 50, 50]}], 1216, 832)
    assert info == {"found": False, "skipped": "no exposed genital area found", "size": 64}
    crop, mask = sd.cut(img, info)
    assert crop.shape == (64, 64, 3) and mask.sum() == 0
    out, rep = sd.paste(img, crop, info)
    assert out is img and rep == {"skipped": "no exposed genital area found"}


if __name__ == "__main__":
    fails = 0
    for name, fn in list(globals().items()):
        if name.startswith("test_"):
            try:
                fn(); print("ok  ", name)
            except Exception as e:  # noqa: BLE001
                fails += 1; print("FAIL", name, repr(e))
    sys.exit(1 if fails else 0)
