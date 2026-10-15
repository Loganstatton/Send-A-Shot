"""Evaluation render graphs for the pilot, derived from the EXACT Copy Motion graph behind the 0.395 baseline
(baseline_graph.json): same prompts, seed 2202, 528x768, 6 LCM steps, shift 5, lightx2v, motion cache, 64 frames.
Per run only these may change: the identity LoRA (inserted after lightx2v), the photo/driving files, the driving clip's
start frame, and the output name. `diff_from_baseline` lists every change, and the tests assert nothing else moves.

Runs (in order; the strength for the close-up and talking runs is picked from the main-clip results):
  main_noLoRA      baseline re-render on the same pod (should reproduce 0.395 within noise)
  main_s300_1.0    LoRA step 300, strength 1.0
  main_s300_0.7    LoRA step 300, strength 0.7
  main_s200_1.0    LoRA step 200, strength 1.0 (over-fitting check)
  close_noLoRA / close_best      head-and-shoulders crop of the same clip and photo (make_closeup.py)
  talk_noLoRA / talk_best        only when an authorised talking/laughing clip has been prepared (prepare_talking_clip.py)
The best previous face-restored result (0.665) is NOT re-rendered: its stored frames come from this exact graph and
eval_pilot.py reproduces its score exactly, so it is scored from disk alongside these runs.
"""
import copy, json, os

HERE = os.path.dirname(os.path.abspath(__file__))
BASE = json.load(open(os.path.join(HERE, 'baseline_graph.json')))
LORA_NODE = 'v_idlora'


def build(name, photo=None, drive=None, start=None, lora=None, strength=1.0):
    g = copy.deepcopy(BASE['graph'])
    if photo: g['v_image']['inputs']['image'] = photo
    if drive: g['v_drive']['inputs']['file'] = drive
    if start is not None: g['v_drive_part']['inputs']['batch_index'] = start
    if lora:
        g[LORA_NODE] = {'class_type': 'LoraLoaderModelOnly', 'inputs': {'model': ['v_fast', 0], 'lora_name': lora, 'strength_model': strength},
                        '_meta': {'title': 'Sienna WA2 identity LoRA'}}
        g['v_cache']['inputs']['model'] = [LORA_NODE, 0]
    g['v_save']['inputs']['filename_prefix'] = f'wa2eval/{name}'
    g['v_poster']['inputs']['filename_prefix'] = f'wa2eval/{name}_poster'
    return g


def diff_from_baseline(g):
    """Every (node, input) that differs from the baseline graph, plus added/removed nodes."""
    b = BASE['graph']; out = []
    for k in sorted(set(b) | set(g)):
        if k not in b: out.append((k, 'ADDED')); continue
        if k not in g: out.append((k, 'REMOVED')); continue
        for i in sorted(set(b[k]['inputs']) | set(g[k]['inputs'])):
            if b[k]['inputs'].get(i) != g[k]['inputs'].get(i): out.append((k, i))
    return out


def plan(ckpt300, ckpt200, closeup_photo, closeup_drive, talk_drive=None, best=1.0):
    b = BASE['graph']; p, d = b['v_image']['inputs']['image'], b['v_drive']['inputs']['file']; s = b['v_drive_part']['inputs']['batch_index']
    runs = {'main_noLoRA': build('main_noLoRA', p, d, s),
            'main_s300_1.0': build('main_s300_1.0', p, d, s, ckpt300, 1.0),
            'main_s300_0.7': build('main_s300_0.7', p, d, s, ckpt300, 0.7),
            'main_s200_1.0': build('main_s200_1.0', p, d, s, ckpt200, 1.0),
            'close_noLoRA': build('close_noLoRA', closeup_photo, closeup_drive, 0),
            'close_best': build('close_best', closeup_photo, closeup_drive, 0, ckpt300, best)}
    if talk_drive:
        runs['talk_noLoRA'] = build('talk_noLoRA', closeup_photo, talk_drive, 0)
        runs['talk_best'] = build('talk_best', closeup_photo, talk_drive, 0, ckpt300, best)
    return runs


if __name__ == '__main__':
    import sys
    r = plan(*sys.argv[1:6]) if len(sys.argv) >= 6 else plan('comfy_step300.safetensors', 'comfy_step200.safetensors', 'closeup_photo.png', 'closeup_drive.mp4')
    for k, g in r.items(): print(k, diff_from_baseline(g))
