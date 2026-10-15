"""Local tests (no GPU, no torch): python3 scripts/wa2_identity/tests/test_wa2_identity.py"""
import json, os, subprocess, sys, tempfile
import numpy as np, cv2
HERE = os.path.dirname(os.path.abspath(__file__)); sys.path.insert(0, os.path.dirname(HERE))
from convert_lora import convert, convert_key, check_pairs
from face_loss import face_bounds
import build_metadata as bm

SP = '/tmp/claude-0/-home-user-Send-A-Shot/5ab8d7bf-5d0f-550f-a69c-62a6985b93f2/scratchpad'
PILOT = f'{SP}/wanpilot/lora/sienna_wan21_pilot.safetensors'   # LoRA ComfyUI's WA2 loaded with 0 unloaded keys


def fake_diffsynth_lora(rank=4, blocks=40, modules=('self_attn.q', 'self_attn.k', 'self_attn.v'), peft=False, prefix=''):
    sd = {}
    for b in range(blocks):
        for m in modules:
            suf = '.default.weight' if peft else '.weight'
            sd[f'{prefix}blocks.{b}.block.{m}.lora_A{suf}'] = np.zeros((rank, 64), np.float16)
            sd[f'{prefix}blocks.{b}.block.{m}.lora_B{suf}'] = np.zeros((64, rank), np.float16)
    return sd


def test_convert_keys():
    assert convert_key('blocks.7.block.self_attn.q.lora_A.weight') == 'diffusion_model.blocks.7.self_attn.q.lora_A.weight'
    assert convert_key('pipe.dit.blocks.0.block.cross_attn.k_img.lora_B.default.weight') == 'diffusion_model.blocks.0.cross_attn.k_img.lora_B.weight'
    assert convert_key('blocks.3.ffn.0.lora_A.weight') == 'diffusion_model.blocks.3.ffn.0.lora_A.weight'   # already unwrapped
    for bad in ('blocks.1.block.norm1.lora_A.weight', 'head.head.lora_A.weight', 'blocks.1.block.self_attn.q.weight'):
        try:
            convert_key(bad); raise AssertionError(f'accepted {bad}')
        except ValueError:
            pass


def test_convert_full_and_pairs():
    for peft in (False, True):
        out = convert(fake_diffsynth_lora(peft=peft, prefix='pipe.dit.' if peft else ''))
        assert len(out) == 40 * 3 * 2 and check_pairs(out) == 4
        assert sorted({int(k.split('.')[2]) for k in out}) == list(range(40))
    out = convert(fake_diffsynth_lora(), alpha=32)
    assert sum(k.endswith('.alpha') for k in out) == 120


def test_matches_known_good_comfy_format():
    """Converted keys must be byte-identical to the layout ComfyUI's WA2 loaded in the pilot."""
    if not os.path.exists(PILOT):
        print('  (pilot LoRA not present; skipped)'); return
    from safetensors import safe_open
    with safe_open(PILOT, 'np') as f:
        good = set(f.keys())
    out = set(convert(fake_diffsynth_lora(modules=('self_attn.q', 'self_attn.k', 'self_attn.v', 'self_attn.o', 'cross_attn.q', 'ffn.0', 'ffn.2'))))
    missing = out - good
    assert not missing, f'{len(missing)} converted keys not in the known-good layout, e.g. {sorted(missing)[:3]}'


def test_face_bounds():
    assert face_bounds('', 96, 66) is None and face_bounds(None, 96, 66) is None
    r0, r1, c0, c1 = face_bounds('0.4,0.1,0.6,0.3', 96, 66, pad=0)
    assert (r0, r1, c0, c1) == (9, 29, 26, 40)
    r0, r1, c0, c1 = face_bounds('0.0,0.0,0.2,0.2', 96, 66)          # padding clamps at the edge
    assert r0 == 0 and c0 == 0 and r1 > 19
    try:
        face_bounds('0.6,0.1,0.4,0.3', 96, 66); raise AssertionError('accepted inverted box')
    except ValueError:
        pass


