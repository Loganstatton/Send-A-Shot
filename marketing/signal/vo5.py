"""Narration for NEXT × SCOUT — "THE SIGNAL", synthesized with Kokoro-82M (Apache-2.0 model and
voices: commercial use allowed; no real person's voice is imitated). One WAV per line + durations.json.

  tts-venv/bin/python vo5.py MODEL.onnx VOICES.bin OUT_DIR [--voice af_heart] [--speed 1.0] [--only key,key]
"""
import json, os, sys
import numpy as np, soundfile as sf
from kokoro_onnx import Kokoro

MODEL, VOICES, OUT = sys.argv[1:4]
args = sys.argv[4:]
def arg(n, d): return args[args.index(n) + 1] if n in args else d
VOICE, SPEED = arg('--voice', 'af_heart'), float(arg('--speed', '1.0'))
# The approved script, one entry per line (some split where the picture needs a pause).
LINES = {
    'stock':    "This isn't a stock.",
    'artist':   "It's an artist.",
    'scout':    'SCOUT discovers promising musicians before they appear on NEXT.',
    'review':   'Human reviewers evaluate eight factors, then approve which artists go live.',
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
json.dump({'voice': VOICE, 'speed': SPEED, 'durations': dur, 'lines': {k_: LINES[k_] for k_ in keys_}},
          open(os.path.join(OUT, 'durations.json'), 'w'), indent=2)
