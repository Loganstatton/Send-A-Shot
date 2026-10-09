"""Cost guard for a Runpod GPU: terminate this Pod after SIENNA_IDLE_MINUTES (default 30) without ComfyUI work.

Loaded by ComfyUI like any custom node (it adds no nodes). Work = something queued or running, or a new entry in the
history. Terminating keeps the network volume (models, LoRA, ComfyUI install), so the next Pod starts from it.
Does nothing outside Runpod (no RUNPOD_POD_ID / RUNPOD_API_KEY) or with SIENNA_IDLE_MINUTES=0.
"""
import json
import os
import subprocess
import threading
import time
import urllib.request

NODE_CLASS_MAPPINGS = {}
NODE_DISPLAY_NAME_MAPPINGS = {}

POD, KEY = os.environ.get("RUNPOD_POD_ID"), os.environ.get("RUNPOD_API_KEY")
IDLE_MIN = float(os.environ.get("SIENNA_IDLE_MINUTES", "30") or 0)
PORT = os.environ.get("COMFYUI_PORT", "8188")
LOG = "/workspace/autostop.log"


def _log(msg):
    try:
        with open(LOG, "a") as f:
            f.write(time.strftime("%Y-%m-%d %H:%M:%S ") + msg + "\n")
    except OSError:
        pass


def _get(path):
    with urllib.request.urlopen(f"http://127.0.0.1:{PORT}{path}", timeout=10) as r:
        return json.loads(r.read() or b"{}")


def _busy_marker():
    q = _get("/queue")
    h = _get("/history?max_items=1")
    return bool(q.get("queue_running") or q.get("queue_pending")), next(iter(h), None)


def _terminate():
    _log(f"idle for {IDLE_MIN:g} min - terminating pod {POD} (network volume is kept)")
    try:
        req = urllib.request.Request(f"https://rest.runpod.io/v1/pods/{POD}", method="DELETE",
                                     headers={"Authorization": f"Bearer {KEY}", "User-Agent": "sienna-autostop"})
        urllib.request.urlopen(req, timeout=30).read()
        _log("terminate requested (REST)")
        return
    except Exception as e:  # fall back to the CLI that Runpod images ship
        _log(f"REST terminate failed: {e}")
    try:
        out = subprocess.run(["runpodctl", "remove", "pod", POD], capture_output=True, text=True, timeout=60)
        _log(f"runpodctl: {out.returncode} {out.stdout.strip()} {out.stderr.strip()}")
    except Exception as e:
        _log(f"runpodctl failed: {e}")


def _watch():
    last_work, last_hist = time.time(), None
    while True:
        time.sleep(60)
        try:
            busy, hist = _busy_marker()
        except Exception:
            continue  # ComfyUI still starting or restarting
        if busy or hist != last_hist:
            last_work, last_hist = time.time(), hist
        elif time.time() - last_work >= IDLE_MIN * 60:
            _terminate()
            time.sleep(600)


if POD and KEY and IDLE_MIN > 0 and not globals().get("_STARTED"):
    _STARTED = True
    threading.Thread(target=_watch, name="sienna-autostop", daemon=True).start()
    _log(f"armed: terminate after {IDLE_MIN:g} idle minutes")