def test_build_metadata_and_clips():
    A = f'{SP}/stageA'; d0 = tempfile.mkdtemp()
    sets = [
        {'id': 'demo_profile', 'reference': f'{SP}/sienna_v2_dataset/sienna_v2_013.jpg', 'driver': f'{A}/pose_src/profL2.png',
         'target': f'{A}/pose_cands/p03.png', 'face_box': '0.15,0.18,0.55,0.42', 'clip': True, 'loss_mask': f'{d0}/mask.png'},
        {'id': 'demo_front', 'reference': f'{SP}/sienna_v2_dataset/sienna_v2_013.jpg', 'driver': f'{A}/pose_src/talk.png',
         'target': f'{A}/pose_cands/p43.png', 'face_box': ''},
    ]
    m0 = np.zeros((1216, 832), np.uint8); m0[100:500, 200:600] = 255; cv2.imwrite(f'{d0}/mask.png', m0)
    if not all(os.path.exists(s[k]) for s in sets for k in ('reference', 'driver', 'target')):
        print('  (sample images missing; skipped)'); return
    with tempfile.TemporaryDirectory() as d:
        meta = bm.build(sets, d)
        assert len(meta) == 3                      # 2 single-frame samples + 1 clip
        for m in meta:
            for k in ('video', 'animate2_reference_image', 'animate2_reference_video'):
                assert os.path.exists(os.path.join(d, m[k])), m[k]
            assert m['animate2_prompt_ref'] == bm.MOTION_TEXT and m['prompt'] == bm.TRAIN_PROMPT   # no per-sample text
        assert meta[0]['loss_mask'] == 'masks/demo_profile.png' and meta[2]['loss_mask'] == ''
        mk = cv2.imread(f'{d}/masks/demo_profile.png', 0); assert mk.shape == (bm.H, bm.W) and set(np.unique(mk)) <= {0, 255}
        cm = cv2.imread(f'{d}/{meta[1]["loss_mask"]}', 0); assert (cm > 0).sum() >= (mk > 0).sum()   # clip mask = union
        try:
            bm.build([dict(sets[1], prompt='smiling, head turned left')], d); raise AssertionError('per-sample prompt accepted')
        except ValueError:
            pass
        im = cv2.imread(f'{d}/targets/demo_profile.png'); assert im.shape[:2] == (bm.H, bm.W)
        assert bm.W % 16 == 0 and bm.H % 16 == 0 and (bm.CLIP_FRAMES - 1) % 4 == 0
        cap = cv2.VideoCapture(f'{d}/clips/demo_profile_target.mp4'); n = 0
        while cap.read()[0]: n += 1
        assert n == bm.CLIP_FRAMES, n
        clip_box = [float(v) for v in meta[1]['face_box'].split(',')]
        assert clip_box[0] <= 0.15 + 0.05 and clip_box[2] >= 0.55 - 0.05   # union covers the face through the move
        # the camera move is identical for target and driver, frame by frame
        a, b = cv2.VideoCapture(f'{d}/clips/demo_profile_target.mp4'), cv2.VideoCapture(f'{d}/clips/demo_profile_driver.mp4')
        assert int(a.get(cv2.CAP_PROP_FRAME_COUNT)) == int(b.get(cv2.CAP_PROP_FRAME_COUNT))


def test_mask_to_latent():
    from face_loss import mask_to_latent
    m = np.zeros((768, 528), np.uint8); m[0:384, 0:264] = 255          # top-left quarter is head
    w = mask_to_latent(m, 96, 66)
    assert w.shape == (96, 66) and abs(w[:48, :33].mean() - 1) < 1e-6 and w[48:, :].max() == 0 and w[:, 33:].max() == 0


