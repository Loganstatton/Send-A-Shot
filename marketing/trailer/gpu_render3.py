"""Trailer copy of ../commercial2/gpu_render2.py (uploads this folder's scene modules).
Render the commercial on a RunPod GPU pod, then delete the pod.

  RUNPOD_API_KEY=... python gpu_render.py SCENE.py OUT_DIR --frames 1-90 [--gpu-type "NVIDIA GeForce RTX 4090"]

(In the cloud session the key is injected by the network proxy, so
RUNPOD_API_KEY can be any placeholder.) The pod runs a tiny token-protected
file/command server on port 8000, reached through RunPod's HTTPS proxy:
we upload the scene script and fonts, install Blender (bpy) on the pod,
render with OptiX, pull the frames back as a tar, and always delete the pod,
even on failure. A hard lifetime limit inside the pod removes it on its own
if this script dies.
"""
import io, json, os, secrets, sys, tarfile, time, urllib.request, urllib.error

API = 'https://rest.runpod.io/v1'
KEY = os.environ.get('RUNPOD_API_KEY', 'injected-by-proxy')
args = sys.argv[1:]
SCENE, OUT = args[0], args[1]
# Several scenes in one pod session: --scenes "scene2.py:1-180,scene3.py:1-216" (frames land in OUT/<scene>/)
SCENES = [tuple(x.split(':')) for x in (args[args.index('--scenes') + 1].split(',') if '--scenes' in args else [])]
ASSET_DIR = args[args.index('--assets') + 1] if '--assets' in args else None
def arg(n, d=None): return args[args.index(n) + 1] if n in args else d
FRAMES = arg('--frames', '1-90')
GPU_TYPES = [arg('--gpu-type')] if arg('--gpu-type') else ['NVIDIA GeForce RTX 4090', 'NVIDIA GeForce RTX 5090', 'NVIDIA L40S', 'NVIDIA RTX 6000 Ada Generation', 'NVIDIA RTX A6000',
             'NVIDIA L40', 'NVIDIA A40', 'NVIDIA GeForce RTX 3090', 'NVIDIA RTX A5000']
IMAGE = arg('--image', 'runpod/pytorch:2.4.0-py3.11-cuda12.4.1-devel-ubuntu22.04')
MAX_MIN = int(arg('--max-minutes', '45'))
HERE = os.path.dirname(os.path.abspath(__file__))
TOKEN = secrets.token_hex(24)
# RunPod sits behind Cloudflare, which rejects Python's default user agent (error 1010).
UA = 'next-commercial-render/1.0 (+curl-compatible)'

def api(method, path, body=None):
    req = urllib.request.Request(API + path, method=method, data=None if body is None else json.dumps(body).encode(),
                                 headers={'Authorization': f'Bearer {KEY}', 'Content-Type': 'application/json', 'User-Agent': UA})
    try:
        with urllib.request.urlopen(req, timeout=60) as r:
            t = r.read().decode()
            return json.loads(t) if t else {}
    except urllib.error.HTTPError as e:
        raise SystemExit(f'RunPod {method} {path} -> {e.code}: {e.read().decode()[:400]}')

SERVER = r'''
import http.server, json, os, subprocess, sys, tarfile, io, threading
TOKEN = os.environ["WORKER_TOKEN"]; ROOT = "/work"; os.makedirs(ROOT, exist_ok=True)
jobs = {}
class H(http.server.BaseHTTPRequestHandler):
    def ok(self):
        if self.headers.get("X-Token") != TOKEN: self.send_response(403); self.end_headers(); return False
        return True
    def send(self, code, body=b"", ctype="application/json"):
        self.send_response(code); self.send_header("Content-Type", ctype); self.send_header("Content-Length", str(len(body))); self.end_headers(); self.wfile.write(body)
    def do_PUT(self):
        if not self.ok(): return
        rel = self.path[3:] if self.path.startswith("/f/") else self.path.lstrip("/")
        p = os.path.join(ROOT, rel); os.makedirs(os.path.dirname(p), exist_ok=True)
        n = int(self.headers["Content-Length"]); open(p, "wb").write(self.rfile.read(n)); self.send(200, b"{}")
    def do_POST(self):
        if not self.ok(): return
        cmd = json.loads(self.rfile.read(int(self.headers["Content-Length"])))["cmd"]
        log = open(os.path.join(ROOT, "job.log"), "ab")
        jobs["p"] = subprocess.Popen(["bash", "-lc", cmd], cwd=ROOT, stdout=log, stderr=subprocess.STDOUT)
        self.send(200, b"{}")
    def do_GET(self):
        if self.path == "/health": return self.send(200, b"ok", "text/plain")
        if not self.ok(): return
        if self.path == "/status":
            p = jobs.get("p"); rc = None if not p else p.poll()
            tail = open(os.path.join(ROOT, "job.log"), "rb").read()[-3000:] if os.path.exists(os.path.join(ROOT, "job.log")) else b""
            return self.send(200, json.dumps({"running": bool(p) and rc is None, "rc": rc, "log": tail.decode("utf8", "replace")}).encode())
        if self.path.startswith("/tar/"):
            d = os.path.join(ROOT, self.path[5:]); buf = io.BytesIO()
            with tarfile.open(fileobj=buf, mode="w") as t: t.add(d, arcname=".")
            return self.send(200, buf.getvalue(), "application/x-tar")
        self.send(404)
    def log_message(self, *a): pass
http.server.ThreadingHTTPServer(("0.0.0.0", 8000), H).serve_forever()
'''

