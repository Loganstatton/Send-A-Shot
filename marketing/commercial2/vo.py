"""Voiceover for NEXT Ad #2, synthesized with Kokoro-82M (Apache-2.0 model and
voices: commercial use allowed). Writes one 24 kHz WAV per line + durations.json.

  tts-venv/bin/python vo.py MODEL.onnx VOICES.bin OUT_DIR [--voice af_heart] [--speed 1.05]
"""
import json, os, sys
import numpy as np, soundfile as sf
from kokoro_onnx import Kokoro

MODEL, VOICES, OUT = sys.argv[1:4]
args = sys.argv[4:]
def arg(n, d): return args[args.index(n) + 1] if n in args else d
VOICE, SPEED = arg('--voice', 'af_heart'), float(arg('--speed', '1.05'))
LINES = {
    'hook_a':   'Everybody says they found them first.',
    'prove':    'Prove it.',
    'discover': 'Discover artists before the crowd.',
    'back':     'Back them with virtual Credits.',
    'track':    'Track your picks.',
    'proof':    "And if you're first? You've got the proof.",
    'end':      "Think you know who's next? Prove it.",
    'hook_b':   'Wait. You can trade music artists?',
    'hook_c':   'Can you find the next big artist?',
}
os.makedirs(OUT, exist_ok=True)
k = Kokoro(MODEL, VOICES)
dur = {}
for key, text in LINES.items():
    audio, sr = k.create(text, voice=VOICE, speed=SPEED, lang='en-us')
    audio = np.asarray(audio, np.float32)
    nz = np.where(np.abs(audio) > 0.01)[0]          # trim silence, keep 20 ms pads
    a, b = max(0, nz[0] - int(0.02 * sr)), min(len(audio), nz[-1] + int(0.02 * sr))
    audio = audio[a:b]
    sf.write(os.path.join(OUT, f'{key}.wav'), audio, sr)
    dur[key] = round(len(audio) / sr, 3)
    print(f'{key:9s} {dur[key]:.2f}s  {text}')
json.dump({'voice': VOICE, 'speed': SPEED, 'durations': dur, 'lines': LINES}, open(os.path.join(OUT, 'durations.json'), 'w'), indent=2)