def test_pair_gate_rules():
    from pair_qa import PairQA
    Q = object.__new__(PairQA)   # gate() needs no models
    base = dict(yaw=-20.0, pitch=5.0, jaw=0.0, smile=0.7, mouth_gap=0.0, blink=0.1, id=0.8, hair_lab=[40, 134, 137],
                lm=[[0, 0]] * 478, face_h=100.0)
    base['lm'] = [[float(i), 0.0] for i in range(478)]
    base['body'] = [[float(i * 7 % 50), float(i * 13 % 90), 1.0] for i in range(33)]       # same visible body pose
    drv = dict(base, id=0.2, hair_lab=[14, 128, 127])
    c, v, why = Q.gate(base, drv)
    assert v == 'PASS', why
    c, v, why = Q.gate(base, dict(drv, smile=0.1))                  # smile mismatch fails
    assert v == 'FAIL' and 'smile' in why
    c, v, why = Q.gate(base, dict(drv, id=0.5))                     # driver too much like Sienna fails
    assert v == 'FAIL' and 'driver_id' in why
    c, v, why = Q.gate(base, dict(drv, hair_lab=[42, 134, 137]))     # similar hair needs review
    assert v == 'REVIEW'
    c, v, why = Q.gate(dict(base, yaw=-60.0, id=0.5), dict(drv, yaw=-58.0))  # profile: identity by eye
    assert v == 'REVIEW' and c['target_id'][1] is None
    body = [[0, 0, 1]] * 33; body = [list(b) for b in body]
    body[11], body[12], body[0] = [10, 0, 1], [0, 0, 1], [5, -5, 1]
    back = [list(b) for b in body]; back[0] = [5, -5, 0.1]
    assert PairQA.facing(body) == 1 and PairQA.facing(back) == -1


def test_similarity_and_warp_identity():
    from driver_edit import similarity, piecewise_warp
    src = np.random.RandomState(0).rand(30, 2) * 100 + 50
    a = np.radians(10); R = np.array([[np.cos(a), -np.sin(a)], [np.sin(a), np.cos(a)]])
    s, R2, t = similarity(src, 1.5 * src @ R.T + [3, 4])
    assert abs(s - 1.5) < 1e-6 and np.allclose(R2, R, atol=1e-6) and np.allclose(t, [3, 4], atol=1e-4)
    img = (np.random.RandomState(1).rand(240, 200, 3) * 255).astype(np.uint8)
    out = piecewise_warp(img, src, src.copy())                                 # no movement -> unchanged image
    assert np.abs(out.astype(int) - img.astype(int)).mean() < 2.0



def test_rotation_mask_excludes_reflected_border():
    mask = np.zeros((768, 528), np.uint8); mask[:300, :] = 255          # head touching the top edge
    r = bm.rotate_mask(mask, 30, (264, 150))
    assert r.any() and set(np.unique(r)) <= {0, 255}
    valid = bm.rotate_about(np.full_like(mask, 255), 30, (264, 150), cv2.INTER_NEAREST, cv2.BORDER_CONSTANT)
    assert not (r[valid == 0] > 0).any()                                  # nothing scored outside the real frame
    assert r[0, 0] == 0 and r[0, -1] == 0                                  # corners are reflected border


def test_rotation_changes_tilt_sign():
    img = np.zeros((768, 528), np.uint8); cv2.line(img, (164, 300), (364, 300), 255, 9)   # level "eye line"
    r = bm.rotate_about(img, 20, (264, 300), cv2.INTER_NEAREST, cv2.BORDER_CONSTANT)
    ys, xs = np.nonzero(r); slope = np.degrees(np.arctan(np.polyfit(xs, ys, 1)[0]))
    assert abs(slope + 20) < 2     # +20 (counter-clockwise) -> measured tilt -20, as make_pilot assumes


