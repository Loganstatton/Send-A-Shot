"""Renders the pilot's evaluation videos on the pod's ComfyUI and downloads them (session side).
Inputs are the exact Copy Motion baseline files; graphs come from eval_graphs.py (only LoRA / inputs / names differ).
Usage: POD=<id> run_eval.py <out_dir> <comfy_ckpt300> <comfy_ckpt200> <run> [<run> ...]     (run names from eval_graphs.plan)
       POD=<id> run_eval.py <out_dir> --upload       (upload photo, driving clip and close-up inputs once)
"""
import json, os, sys, time, urllib.parse, urllib.request, uuid

HERE = os.path.dirname(os.path.abspath(__file__)); sys.path.insert(0, HERE)
import eval_graphs as eg

SP = '/tmp/claude-0/-home-user-Send-A-Shot/5ab8d7bf-5d0f-550f-a69c-62a6985b93f2/scratchpad'
ASSETS = '/home/user/Send-A-Shot/stageA_review/wa2_eval_assets'
POD = os.environ['POD']; C = f'https://{POD}-8188.proxy.runpod.net'; H = {'User-Agent': 'curl/8.5.0'}


def req(p, body=None, raw=False, t=120, ctype='application/json'):
    data = body if isinstance(body, (bytes, type(None))) else json.dumps(body).encode()
    with urllib.request.urlopen(urllib.request.Request(C + p, data=data, headers={**H, 'Content-Type': ctype}), timeout=t) as f:
        d = f.read()
    return d if raw else json.loads(d or b'{}')


def upload(path, name, sub=''):
    bd = uuid.uuid4().hex
    parts = [f'--{bd}\r\nContent-Disposition: form-data; name="image"; filename="{name}"\r\nContent-Type: application/octet-stream\r\n\r\n'.encode() + open(path, 'rb').read() + b'\r\n',
             f'--{bd}\r\nContent-Disposition: form-data; name="overwrite"\r\n\r\ntrue\r\n'.encode()]
    if sub: parts.append(f'--{bd}\r\nContent-Disposition: form-data; name="subfolder"\r\n\r\n{sub}\r\n'.encode())
    return req('/upload/image', b''.join(parts) + f'--{bd}--\r\n'.encode(), ctype=f'multipart/form-data; boundary={bd}', t=300)


def submit(g, timeout_s=1500):
    r = req('/prompt', {'prompt': g, 'client_id': uuid.uuid4().hex})
    if r.get('node_errors'): raise RuntimeError('NODE_ERRORS ' + json.dumps(r['node_errors'])[:800])
    pid, t0 = r['prompt_id'], time.time()
    while time.time() - t0 < timeout_s:
        h = req(f'/history/{pid}')
        if pid in h:
            st = h[pid].get('status', {})
            if st.get('status_str') == 'error': raise RuntimeError('EXEC_ERROR ' + json.dumps(st.get('messages'))[-1500:])
            if st.get('completed'): return h[pid]['outputs'], round(time.time() - t0)
        time.sleep(5)
    raise TimeoutError(pid)


def main():
    out = sys.argv[1]; os.makedirs(out, exist_ok=True)
    if sys.argv[2] == '--upload':
        upload(f'{SP}/poc/data/images/gen_5ienna0779frnt01.png', 'gen_5ienna0779frnt01.png', 'sienna')
        upload(f'{SP}/poc/data/images/mot_0c269a44a2763e10.mp4', 'mot_0c269a44a2763e10.mp4')
        upload(f'{ASSETS}/closeup_photo.png', 'closeup_photo.png'); upload(f'{ASSETS}/closeup_drive.mp4', 'closeup_drive.mp4')
        print('UPLOADED'); return
    c300, c200, runs = sys.argv[2], sys.argv[3], sys.argv[4:]
    best = float(os.environ.get('BEST_STRENGTH', '1.0'))
    plan = eg.plan(c300, c200, 'closeup_photo.png', 'closeup_drive.mp4', None, best)
    for name in runs:
        if os.path.exists(f'{out}/{name}.mp4'): print('have', name); continue
        outputs, secs = submit(plan[name])
        vid = next(v for o in outputs.values() for key in ('images', 'videos', 'gifs') for v in o.get(key, [])
                   if v['filename'].endswith('.mp4') and v.get('subfolder', '').startswith('wa2eval'))
        data = req('/view?' + urllib.parse.urlencode({'filename': vid['filename'], 'subfolder': vid['subfolder'], 'type': 'output'}), raw=True, t=600)
        open(f'{out}/{name}.mp4', 'wb').write(data); print('VIDEO', name, secs, 's', len(data), flush=True)


if __name__ == '__main__':
    main()
