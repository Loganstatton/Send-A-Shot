"""Narration for THE MOVE, synthesized with Kokoro-82M (Apache-2.0 model and voices: commercial use
allowed; no real person's voice is imitated). One WAV per line + durations.json.

  tts-venv/bin/python vo_move.py MODEL.onnx VOICES.bin OUT_DIR [--voice af_heart] [--speed 1.0] [--only key,key]
  python vo_move.py - - OUT_DIR --split-only

The lines come from the brief, except the end line, which reads the end card.
"""
import json, os, sys
import numpy as np, soundfile as sf

MODEL, VOICES, OUT = sys.argv[1:4]
args = sys.argv[4:]
def arg(n, d): return args[args.index(n) + 1] if n in args else d
VOICE, SPEED = arg('--voice', 'af_heart'), float(arg('--speed', '1.0'))
LINES = {
    'pick':     'One artist. One early pick.',
    'discover': 'Discover the talent before the crowd.',
    'move':     'Back your picks. Watch the market move.',
    'end':      'How good are your picks? Try NEXT free.',
}
# two-sentence lines are also written as two files, cut at their pause, so each sentence lands on its own picture beat
SPLIT = {'pick': ('One artist.', 'One early pick.'), 'move': ('Back your picks.', 'Watch the market move.'),
         'end': ('How good are your picks?', 'Try NEXT free.')}
def split_lines(meta):
    for key, (t1, t2) in SPLIT.items():
        p = os.path.join(OUT, f'{key}.wav')
        if not os.path.exists(p): continue
        x, sr = sf.read(p, dtype='float32'); m = np.abs(x if x.ndim == 1 else x[:, 0])
        on = np.where(np.convolve(m, np.ones(int(0.02 * sr)) / int(0.02 * sr), 'same') > 0.01)[0]
        g = int(np.argmax(np.diff(on))); a, b = on[g] + int(0.02 * sr), on[g + 1] - int(0.02 * sr)
        for k_, seg, txt in ((f'{key}1', x[:a], t1), (f'{key}2', x[b:], t2)):
            sf.write(os.path.join(OUT, f'{k_}.wav'), seg, sr)
            meta['durations'][k_] = round(len(seg) / sr, 3); meta['lines'][k_] = txt
            print(f'{k_:9s} {meta["durations"][k_]:.2f}s  {txt}')
    json.dump(meta, open(os.path.join(OUT, 'durations.json'), 'w'), indent=2)
if '--split-only' in args:
    split_lines(json.load(open(os.path.join(OUT, 'durations.json')))); sys.exit()
from kokoro_onnx import Kokoro
only = arg('--only', None)
keys_ = only.split(',') if only else list(LINES)
os.makedirs(OUT, exist_ok=True)
k = Kokoro(MODEL, VOICES)
dur = {}
for key in keys_:
    audio, sr = k.create(LINES[key], voice=VOICE, speed=SPEED, lang='en-us')
    audio = np.asarray(audio, np.float32)
    nz = np.where(np.abs(audio) > 0.01)[0]                   # trim silence, keep 20 ms pads
    a, b = max(0, nz[0] - int(0.02 * sr)), min(len(audio), nz[-1] + int(0.02 * sr))
    audio = audio[a:b]
    sf.write(os.path.join(OUT, f'{key}.wav'), audio, sr)
    dur[key] = round(len(audio) / sr, 3)
    print(f'{key:9s} {dur[key]:.2f}s  {LINES[key]}')
split_lines({'voice': VOICE, 'speed': SPEED, 'durations': dur, 'lines': {k_: LINES[k_] for k_ in keys_}})