def test_pilot_composition():
    import make_pilot as mp
    frozen = '/home/user/Send-A-Shot/stageA_review/wa2_dataset_frozen_v1'
    if not os.path.exists(frozen):
        return
    for inc in ([], ['R1-17', 'P41', 'P3']):
        ents, n, info = mp.compose(frozen, inc)
        assert n == mp.ROWS and info['steps'] == 300
        ids = {e['id'].split('_')[0] for e in ents}
        assert ids >= {'O-004', 'O-011', 'R1-09'} and not ids & {'P5', 'P6', 'P8', 'P42', 'O-006', 'O-017'}
        assert set(inc) <= ids and all(abs(e.get('rotate', 0)) <= mp.MAX_ROT for e in ents)
        assert sum(e['clip'] for e in ents) <= mp.MAX_CLIPS
    try:
        mp.compose(frozen, ['O-001']); assert False, 'a training pair is not a review pair'
    except ValueError:
        pass



def test_pilot_guard_cap_and_protection():
    import importlib, time as _t
    sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'pilot'))
    g = importlib.import_module('pilot_guard')
    now = 1_000_000.0
    L = {'cap': 3.0, 'pods': [{'id': 'a', 'name': 'sienna_wa2_pilot_1', 'rate': 0.6, 'started': now - 3600, 'deadline': now + 1800}], 'volume': None}
    assert abs(g.spent(L, now) - 0.6) < 1e-6 and abs(g.committed(L, now) - 0.3) < 1e-6
    m = g.budget_minutes(L, 0.6, now)                     # (3.0 - 0.05 - 0.6 - 0.3) / 0.6 h
    assert abs(m - (3.0 - 0.05 - 0.9) / 0.6 * 60) < 1e-6
    L['pods'][0]['ended'] = now
    assert g.committed(L, now) == 0
    for vid, name in (('u4odco714x', 'sienna-wa2-pilot'), ('x', 'sienna-studio'), ('x', 'other')):
        try:
            g.check_volume_allowed(vid, name); assert False, (vid, name)
        except SystemExit:
            pass
    g.check_volume_allowed('abc', 'sienna-wa2-pilot')
    try:
        g.check_pod_allowed('sienna-comfyui'); assert False
    except SystemExit:
        pass
    d = tempfile.mkdtemp(); open(d + '/x.bin', 'wb').write(b'abc')
    import hashlib
    open(d + '/SHA256SUMS', 'w').write(hashlib.sha256(b'abc').hexdigest() + '  x.bin\n'); assert g.sha_dir(d) == 1
    open(d + '/x.bin', 'wb').write(b'abd')
    try:
        g.sha_dir(d); assert False
    except SystemExit:
        pass


PILOT_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'pilot')
SP = '/tmp/claude-0/-home-user-Send-A-Shot/5ab8d7bf-5d0f-550f-a69c-62a6985b93f2/scratchpad'
ASSETS = '/home/user/Send-A-Shot/stageA_review/wa2_eval_assets'


def _guard(args, scratch):
    r = subprocess.run([sys.executable, os.path.join(PILOT_DIR, 'pilot_guard.py')] + args, capture_output=True, text=True,
                       env={**os.environ, 'SCRATCH': scratch, 'PILOT_DRY_RUN': '1', 'EXPECTED_RATE': '0.59'})
    return r.returncode, r.stdout + r.stderr


