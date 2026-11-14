"""Assemble THE MOVE: grade and type every frame, score, mix, master, encode every version.

  post-venv/bin/python assemble_move.py RENDER_ROOT OUT_DIR [--vo VO_DIR] [--skip-post] [--jobs 4]

RENDER_ROOT holds the rendered frames: hookA/, hookB/, hookC/ (frames 1–90), s2/ (91–240), s3/ (241–450),
s45/ (451–750), each with f####.hdr.

Writes the deliverables:
  THE-MOVE-25s-vertical.mp4                        the film, hook A, narration (1080×1920, 30 fps)
  THE-MOVE-25s-hookB-vertical.mp4, -hookC-         the same film with hook B / hook C
  THE-MOVE-25s-no-voiceover-vertical.mp4           music, effects and on-screen text only
  THE-MOVE-12s-vertical.mp4                        the short version, cut on the music's beat grid
  THE-MOVE-*.srt                                   captions for each narrated version
  THE-MOVE-soundtrack-master.wav, stems/           the mastered mix and its stems
"""
import json, os, shutil, subprocess, sys
from concurrent.futures import ThreadPoolExecutor
HERE = os.path.dirname(os.path.abspath(__file__))
ROOT, OUT = sys.argv[1], sys.argv[2]
args = sys.argv[3:]
def arg(n, d=None): return args[args.index(n) + 1] if n in args else d
JOBS = int(arg('--jobs', '4')); PY = sys.executable
VO = arg('--vo', os.path.join(OUT, 'vo'))
def run(cmd):
    r = subprocess.run(cmd, capture_output=True, text=True)
    if r.returncode: raise SystemExit(f'failed: {" ".join(cmd)[:200]}\n{r.stderr[-1500:]}')
    return r.stdout

# ---------------------------------------------------------------- 1. grade + type
SCENES = {'a': [('hookA', 1, 90)], 'b': [('hookB', 1, 90)], 'c': [('hookC', 1, 90)],
          'body': [('s2', 91, 240), ('s3', 241, 450), ('s45', 451, 750)]}
def post(hook, scene, a, b, dst):
    os.makedirs(dst, exist_ok=True)
    todo = [g for g in range(a, b + 1) if not os.path.exists(os.path.join(dst, f'p{g:04d}.png'))]
    if not todo: return
    def one(ch): run([PY, os.path.join(HERE, 'post_move.py'), os.path.join(ROOT, scene), dst, '--list', ','.join(map(str, ch)), '--hook', hook])
    with ThreadPoolExecutor(JOBS) as ex: list(ex.map(one, [todo[i::JOBS] for i in range(JOBS) if todo[i::JOBS]]))
if '--skip-post' not in args:
    for scene, a, b in SCENES['a'] + SCENES['body']: post('a', scene, a, b, os.path.join(OUT, 'frames')); print('graded', scene, flush=True)
    for h in 'bc':
        scene, a, b = SCENES[h][0]; post(h, scene, a, b, os.path.join(OUT, f'frames_{h}')); print('graded hook', h, flush=True)

# ---------------------------------------------------------------- 2. audio
A = os.path.join(OUT, 'audio'); os.makedirs(A, exist_ok=True)
PLACE = {'pick1': 0.12, 'pick2': 1.62, 'discover': 3.40, 'move1': 8.15, 'move2': 10.15, 'end1': 21.10, 'end2': 23.05}
def master(src, dst):
    meas = subprocess.run(['ffmpeg', '-hide_banner', '-i', src, '-af', 'loudnorm=I=-14:TP=-1.5:LRA=11:print_format=json', '-f', 'null', '-'],
                          capture_output=True, text=True).stderr
    m = json.loads(meas[meas.rindex('{'):meas.rindex('}') + 1])
    run(['ffmpeg', '-y', '-hide_banner', '-i', src, '-af', f"loudnorm=I=-14:TP=-1.5:LRA=11:measured_I={m['input_i']}:measured_TP={m['input_tp']}:"
         f"measured_LRA={m['input_lra']}:measured_thresh={m['input_thresh']}:offset={m['target_offset']}:linear=true", '-ar', '48000', '-c:a', 'pcm_s24le', dst])
MIX5 = os.path.join(HERE, '..', 'signal', 'mix5.py')          # the narration chain and ducking from THE SIGNAL (unchanged)
placements = ','.join(f'{k}@{v}' for k, v in PLACE.items())
for h in 'abc':
    d = os.path.join(A, f'stems_{h}')
    run([PY, os.path.join(HERE, 'music_move.py'), d, '--len', '25', '--hook', h])
    run([PY, MIX5, d, VO, os.path.join(d, 'mix.wav'), '--len', '25', '--hook', 'b', '--placements', placements])
    master(os.path.join(d, 'mix.wav'), os.path.join(A, f'mix_{h}.wav'))
