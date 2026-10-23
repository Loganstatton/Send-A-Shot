"""One figure-pass step in its own process (sienna_figure.run_isolated): the node waits with a hard timeout and kills
this process if it stalls, so a hung step can never hold up the whole photo (two photos stalled in the paste-back on
the GPU machine, 23 Oct). Reads <in.npz>, writes <out.npz>; timings go to stderr and into the result's info.

  mask       image, person, face?  + params kp, grow       → hard, soft
  composite  src, red, hard, soft  + params color_match    → image
  sleep      (tests only) sleeps params.seconds
"""
import json
import os
import sys
import time

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))


def main(inp: str, out: str) -> None:
    t0 = time.time()
    timing = {}

    def mark(name: str, since: float) -> float:
        now = time.time()
        timing[name] = round(now - since, 3)
        print(f"[SiennaFigure worker] {name} {timing[name]:.2f}s", file=sys.stderr, flush=True)
        return now

    import numpy as np

    data = np.load(inp, allow_pickle=False)
    task = str(data["task"])
    params = json.loads(str(data["params"]))
    t = mark("load", t0)
    if task == "sleep":
        time.sleep(float(params.get("seconds", 1)))
        np.savez(out, info=np.array(json.dumps({"slept": True})))
        return
    import sienna_figure as fg
    from sienna_redraw import segment_classes, segmenter_error

    info: dict = {}
    if task == "mask":
        img = data["image"]
        classes = segment_classes(img)
        t = mark("segment", t)
        person = data["person"] if "person" in data.files else None
        if person is None and classes:
            person = 1.0 - classes[0]
        kp = [tuple(p) if p else None for p in params["kp"]]
        hard, soft, info = fg.figure_region(img.shape[:2], person, kp, classes, data["face"] if "face" in data.files else None,
                                            grow=float(params.get("grow", 0.06)))
        t = mark("region", t)
        if classes is None:
            info["segmenter_error"] = segmenter_error()
        info["timing"] = timing
        np.savez(out, hard=hard, soft=soft, info=np.array(json.dumps(info)))
    elif task == "composite":
        src, red, hard, soft = data["src"], data["red"], data["hard"], data["soft"]
        import cv2

        cs, cr = segment_classes(src), segment_classes(red)
        t = mark("segment", t)
        matched, info["color_shift"] = fg.match_colors(src, red, cv2.dilate((hard > 0.5).astype(np.uint8), np.ones((15, 15), np.uint8)),
                                                       cs, cr, float(params.get("color_match", 1.0)))
        t = mark("color_match", t)
        res = fg.composite(src, matched, soft)
        t = mark("blend", t)
        if cs:
            band = np.where((hard > 0.5).any(1))[0]
            co = segment_classes(res)
            if co is not None and band.size:
                info.update(fg.outline_change(1.0 - cs[0], 1.0 - co[0], (band.min(), band.max())))
            t = mark("outline", t)
        else:
            info["segmenter_error"] = segmenter_error()
        info["timing"] = timing
        np.savez(out, image=res.astype(np.float32), info=np.array(json.dumps(info)))
    else:
        raise SystemExit(f"unknown task {task}")
    mark("total", t0)


if __name__ == "__main__":
    main(sys.argv[1], sys.argv[2])