def test_guard_end_to_end_dry_run():
    d = tempfile.mkdtemp(); led = os.path.join(d, 'wa2_pilot_ledger.json')
    assert _guard(['init', '2.60'], d)[0] == 0
    rc, out = _guard(['create-pod', 'NVIDIA A40'], d)                      # first pod gets the whole remaining budget
    assert rc == 0 and 'HARD_MIN=' in out, out
    hard = int(out.split('HARD_MIN=')[1].split()[0]); assert abs(hard - (2.60 - 0.05) / 0.59 * 60) <= 1
    rc, out = _guard(['create-pod', 'NVIDIA A40'], d)                      # nothing left: a second pod is refused
    assert rc != 0 and 'REFUSED' in out
    L = json.load(open(led)); L['pods'][0]['started'] -= 5 * 3600; json.dump(L, open(led, 'w'))   # pretend it overran
    rc, out = _guard(['watch'], d)
    assert rc == 0 and 'TERMINATED' in out and json.load(open(led))['pods'][0].get('ended')
    rc, out = _guard(['create-volume', 'US-IL-1'], d); assert rc != 0 and 'not approved' in out
    L = json.load(open(led)); L['volume'] = {'id': 'u4odco714x', 'name': 'sienna-studio', 'created': 0}; json.dump(L, open(led, 'w'))
    rc, out = _guard(['delete-volume', '--verified', d], d); assert rc != 0 and 'REFUSED' in out      # production: never
    L['volume'] = {'id': 'pv1', 'name': 'sienna-wa2-pilot', 'created': 0}; json.dump(L, open(led, 'w'))
    rc, out = _guard(['delete-volume'], d); assert rc != 0 and 'verify' in out                        # unverified: refused
    ck = os.path.join(d, 'ck'); os.makedirs(ck); open(ck + '/a.safetensors', 'wb').write(b'x' * 100)
    import hashlib
    open(ck + '/SHA256SUMS', 'w').write(hashlib.sha256(b'x' * 100).hexdigest() + '  a.safetensors\n')
    open(ck + '/a.safetensors', 'ab').write(b'!')                                                     # corrupted copy
    rc, out = _guard(['delete-volume', '--verified', ck], d); assert rc != 0 and 'MISMATCH' in out
    open(ck + '/a.safetensors', 'wb').write(b'x' * 100)
    rc, out = _guard(['delete-volume', '--verified', ck], d); assert rc == 0 and 'DELETED' in out, out
    assert json.load(open(led))['volume'].get('deleted')