dn = os.path.join(A, 'stems_novo'); shutil.copytree(os.path.join(A, 'stems_a'), dn, dirs_exist_ok=True)
run([PY, MIX5, dn, VO, os.path.join(dn, 'mix.wav'), '--len', '25', '--no-vo'])
master(os.path.join(dn, 'mix.wav'), os.path.join(A, 'mix_novo.wav'))
os.makedirs(os.path.join(OUT, 'stems'), exist_ok=True)
shutil.copy(os.path.join(A, 'mix_a.wav'), os.path.join(OUT, 'THE-MOVE-soundtrack-master.wav'))
for nm in ('voice', 'music', 'sfx'): shutil.copy(os.path.join(A, 'stems_a', f'stem_{nm}.wav'), os.path.join(OUT, 'stems', f'THE-MOVE-stem-{nm}.wav'))

# ---------------------------------------------------------------- 3. edits, captions, encodes
FULL = [(1, 751)]
CUT12 = [(1, 91), (241, 301), (301, 361), (466, 556), (691, 751)]       # 360 frames = 12.0 s; every join on a beat (1 + 15k)
VOJ = json.load(open(os.path.join(VO, 'durations.json')))
def ts(t): h = int(t // 3600); m = int(t % 3600 // 60); s = t % 60; return f'{h:02d}:{m:02d}:{s:06.3f}'.replace('.', ',')
def cut_lines(edl):
    out, pos = [], 0.0
    for a, b in edl:
        t0, t1 = (a - 1) / 30, (b - 1) / 30
        for k, t in PLACE.items():
            if t0 <= t and t + VOJ['durations'][k] <= t1: out.append((pos + t - t0, k))
        pos += t1 - t0
    return out
def srt(lines, path):
    with open(path, 'w') as f:
        for i, (t, k) in enumerate(sorted(lines), 1):
            f.write(f"{i}\n{ts(t)} --> {ts(t + VOJ['durations'][k] + 0.25)}\n{VOJ['lines'][k]}\n\n")
def audio_for(src, edl, dst):
    import numpy as np, soundfile as sf
    x, sr = sf.read(src, always_2d=True); parts = []; xf = int(0.01 * sr)
    for a, b in edl:
        seg = x[int((a - 1) / 30 * sr):int((b - 1) / 30 * sr)].copy()
        if parts: seg[:xf] *= np.linspace(0, 1, xf)[:, None]; parts[-1][-xf:] *= np.linspace(1, 0, xf)[:, None]
        parts.append(seg)
    y = np.concatenate(parts); f_ = int(0.25 * sr); y[-f_:] *= np.linspace(1, 0, f_)[:, None] ** 2
    sf.write(dst, y, sr, subtype='PCM_24')
def encode(name, hook, edl, mix):
    lst = []
    for a, b in edl:
        for g in range(a, b):
            lst.append(os.path.join(OUT, f'frames_{hook}' if (hook != 'a' and g <= 90) else 'frames', f'p{g:04d}.png'))
    cl = os.path.join(OUT, f'.{name}.txt')
    with open(cl, 'w') as f:
        for p in lst: f.write(f"file '{p}'\nduration {1 / 30:.6f}\n")
    aud = os.path.join(A, f'{name}.wav')
    if edl == FULL: shutil.copy(mix, aud)
    else: audio_for(mix, edl, aud)
    run(['ffmpeg', '-y', '-hide_banner', '-f', 'concat', '-safe', '0', '-i', cl, '-i', aud, '-r', '30', '-c:v', 'libx264', '-preset', 'slow', '-crf', '16',
         '-profile:v', 'high', '-pix_fmt', 'yuv420p', '-movflags', '+faststart', '-c:a', 'aac', '-b:a', '320k', '-shortest', os.path.join(OUT, f'{name}.mp4')])
    os.remove(cl); print('encoded', name, flush=True)
encode('THE-MOVE-25s-vertical', 'a', FULL, os.path.join(A, 'mix_a.wav'))
encode('THE-MOVE-25s-hookB-vertical', 'b', FULL, os.path.join(A, 'mix_b.wav'))
encode('THE-MOVE-25s-hookC-vertical', 'c', FULL, os.path.join(A, 'mix_c.wav'))
encode('THE-MOVE-25s-no-voiceover-vertical', 'a', FULL, os.path.join(A, 'mix_novo.wav'))
encode('THE-MOVE-12s-vertical', 'a', CUT12, os.path.join(A, 'mix_a.wav'))
for nm, edl in (('THE-MOVE-25s', FULL), ('THE-MOVE-12s', CUT12)): srt(cut_lines(edl), os.path.join(OUT, f'{nm}.srt'))
print('done')
