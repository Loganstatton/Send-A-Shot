"""Narration for NEXT × SCOUT — "THE SIGNAL", synthesized with Kokoro-82M (Apache-2.0 model and
voices: commercial use allowed; no real person's voice is imitated). One WAV per line + durations.json.

  tts-venv/bin/python vo5.py MODEL.onnx VOICES.bin OUT_DIR [--voice af_heart] [--speed 1.0] [--only key,key]
  python vo5.py - - OUT_DIR --split-only       (re-split existing lines; no synthesis)

Lines in SPLIT are also written as two files at their sentence gap (hook_c -> hook_c1, hook_c2), so the
mix can land each sentence on its own picture beat.
"""
import json, os, sys
import numpy as np, soundfile as sf

MODEL, VOICES, OUT = sys.argv[1:4]
args = sys.argv[4:]
def arg(n, d): return args[args.index(n) + 1] if n in args else d
VOICE, SPEED = arg('--voice', 'af_heart'), float(arg('--speed', '1.0'))
# The approved script, one entry per line (some split where the picture needs a pause).
LINES = {
    'stock':    "This isn't a stock.",
    'artist':   "It's an artist.",
    'scout':    'SCOUT discovers promising musicians before they appear on NEXT.',
    # Accuracy: in the app a scout approves a candidate first (that lists it on NEXT), then rates the
    # eight factors. The brief's line had the order reversed.
    'review':   'Human reviewers approve which artists go live, then rate them on eight factors.',
    'begins':   "That's where NEXT begins.",
    'discover': 'Discover new music. Listen. Explore each artist\'s story.',
    'credits':  'Start with ten thousand virtual Credits.',
    'trade':    'Buy and sell artist shares in a simulated market, where trades move prices.',
    'build':    'Build your portfolio. Follow favorites. Compete on leaderboards.',
    'believer': 'Back an artist first? Your Founding Believer card records it.',
    'finds':    'SCOUT finds the talent. NEXT lets you back it.',
    'next':     "Find what's next.",
    # alternative hooks
    'hook_b':   'The next big artist is still unknown.',
    'hook_c':   'One system finds them. Another lets you back them.',
}
SPLIT = {'hook_c': ('One system finds them.', 'Another lets you back them.')}
def split_lines(meta):
    """Cut each SPLIT line at its longest pause (both halves keep 20 ms of the gap's silence)."""
    for key, (t1, t2) in SPLIT.items():
        p = os.path.join(OUT, f'{key}.wav')
        if not os.path.exists(p): continue
        x, sr = sf.read(p, dtype='float32'); m = x if x.ndim == 1 else x[:, 0]
        e = np.convolve(np.abs(m), np.ones(int(0.02 * sr)) / int(0.02 * sr), 'same') > 0.01
        on = np.where(e)[0]; gaps = np.diff(on); g = int(np.argmax(gaps))   # the longest silent run
        a, b = on[g] + int(0.02 * sr), on[g + 1] - int(0.02 * sr)
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
    text = LINES[key]
    audio, sr = k.create(text, voice=VOICE, speed=SPEED, lang='en-us')
    audio = np.asarray(audio, np.float32)
    nz = np.where(np.abs(audio) > 0.01)[0]          # trim silence, keep 20 ms pads
    a, b = max(0, nz[0] - int(0.02 * sr)), min(len(audio), nz[-1] + int(0.02 * sr))
    audio = audio[a:b]
    sf.write(os.path.join(OUT, f'{key}.wav'), audio, sr)
    dur[key] = round(len(audio) / sr, 3)
    print(f'{key:9s} {dur[key]:.2f}s  {text}')
split_lines({'voice': VOICE, 'speed': SPEED, 'durations': dur, 'lines': {k_: LINES[k_] for k_ in keys_}})