def _fake_pod_server(root, flaky=None):
    """Minimal JupyterLab /files/ server with token check and HTTP Range, rooted at `root`."""
    import http.server, threading
    state = {'flaky': set(flaky or [])}

    class H(http.server.BaseHTTPRequestHandler):
        def log_message(self, *a): pass

        def do_GET(self):
            if self.headers.get('Authorization') != 'token T': self.send_response(403); self.end_headers(); return
            p = os.path.join(root, self.path.split('/files/', 1)[-1])
            if not os.path.isfile(p): self.send_response(404); self.end_headers(); return
            data = open(p, 'rb').read(); start = 0
            rng = self.headers.get('Range')
            if rng:
                start = int(rng.split('=')[1].split('-')[0])
                if start >= len(data): self.send_response(416); self.end_headers(); return
                self.send_response(206)
            else:
                self.send_response(200)
            body = data[start:]; self.send_header('Content-Length', str(len(body))); self.end_headers()
            if os.path.basename(p) in state['flaky']:                      # drop the connection half way, once
                state['flaky'].discard(os.path.basename(p)); self.wfile.write(body[:len(body) // 2]); self.wfile.flush()
                self.connection.close(); return
            self.wfile.write(body)

    srv = http.server.ThreadingHTTPServer(('127.0.0.1', 0), H)
    threading.Thread(target=srv.serve_forever, daemon=True).start()
    return srv, f'http://127.0.0.1:{srv.server_address[1]}'


def test_checkpoint_puller_paths_recovery_and_verification():
    sys.path.insert(0, PILOT_DIR); import pull_ckpts as pc, hashlib
    root = tempfile.mkdtemp(); pod = os.path.join(root, 'workspace', 'wa2_pull')     # JupyterLab rooted at / (2nd prefix)
    os.makedirs(pod + '/ckpt')
    gate = os.urandom(300_000); open(pod + '/gate.bin', 'wb').write(gate)
    open(pod + '/gate.sha256', 'w').write(hashlib.sha256(gate).hexdigest() + '  gate.bin\n')
    files = {n: os.urandom(500_000 + i) for i, n in enumerate(('step-100.safetensors', 'comfy_step-100.safetensors', 'step-200.safetensors'))}
    for n, b in files.items(): open(f'{pod}/ckpt/{n}', 'wb').write(b)
    sums = ''.join(f'{hashlib.sha256(b).hexdigest()}  {n}\n' for n, b in files.items())
    open(pod + '/ckpt/SHA256SUMS', 'w').write(sums)
    open(pod + '/ckpt/step-200.safetensors', 'ab').write(b'corrupt')        # pod-side file no longer matches its checksum
    srv, url = _fake_pod_server(root, flaky={'step-100.safetensors'})
    signalled = []
    local = tempfile.mkdtemp()
    pl = pc.Puller(base=url, token='T', signal_gate=lambda: signalled.append(1), backoff=0)
    assert pl.gate(local) and pl.prefix == 'workspace/wa2_pull' and signalled == [1]
    assert not os.path.exists(local + '/gate.bin')
    half = files['comfy_step-100.safetensors'][:200_000]                     # an interrupted earlier download
    open(local + '/comfy_step-100.safetensors.part', 'wb').write(half)
    n = pl.pull(local)
    assert n == 2, n                                                        # two verified; the corrupt one rejected
    ok = open(local + '/SHA256SUMS').read()
    assert 'step-100.safetensors' in ok and 'comfy_step-100' in ok and 'step-200' not in ok
    assert not os.path.exists(local + '/step-200.safetensors')
    assert open(local + '/comfy_step-100.safetensors', 'rb').read() == files['comfy_step-100.safetensors']
    open(f'{pod}/ckpt/step-200.safetensors', 'wb').write(files['step-200.safetensors'])   # pod republishes it correctly
    assert pl.pull(local) == 1 and 'step-200' in open(local + '/SHA256SUMS').read()
    assert pl.pull(local) == 0                                              # nothing re-downloaded
    sys.path.insert(0, PILOT_DIR); import pilot_guard as g
    assert g.sha_dir(local) == 3                                            # what the guard checks before deleting a volume
    bad = pc.Puller(base=url, token='WRONG', signal_gate=lambda: None, backoff=0)
    assert not bad.gate(tempfile.mkdtemp())                                 # no access -> gate fails -> pod never trains
    srv.shutdown()


def _run_pod_script(env, timeout=30):
    """Runs the pod script; returns when the script exits (its background deadline timer is left running until
    `timeout`, so a test can observe it firing), then kills the whole process group."""
    import signal, time as _t
    log = tempfile.mktemp()
    with open(log, 'w') as fo:
        p = subprocess.Popen(['bash', os.path.join(PILOT_DIR, 'pilot_pod.sh')], env=env, stdout=fo, stderr=subprocess.STDOUT, start_new_session=True)
        try:
            rc = p.wait(timeout=timeout)
        except subprocess.TimeoutExpired:
            rc = None
    _t.sleep(0.3)
    try:
        os.killpg(p.pid, signal.SIGKILL)
    except ProcessLookupError:
        pass
    return rc, open(log).read(), p.pid


def _pod_env(tmp, fake_ctl=True, **kw):
    bin_ = os.path.join(tmp, 'bin'); os.makedirs(bin_, exist_ok=True)
    if fake_ctl:
        open(bin_ + '/runpodctl', 'w').write(f'#!/bin/bash\necho "$@" >> {tmp}/removed\n'); os.chmod(bin_ + '/runpodctl', 0o755)
    path = bin_ + ':' + ':'.join(x for x in os.environ['PATH'].split(':') if not (fake_ctl is False and os.path.exists(os.path.join(x, 'runpodctl'))))
    env = {'PATH': path, 'HOME': tmp, 'HARD_MIN': '240', 'RUNPOD_API_KEY': 'k', 'RUNPOD_POD_ID': 'podX', 'PULL_DIR': tmp + '/pull',
           'VOL_MOUNT': tmp + '/novol', 'WORK_ROOT': tmp + '/root', 'UPLOAD_DIR': tmp + '/up', 'GATE_BYTES': '100000'}
    env.update(kw); return env


def _pod_upload(tmp, good=True):
    import tarfile, hashlib
    up = tmp + '/up'; ds = tmp + '/src/wa2_dataset_frozen_v9'; os.makedirs(up); os.makedirs(ds)
    open(ds + '/a.txt', 'w').write('a'); open(ds + '/SHA256SUMS', 'w').write(hashlib.sha256(b'a').hexdigest() + '  a.txt\n')
    with tarfile.open(up + '/dataset.tgz', 'w:gz') as t: t.add(ds, arcname='wa2_dataset_frozen_v9')
    h = hashlib.sha256(open(up + '/dataset.tgz', 'rb').read()).hexdigest() if good else '0' * 64
    open(up + '/dataset.tgz.sha256', 'w').write(f'{h}  dataset.tgz\n')


def test_pod_script_deadline_abort_and_gate():
    import time as _t
    t1 = tempfile.mkdtemp(); _pod_upload(t1)                                # (a) cannot self-delete -> refuses to start
    rc, out, _ = _run_pod_script(_pod_env(t1, fake_ctl=False, RUNPOD_API_KEY=''))
    assert rc == 9 and 'NO_SELF_DELETE_ABORT' in out, (rc, out[-400:])
    t2 = tempfile.mkdtemp(); _pod_upload(t2, good=False)                    # (b) dataset checksum fails -> pod removed now
    rc, out, _ = _run_pod_script(_pod_env(t2))
    assert rc == 2 and 'DATASET_CHECKSUM_FAIL' in out and 'remove pod podX' in open(t2 + '/removed').read()
    t3 = tempfile.mkdtemp(); _pod_upload(t3)                                # (c) gate never confirmed -> pod removed
    rc, out, _ = _run_pod_script(_pod_env(t3, GATE_POLLS='2', GATE_SLEEP='0.2'))
    assert rc == 3 and 'TRANSFER_GATE_FAIL' in out and 'remove pod podX' in open(t3 + '/removed').read()
    t4 = tempfile.mkdtemp(); _pod_upload(t4)                                # (d) hard deadline fires while waiting
    rc, out, pid = _run_pod_script(_pod_env(t4, DEADLINE_SECONDS='2', GATE_POLLS='100', GATE_SLEEP='0.2'), timeout=6)
    deadline_hit = os.path.exists(t4 + '/removed') and 'remove pod podX' in open(t4 + '/removed').read()
    assert deadline_hit, out[-400:]
    t5 = tempfile.mkdtemp(); _pod_upload(t5); os.makedirs(t5 + '/pull'); open(t5 + '/pull/gate.ok', 'w').close()
    rc, out, _ = _run_pod_script(_pod_env(t5, STOP_AFTER_GATE='1', DEADLINE_SECONDS='600'))   # (e) gate ok -> continues
    assert rc == 0 and 'transfer_gate_ok' in out and not os.path.exists(t5 + '/removed'), (rc, out[-400:])
    assert os.path.exists(t5 + '/pull/gate.sha256') and not os.path.exists(t5 + '/pull/gate.bin')
    import shutil
    for t in (t1, t2, t3, t4, t5): shutil.rmtree(t, ignore_errors=True)


def test_eval_graphs_change_only_lora_inputs_and_names():
    sys.path.insert(0, PILOT_DIR); import eval_graphs as eg
    runs = eg.plan('comfy_300.safetensors', 'comfy_200.safetensors', 'closeup_photo.png', 'closeup_drive.mp4', 'talk_drive.mp4', 0.7)
    assert set(runs) == {'main_noLoRA', 'main_s300_1.0', 'main_s300_0.7', 'main_s200_1.0', 'close_noLoRA', 'close_best', 'talk_noLoRA', 'talk_best'}
    names = {('v_save', 'filename_prefix'), ('v_poster', 'filename_prefix')}
    assert set(eg.diff_from_baseline(runs['main_noLoRA'])) == names        # baseline re-render: identical except output names
    lora = names | {('v_idlora', 'ADDED'), ('v_cache', 'model')}
    for k in ('main_s300_1.0', 'main_s300_0.7', 'main_s200_1.0'):
        assert set(eg.diff_from_baseline(runs[k])) == lora, k
    assert runs['main_s300_0.7']['v_idlora']['inputs']['strength_model'] == 0.7
    assert runs['main_s300_1.0']['v_idlora']['inputs']['model'] == ['v_fast', 0]      # after lightx2v, before the cache
    inputs = {('v_image', 'image'), ('v_drive', 'file'), ('v_drive_part', 'batch_index')}
    assert set(eg.diff_from_baseline(runs['close_noLoRA'])) == names | inputs
    assert set(eg.diff_from_baseline(runs['talk_best'])) == names | inputs | {('v_idlora', 'ADDED'), ('v_cache', 'model')}
    g = runs['close_best']
    assert g['v_ks_0']['inputs']['noise_seed'] == 2202 and g['v_sigmas']['inputs']['steps'] == 6 and g['v_anim_0']['inputs']['width'] == 528


def test_close_framed_evaluation_reads_face_and_expression():
    if not os.path.exists(ASSETS + '/closeup_drive.mp4') or not os.path.exists(SP + '/mpmodels'):
        return
    import eval_pilot as ev
    an = ev.Analyzer(SP + '/mpmodels', SP + '/facemodels')
    fr = ev.read_frames(ASSETS + '/closeup_drive.mp4'); assert len(fr) == 64 and fr[0].shape[:2] == (768, 528)
    A = [an.frame(f) for f in fr[::4]]
    ref = ev.fit(cv2.imread(ASSETS + '/closeup_photo.png')); ra = an.frame(ref)
    r = ev.summarise('close', fr[::4], A, A, ev.torso_lab(ref, ra['mp'].get('body')))
    assert r['face_px_median'] >= 150 and r['faces_scored'] >= 14            # big enough for reliable identity
    assert sum(1 for a in A if 'jaw' in a['mp']) >= 14                      # expression readable
    assert ra['size'] >= 150 and ra['sim'] >= 0.74                          # close-up photo is still clearly her
    assert r['mouth_follows_driver_corr'] is None or r['mouth_follows_driver_corr'] > 0.99   # self-comparison sanity


def test_talking_clip_gate_rejects_clip_without_smiles():
    if not os.path.exists(ASSETS + '/closeup_drive.mp4') or not os.path.exists(SP + '/mpmodels'):
        return
    import prepare_talking_clip as pt, shutil
    out = tempfile.mkdtemp(); shutil.copy(ASSETS + '/closeup_photo.png', out)
    ok, problems, rep = pt.check_and_prepare(ASSETS + '/closeup_drive.mp4', 0.0, out, SP + '/facemodels', SP + '/mpmodels')
    assert not ok and any('smile' in p for p in problems), (problems, rep)    # the dance clip has no smile: must be rejected
    ok, problems, _ = pt.check_and_prepare(ASSETS + '/closeup_drive.mp4', 2.0, out, SP + '/facemodels', SP + '/mpmodels')
    assert not ok and any('too short' in p for p in problems)



def test_split_for_delivery_reassembles_exactly():
    import hashlib, shutil
    d = tempfile.mkdtemp(); f = d + '/comfy_lora.safetensors'; data = os.urandom(60 * 2 ** 20 + 123)
    open(f, 'wb').write(data)
    r = subprocess.run(['bash', os.path.join(PILOT_DIR, 'split_for_delivery.sh'), f, d + '/out'], capture_output=True, text=True)
    assert r.returncode == 0 and 'reassembly verified' in r.stdout, r.stdout + r.stderr
    parts = sorted(p for p in os.listdir(d + '/out') if '.part' in p)
    assert len(parts) == 3 and all(os.path.getsize(f'{d}/out/{p}') < 30 * 2 ** 20 for p in parts)
    assert hashlib.sha256(b''.join(open(f'{d}/out/{p}', 'rb').read() for p in parts)).hexdigest() == hashlib.sha256(data).hexdigest()
    shutil.rmtree(d)


if __name__ == '__main__':
    fails = 0
    for name, fn in list(globals().items()):
        if name.startswith('test_'):
            try:
                fn(); print('PASS', name)
            except Exception as e:
                fails += 1; print('FAIL', name, repr(e)[:300])
    sys.exit(1 if fails else 0)
