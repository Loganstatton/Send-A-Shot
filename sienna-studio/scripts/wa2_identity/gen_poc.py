"""3-scene proof-of-concept data generation (NOT run yet; needs approval).

For each set in poc_sets.json and each view:
  1. stand-in pose photo (RealVisXL, no Sienna LoRA)                 -> pose guidance only
  2. Sienna image via the production app's Create endpoint: same outfit/place/lighting/seed for the whole set,
     the stand-in as Pose Photo, expression from the view; face-check retries off for these dataset requests only
  3. driver from that Sienna image (driver_graph.py): a different woman in her exact body + face keypoints
  4. QA: Sienna face score vs her reference, driver face score vs Sienna (< 0.45), driver/target keypoint match
Outputs go to <out>/<set>/ and a contact sheet per set; nothing is used for training until approved.
Usage: gen_poc.py <comfy_url> <app_url> <out_dir>
"""
import json, os, sys, time, uuid, urllib.request
HERE = os.path.dirname(os.path.abspath(__file__)); sys.path.insert(0, HERE)
from driver_graph import driver_graph

STANDIN = 'realistic photo of an adult woman with long brown hair, plain casual clothes, natural light, sharp focus, photo taken by another person'


def http(url, body=None, ctype='application/json', t=180):
    data = body if isinstance(body, (bytes, type(None))) else json.dumps(body).encode()
    r = urllib.request.Request(url, data=data, headers={'Content-Type': ctype, 'User-Agent': 'curl/8.5.0'})
    with urllib.request.urlopen(r, timeout=t) as f:
        d = f.read()
    try:
        return json.loads(d)
    except Exception:
        return d


def comfy_run(C, g):
    pid = http(C + '/prompt', {'prompt': g, 'client_id': uuid.uuid4().hex})['prompt_id']
    while True:
        h = http(f'{C}/history/{pid}')
        if pid in h and h[pid].get('status', {}).get('completed'):
            return h[pid]['outputs']
        time.sleep(2)


def standin_graph(view_text, framing, seed):
    return {'1': {'class_type': 'CheckpointLoaderSimple', 'inputs': {'ckpt_name': 'RealVisXL_V5.0_fp16.safetensors'}},
            '3': {'class_type': 'CLIPTextEncode', 'inputs': {'clip': ['1', 1], 'text': f'{view_text}, {framing}, {STANDIN}'}},
            '4': {'class_type': 'CLIPTextEncode', 'inputs': {'clip': ['1', 1], 'text': 'selfie, phone in hand, extra people, blurry, cartoon, deformed'}},
            '5': {'class_type': 'EmptyLatentImage', 'inputs': {'width': 832, 'height': 1216, 'batch_size': 1}},
            '6': {'class_type': 'KSampler', 'inputs': {'model': ['1', 0], 'positive': ['3', 0], 'negative': ['4', 0], 'latent_image': ['5', 0], 'seed': seed,
                                                      'steps': 22, 'cfg': 5, 'sampler_name': 'dpmpp_2m', 'scheduler': 'karras', 'denoise': 1}},
            '7': {'class_type': 'VAEDecode', 'inputs': {'samples': ['6', 0], 'vae': ['1', 2]}},
            '8': {'class_type': 'SaveImage', 'inputs': {'images': ['7', 0], 'filename_prefix': 'poc/standin'}}}


def main(C, APP, OUT):
    plan = json.load(open(f'{HERE}/poc_sets.json'))
    st = http(APP + '/api/settings')['settings']; P = dict(st['defaultParams'], batchSize=1, width=832, height=1216, faceCheck=False)
    F = ['outfit', 'pose', 'bodyPresentation', 'expression', 'setting', 'lighting', 'camera', 'framing', 'realism', 'extra']
    for s in plan['sets']:
        d = f"{OUT}/{s['id']}"; os.makedirs(d, exist_ok=True); rec = []
        for i, (view, tag, expr) in enumerate(s['views']):
            out = comfy_run(C, standin_graph(view, s['framing'], s['seed'] * 10 + i)); im = out['8']['images'][0]
            sp = f'{d}/{i:02d}_standin.png'; open(sp, 'wb').write(http(f"{C}/view?filename={im['filename']}&subfolder={im['subfolder']}&type=output"))
            bd = uuid.uuid4().hex; body = (f'--{bd}\r\nContent-Disposition: form-data; name="file"; filename="s.png"\r\nContent-Type: image/png\r\n\r\n').encode() + open(sp, 'rb').read() + f'\r\n--{bd}--\r\n'.encode()
            pose = http(APP + '/api/uploads', body, ctype=f'multipart/form-data; boundary={bd}')
            f = {k: '' for k in F}; f.update(outfit=s['outfit'], pose=view, expression=expr, setting=s['place'], lighting=s['lighting'], framing=s['framing'])
            r = http(APP + '/api/generate', {'presetId': None, 'workflowId': 'sienna-sdxl-production', 'siennaLock': True, 'contentMode': 'sfw', 'fields': f,
                                             'params': dict(P, seed=s['seed']), 'images': {'initImage': None, 'poseImage': pose, 'faceReferenceId': None}})
            while http(f"{APP}/api/history/{r['id']}/status").get('status') not in ('done', 'error'):
                time.sleep(4)
            h = http(f"{APP}/api/history/{r['id']}"); fn = (h.get('images') or [{}])[0].get('file')
            rec.append({'view': tag, 'expr': expr, 'standin': sp, 'record': r['id'], 'file': fn, 'error': h.get('error')})
            print(s['id'], i, tag, h.get('status'), fn, flush=True)
        json.dump(rec, open(f'{d}/records.json', 'w'), indent=1)
    print('SIENNA_IMAGES_DONE (drivers are generated from these with driver_graph.py once copied to ComfyUI input/)')


if __name__ == '__main__':
    main(*sys.argv[1:4])
