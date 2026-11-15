"""Assemble "THE SIGNAL": grade + type every frame, mix, master, encode every version.

  post-venv/bin/python assemble5.py RENDER_ROOT OUT_DIR [--fmt v|w|both] [--skip-post] [--jobs 4]

RENDER_ROOT holds the GPU outputs: gV1..gV4 (vertical) and gW1..gW4 (16:9), each with frames/<scene>[_wide]/.
Writes OUT_DIR/frames_{v,w}[_b|_c]/p####.png (graded, titled), OUT_DIR/audio/*, and the deliverables:

  THE-SIGNAL-60s-{vertical,16x9}.mp4                hero film, Hook A, narration
  THE-SIGNAL-60s-hookB-*.mp4, -hookC-*.mp4          the same film with Hook B / Hook C
  THE-SIGNAL-60s-no-voiceover-*.mp4                 music, effects and on-screen text only
  THE-SIGNAL-30s-*.mp4, THE-SIGNAL-15s-*.mp4        advertising cuts (cut on the music's beat grid)
  THE-SIGNAL-*.srt                                  captions for each narrated version
  audio/THE-SIGNAL-{master,voice,music,sfx}.wav     final mix and stems
"""
import json, os, shutil, subprocess, sys
from concurrent.futures import ThreadPoolExecutor
HERE = os.path.dirname(os.path.abspath(__file__))
ROOT, OUT = sys.argv[1], sys.argv[2]
args = sys.argv[3:]
def arg(n, d=None): return args[args.index(n) + 1] if n in args else d
FMTS = {'v': ['v'], 'w': ['w'], 'both': ['v', 'w']}[arg('--fmt', 'both')]
JOBS = int(arg('--jobs', '4'))
PY = sys.executable
def run(cmd, **kw):
    r = subprocess.run(cmd, capture_output=True, text=True, **kw)
    if r.returncode: raise SystemExit(f'failed: {" ".join(cmd)[:200]}\n{r.stderr[-1500:]}')
    return r.stdout

# ---------------------------------------------------------------- 1. grade + type every frame
# (scene dir, first global frame, last global frame, offset added to the scene's own frame number)
def scenes(fmt):
    w = '_wide' if fmt == 'w' else ''; g = 'gW' if fmt == 'w' else 'gV'
    F = lambda pod, name: os.path.join(ROOT, f'{g}{pod}', name + w)
    return {'a': [(F(1, 'hook'), 1, 90, 0)], 'b': [(F(1, 'hookb'), 1, 90, 0)], 'c': [(F(1, 'hookc'), 1, 90, 0)],
            'body': [(F(2, 'scout5'), 91, 660, 0), (F(3, 'next5'), 661, 1200, 0), (F(1, 'panels5'), 1201, 1410, 0), (F(4, 'card5'), 1411, 1800, 1409)]}
def post(fmt, hook, src, a, b, off, dst):
    os.makedirs(dst, exist_ok=True)
    todo = [g for g in range(a, b + 1) if not os.path.exists(os.path.join(dst, f'p{g:04d}.png'))]
    if not todo: return
    chunks = [todo[i::JOBS] for i in range(JOBS)]
    def one(ch):
        loc = ','.join(str(g - off) for g in ch)
        run([PY, os.path.join(HERE, 'post5.py'), src, dst, '--list', loc, '--offset', str(off), '--hook', hook] + (['--wide'] if fmt == 'w' else []))
    with ThreadPoolExecutor(JOBS) as ex: list(ex.map(one, [c for c in chunks if c]))
if '--skip-post' not in args:
    for fmt in FMTS:
        sc_ = scenes(fmt)
        for src, a, b, off in sc_['a'] + sc_['body']:
            post(fmt, 'a', src, a, b, off, os.path.join(OUT, f'frames_{fmt}')); print('graded', fmt, os.path.basename(src), flush=True)
        for h in 'bc':
            src, a, b, off = sc_[h][0]
            post(fmt, h, src, a, b, off, os.path.join(OUT, f'frames_{fmt}_{h}')); print('graded', fmt, 'hook', h, flush=True)

