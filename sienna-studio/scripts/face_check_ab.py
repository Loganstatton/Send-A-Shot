#!/usr/bin/env python3
"""
A/B validation of the face check: current rule (0.74 or retry) vs the pose-aware rule (lib/identity.ts).

Both systems are judged on the SAME photos. For every case and base seed, the GPU makes the four photos a request
could use (seeds s, s+1, s+2, s+3) with the app's own retries off; each photo is then scored offline with the same
YuNet/SFace models and sienna_face code the GPU node runs, and both retry rules are replayed on that fixed sequence.
So the only difference between the two columns is the rule.

  generate  APP_URL OUT_DIR            ask a running Sienna Studio (pointed at the GPU) for every photo
  score     OUT_DIR MODELS_DIR REF     face similarity, head turn, hair/skin colour for every photo (CPU)
  replay    OUT_DIR                    both rules on every sequence -> report.md + label sheets of delivered photos
  report    OUT_DIR LABELS.json        add human labels ("sienna" / "different" per delivered file) to the report

The thresholds below mirror lib/identity.ts; tests/test_face_check_ab.py keeps them in sync.
"""
import json
import os
import re
import sys
import time
import urllib.request

FACE_THRESHOLD = 0.74
FACE_TURNED_FLOOR = 0.68
FACE_MIN_SIZE = 64
TURNED_YAW = 0.35
TURNED_EYE_RATIO = 0.38
# hair/skin colour: measured, reported for analysis only (colour()), never used in a verdict
HAIR_REL_MAX = 1.0
SKIN_HUE_RANGE = (30.0, 65.0)
ATTEMPTS = 4
# from-behind cases get two extra photos so a longer fallback (6 tries) can be studied; the A/B uses the first 4
EXTRA_REAR = 2

# (id, from-behind?, style packs, fields). From-behind cases are what the new rule changes; facing-camera cases
# must come out identical under both rules.
CASES = [
    ("kneel_beach", True, {"all_fours": 0.8}, dict(outfit="black bikini", pose="kneeling, back arched, seen from behind, looking back over her shoulder at the camera", expression="playful smile", setting="sunny beach", lighting="golden hour sunlight", camera="iPhone photo taken by a friend")),
    ("kneel_bed", True, {"all_fours": 0.8}, dict(outfit="white crop top and denim shorts", pose="kneeling on the bed, seen from behind, looking back at the camera", expression="soft smile", setting="bright bedroom", lighting="natural window light", camera="iPhone photo")),
    ("sink_selfie", True, {"sink_selfie": 0.5}, dict(outfit="black crop top and light blue jeans", pose="mirror selfie from behind, sitting on the bathroom sink, looking back over her shoulder", expression="playful smile", setting="modern bathroom", lighting="warm indoor light", camera="iPhone mirror selfie")),
    ("look_back_street", True, {}, dict(outfit="red sundress", pose="walking away, looking back over her shoulder at the camera", expression="happy smile", setting="sunny city street", lighting="bright daylight", camera="iPhone photo taken by a friend")),
    ("profile_window", True, {}, dict(outfit="cream knit sweater", pose="side profile view, looking out of the window", expression="calm", setting="cozy living room", lighting="soft window light", camera="iPhone photo")),
    ("front_dress", False, {}, dict(outfit="fitted bright red bodycon dress", pose="standing, full body, facing the camera", expression="soft smile, looking at the camera", setting="bright modern apartment", lighting="natural window light", camera="iPhone photo")),
    ("front_selfie", False, {}, dict(outfit="pink hoodie and white shorts", pose="sitting on the couch", expression="playful smile, looking at the camera", setting="cozy living room", lighting="warm lamp light", camera="iPhone selfie")),
]
REAR_SEEDS = [1101, 2202, 3303, 4404, 5505, 6606]
FRONT_SEEDS = [1101, 2202, 3303]
EMPTY = {k: "" for k in ["outfit", "pose", "bodyPresentation", "expression", "setting", "lighting", "camera", "framing", "realism", "extra", "avoid"]}


def name(case, seed, k):
    return f"{case}__s{seed}__a{k}.png"


