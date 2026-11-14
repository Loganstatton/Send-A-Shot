"""Final mix for "THE SIGNAL": narration over music and effects, with the music ducked and
carved under every line so the voice stays clear on phone speakers.

  post-venv/bin/python mix5.py STEMS_DIR VO_DIR OUT.wav [--len 60] [--no-vo] [--placements key@sec,...]

STEMS_DIR holds music.wav and sfx.wav (music5.py); VO_DIR holds one WAV per narration line (vo5.py).
Also writes OUT_dir/stem_{voice,music,sfx}.wav at the final mix levels (they sum to the mix before
the master limiter).
"""
import os, sys
import numpy as np
from scipy import signal
from scipy.io import wavfile
import soundfile as sf

STEMS, VO, OUTF = sys.argv[1:4]
args = sys.argv[4:]
def arg(n, d=None): return args[args.index(n) + 1] if n in args else d
LEN = float(arg('--len', '60'))
SR = 48000; N = int(SR * LEN)
def sos(kind, f, order=2): return signal.butter(order, f, btype=kind, fs=SR, output='sos')
def load(p):
    x, sr = sf.read(p, dtype='float32', always_2d=True)
    if sr != SR: x = signal.resample_poly(x, SR, sr, axis=0)
    if x.shape[1] == 1: x = np.repeat(x, 2, 1)
    out = np.zeros((N, 2), np.float32); out[:min(N, len(x))] = x[:N]; return out

# where each line starts (seconds); the hook's lines are picture-locked to the titles
PLACE = {'stock': 0.08, 'artist': 1.36}
if arg('--placements'):
    for kv in arg('--placements').split(','):
        k, v = kv.split('@'); PLACE[k] = float(v)

music, sfx = load(os.path.join(STEMS, 'music.wav')), load(os.path.join(STEMS, 'sfx.wav'))
voice = np.zeros((N, 2), np.float32)
if '--no-vo' not in args:
    for k, t in PLACE.items():
        p = os.path.join(VO, f'{k}.wav')
        if not os.path.exists(p): continue
        x, sr = sf.read(p, dtype='float32')
        if sr != SR: x = signal.resample_poly(x, SR, sr)
        # voice chain: high-pass, gentle presence lift, soft compression, light de-ess
        x = signal.sosfilt(sos('highpass', 90), x)
        x = x + 0.25 * signal.sosfilt(sos('bandpass', [2500, 5000]), x)
        ess = signal.sosfilt(sos('bandpass', [5500, 9500]), x); x = x - 0.4 * ess * (np.abs(ess) > 0.05)
        x = np.tanh(x * 2.2) / np.tanh(2.2)
        s0 = int(t * SR); x = x[:N - s0]
        voice[s0:s0 + len(x)] += x[:, None] * 0.62
# ducking: follow the voice envelope; the music dips and its speech band is carved out
def follower(x, att, rel):
    e = np.abs(x).astype(np.float64); out = np.zeros_like(e); a, r = np.exp(-1 / (att * SR)), np.exp(-1 / (rel * SR)); v = 0.0
    for i in range(0, len(e), 64):
        m = e[i:i + 64].max(); v = (a if m > v else r) * v + (1 - (a if m > v else r)) * m; out[i:i + 64] = v
    return out
venv = follower(voice[:, 0], 0.01, 0.3); venv = np.clip(venv / (venv.max() + 1e-9) * 2.5, 0, 1)[:, None]
music_sp = signal.sosfilt(sos('bandpass', [350, 4000]), music, axis=0)
music_d = (music - 0.85 * venv * music_sp) * (1 - 0.55 * venv)
sfx_d = sfx * (1 - 0.3 * venv)
mix = music_d * 0.9 + sfx_d * 0.85 + voice
peak = np.abs(mix).max()
g = 10 ** (-1.5 / 20) / peak
out = np.tanh(mix * g * 1.15) / np.tanh(1.15)
d = os.path.dirname(os.path.abspath(OUTF))
for nm, x in (('voice', voice), ('music', music_d * 0.9), ('sfx', sfx_d * 0.85)):
    wavfile.write(os.path.join(d, f'stem_{nm}.wav'), SR, (x * g).astype(np.float32))
wavfile.write(OUTF, SR, out.astype(np.float32))
print('mix written', OUTF, 'peak before limiter', round(20 * np.log10(peak * g), 2), 'dBFS')