# ---------------------------------------------------------------- 2. audio: score, mixes, masters
A = os.path.join(OUT, 'audio'); os.makedirs(A, exist_ok=True)
VO = arg('--vo', os.path.join(OUT, 'vo'))
def master(src, dst):
    """Streaming loudness: -14 LUFS integrated, -1 dBTP (two-pass loudnorm), 48 kHz."""
    meas = subprocess.run(['ffmpeg', '-hide_banner', '-i', src, '-af', 'loudnorm=I=-14:TP=-1.5:LRA=11:print_format=json', '-f', 'null', '-'],
                          capture_output=True, text=True).stderr
    m = json.loads(meas[meas.rindex('{'):meas.rindex('}') + 1])
    run(['ffmpeg', '-y', '-hide_banner', '-i', src, '-af', f"loudnorm=I=-14:TP=-1.5:LRA=11:measured_I={m['input_i']}:measured_TP={m['input_tp']}:"
         f"measured_LRA={m['input_lra']}:measured_thresh={m['input_thresh']}:offset={m['target_offset']}:linear=true", '-ar', '48000', '-c:a', 'pcm_s24le', dst])
for h in 'abc':
    d = os.path.join(A, f'stems_{h}')
    run([PY, os.path.join(HERE, 'music5.py'), d, '--len', '60', '--hook', h])
    run([PY, os.path.join(HERE, 'mix5.py'), d, VO, os.path.join(d, 'mix.wav'), '--len', '60', '--hook', h])
    master(os.path.join(d, 'mix.wav'), os.path.join(A, f'mix_{h}.wav'))
dn = os.path.join(A, 'stems_novo'); shutil.copytree(os.path.join(A, 'stems_a'), dn, dirs_exist_ok=True)
run([PY, os.path.join(HERE, 'mix5.py'), dn, VO, os.path.join(dn, 'mix.wav'), '--len', '60', '--no-vo'])
master(os.path.join(dn, 'mix.wav'), os.path.join(A, 'mix_novo.wav'))
for nm, src in (('master', os.path.join(A, 'mix_a.wav')), ('voice', os.path.join(A, 'stems_a', 'stem_voice.wav')),
                ('music', os.path.join(A, 'stems_a', 'stem_music.wav')), ('sfx', os.path.join(A, 'stems_a', 'stem_sfx.wav'))):
    shutil.copy(src, os.path.join(OUT, f'THE-SIGNAL-{nm}.wav' if nm == 'master' else f'THE-SIGNAL-stem-{nm}.wav'))

# ---------------------------------------------------------------- 3. captions
PLACE = {'scout': 3.4, 'review': 10.2, 'begins': 21.15, 'discover': 23.2, 'credits': 30.2, 'trade': 33.1, 'build': 40.5,
         'believer': 47.6, 'finds': 53.6, 'next': 56.9}