def _req(app, path, body=None):
    r = urllib.request.Request(app + path, data=json.dumps(body).encode() if body is not None else None,
                               method="POST" if body is not None else "GET", headers={"Content-Type": "application/json"})
    with urllib.request.urlopen(r, timeout=300) as f:
        return json.loads(f.read())


def generate(app, out, workers=6):
    """Every photo, several in flight at once so the GPU never waits on the network."""
    from concurrent.futures import ThreadPoolExecutor

    os.makedirs(out, exist_ok=True)
    params = _req(app, "/api/settings")["settings"]["defaultParams"]
    jobs = []
    for case, rear, packs, fields in CASES:
        for seed in REAR_SEEDS if rear else FRONT_SEEDS:
            for k in range(ATTEMPTS + (EXTRA_REAR if rear else 0)):
                if not os.path.exists(os.path.join(out, name(case, seed, k))):
                    jobs.append((case, packs, fields, seed, k))

    def one(job):
        case, packs, fields, seed, k = job
        t = time.time()
        rec = _req(app, "/api/generate", {
            "presetId": None, "workflowId": "sienna-sdxl-production", "siennaLock": True, "contentMode": "adult",
            "fields": dict(EMPTY, **fields),
            # the app's own face retries off: every attempt is made here, with a fixed seed
            "params": dict(params, batchSize=1, seed=seed + k, stylePacks=packs, faceCheck=False),
            "images": {"initImage": None, "poseImage": None, "faceReferenceId": None}})
        while time.time() - t < 1800:
            time.sleep(2)
            st = _req(app, f"/api/history/{rec['id']}/status")
            if st.get("status") in ("done", "error"):
                break
        full = _req(app, f"/api/history/{rec['id']}")
        full = full.get("record", full)
        if full.get("seed") != seed + k:
            # the top check redid it with a random seed; both rules still judge this same photo
            print(f"note: top check redid {case} s{seed} a{k} (seed {full.get('seed')})", flush=True)
        img = (full.get("images") or [{}])[0].get("file")
        if not img:
            print("FAILED", case, seed, k, (full.get("error") or "")[:120], flush=True)
            return
        with urllib.request.urlopen(f"{app}/api/files/{img}", timeout=120) as f, open(os.path.join(out, name(case, seed, k)), "wb") as o:
            o.write(f.read())
        print(f"{case} s{seed} a{k} {round(time.time() - t)}s", flush=True)

    with ThreadPoolExecutor(workers) as ex:
        list(ex.map(one, jobs))


def score(out, models_dir, ref_path):
    import cv2
    import numpy as np

    sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), "comfy_nodes", "sienna_nodes"))
    import sienna_face as sf

    det, rec = sf.models(models_dir)
    ref = sf.reference_embedding([json.load(open(ref_path))])
    rows = {}
    for fn in sorted(os.listdir(out)):
        if not fn.endswith(".png") or "__s" not in fn:
            continue
        img = cv2.imread(os.path.join(out, fn))
        found = sf.faces(img, det, rec)
        rows[fn] = sf.check(found, ref, FACE_THRESHOLD, FACE_MIN_SIZE)
        rows[fn].update({k: found[0][k] for k in ("hair_rel", "skin_hue", "mono") if found and k in found[0]})
    json.dump(rows, open(os.path.join(out, "scores.json"), "w"), indent=1)
    print(len(rows), "photos scored")


def colour(r):
    if r.get("mono"):
        return "unknown"
    bad = (r.get("hair_rel") is not None and r["hair_rel"] > HAIR_REL_MAX) or (
        r.get("skin_hue") is not None and not SKIN_HUE_RANGE[0] <= r["skin_hue"] <= SKIN_HUE_RANGE[1])
    return "differs" if bad else "consistent"


def verdict_new(r, rear):
    """Mirror of faceVerdict(..., 'pose-aware') in lib/identity.ts (experimental, dev only)."""
    sim = r.get("similarity")
    if not r.get("found") or sim is None:
        return "inconclusive"
    if r.get("size", FACE_MIN_SIZE) < FACE_MIN_SIZE:
        return "inconclusive"
    if sim >= FACE_THRESHOLD:
        return "verified"
    turned = rear or r.get("yaw", 0) > TURNED_YAW or r.get("eye_ratio", 1) < TURNED_EYE_RATIO
    if turned and sim >= FACE_TURNED_FLOOR:
        return "inconclusive"  # hair/skin colour no longer gates anything (lib/identity.ts)
    return "mismatch"


