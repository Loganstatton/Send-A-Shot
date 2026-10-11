"""The A/B script's copy of the face-check rule must match lib/identity.ts."""
import os
import re
import sys

ROOT = os.path.join(os.path.dirname(__file__), "..", "..", "..")
sys.path.insert(0, os.path.join(ROOT, "scripts"))
import face_check_ab as ab  # noqa: E402


def _ts_const(name):
    src = open(os.path.join(ROOT, "lib", "identity.ts")).read()
    m = re.search(rf"export const {name}(?::[^=]+)? = ([^;]+);", src)
    return m.group(1).strip()


def test_thresholds_match_the_app():
    assert float(_ts_const("FACE_THRESHOLD")) == ab.FACE_THRESHOLD
    assert float(_ts_const("FACE_TURNED_FLOOR")) == ab.FACE_TURNED_FLOOR
    assert float(_ts_const("FACE_MIN_SIZE")) == ab.FACE_MIN_SIZE
    assert float(_ts_const("TURNED_YAW")) == ab.TURNED_YAW
    assert float(_ts_const("TURNED_EYE_RATIO")) == ab.TURNED_EYE_RATIO
    assert float(_ts_const("HAIR_REL_MAX")) == ab.HAIR_REL_MAX
    assert tuple(float(x) for x in _ts_const("SKIN_HUE_RANGE").strip("[]").split(",")) == ab.SKIN_HUE_RANGE


def face(sim, **kw):
    return dict(found=True, similarity=sim, size=150, hair_rel=0.3, skin_hue=47, **kw)


def test_rules():
    assert ab.verdict_new(face(0.8), False) == "verified"
    assert ab.verdict_new(face(0.7), True) == "inconclusive"
    assert ab.verdict_new(face(0.7), False) == "mismatch"
    assert ab.verdict_new(face(0.66), True) == "mismatch"
    assert ab.verdict_new(dict(face(0.7), hair_rel=1.3), True) == "mismatch"
    assert ab.verdict_old(face(0.7), True) == "mismatch"


def test_replay_on_a_fixed_sequence():
    seq = [("a0", face(0.6)), ("a1", face(0.7)), ("a2", face(0.76)), ("a3", face(0.5))]
    assert ab.run_rule(seq, ab.verdict_old, True) == (3, "a2", "verified")
    assert ab.run_rule(seq, ab.verdict_new, True) == (2, "a1", "inconclusive")
    bad = [("a0", face(0.6)), ("a1", face(0.65)), ("a2", face(0.55)), ("a3", face(0.5))]
    assert ab.run_rule(bad, ab.verdict_new, True) == (4, "a1", "closest-of-4")