HOOKS = {'a': {'stock': 0.2, 'artist': 1.36}, 'b': {'hook_b': 0.2}, 'c': {'hook_c1': 0.1, 'hook_c2': 1.41}}
VOJ = json.load(open(os.path.join(VO, 'durations.json')))
def ts(t): h = int(t // 3600); m = int(t % 3600 // 60); s = t % 60; return f'{h:02d}:{m:02d}:{s:06.3f}'.replace('.', ',')
def srt(lines, path):
    with open(path, 'w') as f:
        for i, (t, key) in enumerate(sorted(lines), 1):
            f.write(f"{i}\n{ts(t)} --> {ts(t + VOJ['durations'][key] + 0.25)}\n{VOJ['lines'][key]}\n\n")
def cut_lines(hook, edl):
    """Where each narration line lands in an edited version (only lines wholly inside a kept segment)."""
    out, pos = [], 0.0
    allp = {**HOOKS[hook], **PLACE}
    for a, b in edl:
        t0, t1 = (a - 1) / 30, (b - 1) / 30
        for k, t in allp.items():
            if t0 <= t and t + VOJ['durations'][k] <= t1: out.append((pos + t - t0, k))
        pos += t1 - t0
    return out
FULL = [(1, 1801)]
CUT30 = [(1, 232), (296, 456), (616, 680), (904, 1144), (1592, 1797)]      # 900 frames, cuts on the beat grid (8 + 16k)
CUT15 = [(1, 91), (600, 680), (984, 1144), (1688, 1800)]                   # 442 frames (14.7 s)

# ---------------------------------------------------------------- 4. encode
def frames_for(fmt, hook, edl):
    """A concat list of graded frames for an edit (hook frames swapped in for B/C)."""
    lst = []
    for a, b in edl:
        for g in range(a, b):
            d = os.path.join(OUT, f'frames_{fmt}_{hook}' if (hook != 'a' and g <= 90) else f'frames_{fmt}')
            lst.append(os.path.join(d, f'p{g:04d}.png'))
    return lst
def audio_for(src, edl, dst):
    """Cut the mix with the picture: 10 ms crossfades at each join (the joins sit on the beat grid)."""
    import numpy as np, soundfile as sf
    x, sr = sf.read(src, always_2d=True); parts = []; xf = int(0.01 * sr)
    for a, b in edl:
        seg = x[int((a - 1) / 30 * sr):int((b - 1) / 30 * sr)].copy()
        if parts: seg[:xf] *= np.linspace(0, 1, xf)[:, None]; parts[-1][-xf:] *= np.linspace(1, 0, xf)[:, None]
        parts.append(seg)
    y = np.concatenate(parts); f_ = int(0.25 * sr); y[-f_:] *= np.linspace(1, 0, f_)[:, None] ** 2
    sf.write(dst, y, sr, subtype='PCM_24')
def encode(name, fmt, hook, edl, mix):
    lst = frames_for(fmt, hook, edl)
    cl = os.path.join(OUT, f'.{name}.txt')
    with open(cl, 'w') as f:
        for p in lst: f.write(f"file '{p}'\nduration {1 / 30:.6f}\n")
    aud = os.path.join(A, f'{name}.wav')
    if edl == FULL: shutil.copy(mix, aud)
    else: audio_for(mix, edl, aud)
    dst = os.path.join(OUT, f'{name}.mp4')
    run(['ffmpeg', '-y', '-hide_banner', '-f', 'concat', '-safe', '0', '-i', cl, '-i', aud, '-r', '30', '-c:v', 'libx264', '-preset', 'slow', '-crf', '16',
         '-profile:v', 'high', '-pix_fmt', 'yuv420p', '-movflags', '+faststart', '-c:a', 'aac', '-b:a', '320k', '-shortest', dst])
    os.remove(cl); print('encoded', name, flush=True)
    return dst
SUF = {'v': 'vertical', 'w': '16x9'}
for fmt in FMTS:
    encode(f'THE-SIGNAL-60s-{SUF[fmt]}', fmt, 'a', FULL, os.path.join(A, 'mix_a.wav'))
    encode(f'THE-SIGNAL-60s-hookB-{SUF[fmt]}', fmt, 'b', FULL, os.path.join(A, 'mix_b.wav'))
    encode(f'THE-SIGNAL-60s-hookC-{SUF[fmt]}', fmt, 'c', FULL, os.path.join(A, 'mix_c.wav'))
    encode(f'THE-SIGNAL-60s-no-voiceover-{SUF[fmt]}', fmt, 'a', FULL, os.path.join(A, 'mix_novo.wav'))
    encode(f'THE-SIGNAL-30s-{SUF[fmt]}', fmt, 'a', CUT30, os.path.join(A, 'mix_a.wav'))
    encode(f'THE-SIGNAL-15s-{SUF[fmt]}', fmt, 'a', CUT15, os.path.join(A, 'mix_a.wav'))
for name, hook, edl in (('THE-SIGNAL-60s', 'a', FULL), ('THE-SIGNAL-60s-hookB', 'b', FULL), ('THE-SIGNAL-60s-hookC', 'c', FULL),
                        ('THE-SIGNAL-30s', 'a', CUT30), ('THE-SIGNAL-15s', 'a', CUT15)):
    srt(cut_lines(hook, edl), os.path.join(OUT, f'{name}.srt'))
print('done')