def verdict_old(r, rear):
    """The deployed rule: below 0.74 is redone; no face / tiny face passes."""
    if not r.get("found") or r.get("similarity") is None or r.get("size", FACE_MIN_SIZE) < FACE_MIN_SIZE:
        return "pass"
    return "verified" if r["similarity"] >= FACE_THRESHOLD else "mismatch"


def run_rule(seq, verdict, rear):
    """(attempts used, delivered file, delivered verdict) for one sequence of four scored photos."""
    vs = [(fn, r, verdict(r, rear)) for fn, r in seq]
    for i, (fn, r, v) in enumerate(vs):
        if v != "mismatch":
            return i + 1, fn, v
    fn, r, v = max(vs, key=lambda x: x[1].get("similarity") or -1)  # all failed: the closest, flagged
    return len(vs), fn, "closest-of-4"


def replay(out):
    scores = json.load(open(os.path.join(out, "scores.json")))
    rows = []
    for case, rear, _, _ in CASES:
        for seed in REAR_SEEDS if rear else FRONT_SEEDS:
            seq = [(name(case, seed, k), scores.get(name(case, seed, k))) for k in range(ATTEMPTS)]
            if any(r is None for _, r in seq):
                continue
            a = run_rule(seq, verdict_old, rear)
            b = run_rule(seq, verdict_new, rear)
            rows.append(dict(case=case, seed=seed, rear=rear, old_n=a[0], old_file=a[1], old_v=a[2], new_n=b[0], new_file=b[1], new_v=b[2]))
    json.dump(rows, open(os.path.join(out, "replay.json"), "w"), indent=1)
    delivered = sorted({r["old_file"] for r in rows} | {r["new_file"] for r in rows})
    json.dump({f: "" for f in delivered}, open(os.path.join(out, "labels_todo.json"), "w"), indent=1)
    print(summary(rows, None))
    print(f"\n{len(delivered)} delivered photos to label: fill labels_todo.json with 'sienna' or 'different', then run `report`.")


def summary(rows, labels):
    out = []
    for title, sel in (("From-behind requests", True), ("Facing-camera requests", False)):
        rs = [r for r in rows if r["rear"] == sel]
        if not rs:
            continue
        out.append(f"### {title} ({len(rs)} photos)\n")
        out.append("| | Current rule | Pose-aware rule |\n|---|---|---|")
        for label, key in (("Generations", "n"),):
            out.append(f"| {label} | {sum(r['old_n'] for r in rs)} | {sum(r['new_n'] for r in rs)} |")
        for v in ("verified", "inconclusive", "closest-of-4", "pass"):
            o, n = sum(r["old_v"] == v for r in rs), sum(r["new_v"] == v for r in rs)
            if o or n:
                out.append(f"| Delivered as {v} | {o} | {n} |")
        if labels:
            wo = sum(labels.get(r["old_file"]) == "different" for r in rs)
            wn = sum(labels.get(r["new_file"]) == "different" for r in rs)
            out.append(f"| **Delivered a different-looking woman** | **{wo}** | **{wn}** |")
            only_new = [r for r in rs if labels.get(r["new_file"]) == "different" and labels.get(r["old_file"]) != "different"]
            out.append(f"| Wrong only under the new rule | | {len(only_new)} |")
        out.append("")
    return "\n".join(out)


def report(out, labels_path):
    rows = json.load(open(os.path.join(out, "replay.json")))
    labels = json.load(open(labels_path))
    text = "# Face check A/B: current vs pose-aware\n\n" + summary(rows, labels)
    open(os.path.join(out, "report.md"), "w").write(text)
    print(text)


if __name__ == "__main__":
    cmd = sys.argv[1] if len(sys.argv) > 1 else ""
    if cmd == "generate":
        generate(sys.argv[2], sys.argv[3])
    elif cmd == "score":
        score(sys.argv[2], sys.argv[3], sys.argv[4])
    elif cmd == "replay":
        replay(sys.argv[2])
    elif cmd == "report":
        report(sys.argv[2], sys.argv[3])
    else:
        print(__doc__)
