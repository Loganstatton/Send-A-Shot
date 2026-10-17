"""Lock Camera tests on synthetic videos where the camera drift is known exactly.
Run: python3 -m pytest scripts/comfy_nodes/tests/test_sienna_stabilize.py"""
import math
import os
import sys

import cv2
import numpy as np

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "sienna_nodes"))
import sienna_stabilize as st  # noqa: E402

W, H, N = 320, 480, 24


def scene(seed=1, size=(H + 160, W + 160)):
    """A textured backdrop (stands in for sand, dunes, sky) larger than the frame."""
    rng = np.random.default_rng(seed)
    base = cv2.GaussianBlur(rng.integers(0, 255, (*size, 3)).astype(np.uint8), (0, 0), 1.2)
    for _ in range(60):
        c = tuple(int(v) for v in rng.integers(0, 255, 3))
        cv2.circle(base, (int(rng.integers(0, size[1])), int(rng.integers(0, size[0]))), int(rng.integers(4, 18)), c, -1)
    return base


def person_layer(t, size, cx, cy, bob=6.0):
    """A body-like blob with its own texture that moves by itself (her own motion, not the camera's)."""
    mask = np.zeros(size, np.uint8)
    y = int(cy + bob * math.sin(t / 3))
    cv2.ellipse(mask, (cx, y), (38, 120), 0, 0, 360, 255, -1)
    cv2.circle(mask, (cx, y - 150), 28, 255, -1)
    tex = np.zeros((*size, 3), np.uint8)
    tex[:] = (60, 110, 190)
    for k in range(0, size[0], 9):
        cv2.line(tex, (0, k), (size[1], k + 12), (90, 140, 220), 2)
    return mask > 0, tex


def make_video(drift, n=N, person_at=None, seed=1):
    """drift(t) -> (dx, dy, zoom): the camera's movement over the scene. Returns frames, person masks, true transforms."""
    bg = scene(seed)
    sh, sw = bg.shape[:2]
    pcx, pcy = person_at or (sw // 2, sh // 2 + 40)
    frames, masks, truth = [], [], []
    for t in range(n):
        m, tex = person_layer(t, (sh, sw), pcx, pcy)
        comp = bg.copy()
        comp[m] = tex[m]
        dx, dy, z = drift(t)
        # camera: frame pixel p shows scene point A·p + b (zoom about the frame centre)
        A = np.array([[1 / z, 0, 80 + dx + (W / 2) * (1 - 1 / z)], [0, 1 / z, 80 + dy + (H / 2) * (1 - 1 / z)]])
        f = cv2.warpAffine(comp, A, (W, H), flags=cv2.INTER_LINEAR | cv2.WARP_INVERSE_MAP)
        pm = cv2.warpAffine(m.astype(np.uint8), A, (W, H), flags=cv2.INTER_NEAREST | cv2.WARP_INVERSE_MAP) > 0
        frames.append(f)
        masks.append(pm)
        truth.append(A)
    return np.stack(frames), masks, truth


def drifting(t):
    return (0.6 * t, 0.4 * t, 1 + 0.0004 * t)  # ≈14 px / 9 px over the clip, 1% push


def test_helpers_compose_and_corners():
    a = np.array([[1.0, 0, 5], [0, 1.0, -3]])
    b = np.array([[2.0, 0, 1], [0, 2.0, 1]])
    c = st.compose(a, b)
    assert np.allclose(c, [[2, 0, 6], [0, 2, -2]])
    px, fx, fy = st.corner_motion(a, 100, 200)
    assert math.isclose(px, math.hypot(5, 3)) and math.isclose(fx, 0.05) and math.isclose(fy, 0.015)
    d = st.decompose(np.array([[0, -1.0, 0], [1.0, 0, 0]]))
    assert math.isclose(d["scale"], 1) and math.isclose(d["rot"], 90)


def test_locks_a_drifting_camera():
    frames, masks, _ = make_video(drifting)
    out, rep = st.lock_camera(frames, masks)
    assert rep["status"] == "applied", rep
    assert out.shape == frames.shape and out.dtype == np.uint8  # same frames, same size: timing untouched
    assert rep["before"]["max_px"] > 8
    assert rep["after"]["max_px"] <= 2.0
    assert rep["body_lost_pct"] == 0
    assert rep["fill_pct"] < 10
    assert 0.85 <= rep["sharpness_ratio"] <= 1.2
    # her shape is unchanged: same mask area in every locked frame (similarity transform, scale within 1%)
    T, _, _, _ = st.track(frames, st.background_masks(masks, W, H))
    for i in (0, N // 2, N - 1):
        moved = cv2.warpAffine(masks[i].astype(np.uint8), T[i], (W, H), flags=cv2.INTER_NEAREST).sum()
        assert abs(moved / masks[i].sum() - 1) < 0.03
    # the background now matches frame 0 (away from her and the filled edges)
    bg = ~cv2.dilate(masks[-1].astype(np.uint8), np.ones((31, 31), np.uint8)).astype(bool) & ~cv2.dilate(masks[0].astype(np.uint8), np.ones((31, 31), np.uint8)).astype(bool)
    bg[:30], bg[-30:], bg[:, :30], bg[:, -30:] = False, False, False, False
    err_locked = np.abs(out[-1].astype(int) - out[0].astype(int))[bg].mean()
    err_orig = np.abs(frames[-1].astype(int) - frames[0].astype(int))[bg].mean()
    assert err_locked < 0.35 * err_orig


def test_steady_camera_is_left_alone():
    frames, masks, _ = make_video(lambda t: (0, 0, 1))
    out, rep = st.lock_camera(frames, masks)
    assert rep["status"] == "steady"
    assert out is frames


def test_large_pan_counts_as_intentional():
    frames, masks, _ = make_video(lambda t: (3.0 * t, 0, 1))  # ≈70 px = 22% of the width
    out, rep = st.lock_camera(frames, masks)
    assert rep["status"] == "rejected" and "intentional" in rep["reason"]
    assert out is frames


def test_body_at_the_edge_is_not_cut_or_smeared():
    # she stands low in the frame, feet past the bottom edge; the camera drifts up, so the bottom needs filling
    frames, masks, _ = make_video(lambda t: (0, -0.5 * t, 1), person_at=(240, 520))
    assert any(m[-1].any() for m in masks)
    out, rep = st.lock_camera(frames, masks)
    assert rep["status"] == "rejected"
    assert "edge" in rep["reason"] or "out of the frame" in rep["reason"]
    assert out is frames


def test_without_her_outline_nothing_is_changed():
    frames, _, _ = make_video(drifting)
    out, rep = st.lock_camera(frames, None)
    assert rep["status"] == "unavailable"
    assert out is frames


def test_too_short_video():
    frames, masks, _ = make_video(drifting, n=5)
    out, rep = st.lock_camera(frames, masks)
    assert rep["status"] == "rejected" and out is frames


def test_untrackable_background_is_rejected():
    frames, masks, _ = make_video(drifting)
    flat = frames.copy()
    for i, m in enumerate(masks):
        flat[i][~m] = 128  # a plain wall: nothing to track
    out, rep = st.lock_camera(flat, masks)
    assert rep["status"] in ("rejected", "steady")
    assert out is flat


if __name__ == "__main__":
    for name, fn in list(globals().items()):
        if name.startswith("test_"):
            fn()
            print("ok", name)