def start_cmd():
    # Lifetime limit inside the pod, so it removes itself even if we vanish.
    return (f'(sleep {MAX_MIN * 60}; runpodctl remove pod "$RUNPOD_POD_ID") >/dev/null 2>&1 & '
            f"cat > /server.py <<'PYEOF'\n{SERVER}\nPYEOF\n"
            'exec python3 /server.py')

def worker(method, path, data=None, headers=None, timeout=120, tries=6):
    # RunPod's proxy can briefly 404/502 right after a pod starts: retry.
    for i in range(tries):
        req = urllib.request.Request(BASE + path, method=method, data=data, headers={'X-Token': TOKEN, 'User-Agent': UA, **(headers or {})})
        try:
            with urllib.request.urlopen(req, timeout=timeout) as r:
                return r.read()
        except (urllib.error.HTTPError, urllib.error.URLError, TimeoutError) as e:
            if i == tries - 1: raise
            time.sleep(5 * (i + 1))

pod_id = None
try:
    pod = None
    for cloud, gpu in [(c, g) for c in ('SECURE', 'COMMUNITY') for g in GPU_TYPES]:
        if pod and pod.get('id'): break
        try:
            pod = api('POST', '/pods', {
                'name': 'next-commercial-render', 'imageName': IMAGE, 'gpuTypeIds': [gpu], 'gpuCount': 1,
                'cloudType': cloud, 'containerDiskInGb': 30, 'ports': ['8000/http'],
                'env': {'WORKER_TOKEN': TOKEN}, 'dockerEntrypoint': ['bash', '-c'], 'dockerStartCmd': [start_cmd()],
            })
            print('pod', pod.get('id'), 'on', gpu, cloud, flush=True)
        except SystemExit as e:
            print('no', gpu, cloud, '-', str(e)[:100], flush=True)
    if not pod or not pod.get('id'): raise SystemExit('could not get a GPU pod')
    pod_id = pod['id']
    BASE = f'https://{pod_id}-8000.proxy.runpod.net'
    t0 = time.time()
    while True:
        try:
            # RunPod's proxy answers /health itself; only our worker answers
            # /status (token-protected) with this JSON.
            if 'running' in json.loads(worker('GET', '/status', timeout=15)): break
        except Exception:
            pass
        if time.time() - t0 > 900: raise SystemExit('pod did not come up in 15 minutes')
        time.sleep(10)
    print(f'worker up after {time.time() - t0:.0f}s', flush=True)
    # Trailer: every scene module in this folder + the Ad #1 toolkit and fonts (read-only)
    AD1 = os.path.join(HERE, '..', 'commercial')
    files = {f: os.path.join(HERE, f) for f in os.listdir(HERE) if f.endswith('.py') and not f.startswith(('gpu_render', 'post', 'mix', 'music', 'vo'))}
    files['next3d.py'] = os.path.join(AD1, 'next3d.py')
    for f in ('phone2.py', 'card2.py'): files[f] = os.path.join(HERE, '..', 'commercial2', f)   # read-only imports
    for f in os.listdir(os.path.join(AD1, 'fonts')): files[f'fonts/{f}'] = os.path.join(AD1, 'fonts', f)
    if ASSET_DIR:
        for dp, _, fs in os.walk(ASSET_DIR):              # including subfolders (cards/)
            for f in fs: files['assets/' + os.path.relpath(os.path.join(dp, f), ASSET_DIR).replace(os.sep, '/')] = os.path.join(dp, f)
    for name, path in files.items():
        worker('PUT', f'/f/{name}', open(path, 'rb').read())
    a, b = FRAMES.split('-')
    def job(sc_, fr):                       # "opening.py@b" renders hook b into frames/opening_b
        base, _, hk = sc_.partition('@')
        return f'python3.11 {base} -- --gpu --assets assets --frames {fr} --out frames/{base[:-3]}{"_" + hk if hk else ""}' + (f' --hook {hk}' if hk else '')
    renders = [job(sc_, fr) for sc_, fr in SCENES] or \
              [f'python3.11 {os.path.basename(SCENE)} -- --gpu --frames {a}-{b} --out frames']
    cmd = ('apt-get update -qq && apt-get install -y -qq libxrender1 libxi6 libxkbcommon0 libsm6 libgl1 libegl1 >/dev/null; '
           'python3.11 -m pip install -q --timeout 120 --retries 10 bpy==5.0.1 && nvidia-smi -L && ' + ' && '.join(renders))
    worker('POST', '/run', json.dumps({'cmd': cmd}).encode(), {'Content-Type': 'application/json'})
    last = ''
    while True:
        st = json.loads(worker('GET', '/status'))
        tail = st['log'].strip().splitlines()[-1:] if st['log'].strip() else []
        if tail and tail[0] != last: print('  ', tail[0][:150], flush=True); last = tail[0]
        if not st['running'] and st['rc'] is not None:
            if st['rc'] != 0: raise SystemExit('render failed:\n' + st['log'][-1500:])
            break
        time.sleep(15)
    os.makedirs(OUT, exist_ok=True)
    data = worker('GET', '/tar/frames', timeout=600)
    with tarfile.open(fileobj=io.BytesIO(data)) as t: t.extractall(OUT)
    print(f'frames saved to {OUT} ({len(data) / 1e6:.0f} MB) in {(time.time() - t0) / 60:.1f} min', flush=True)
finally:
    if pod_id:
        api('DELETE', f'/pods/{pod_id}')
        print('pod deleted', pod_id, flush=True)
