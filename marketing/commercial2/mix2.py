"""Final mix for NEXT Ad #2: score + original sound design + voiceover (ducked).

  post-venv/bin/python mix2.py OUT.wav SECONDS --music music.wav --vo VO_DIR [--hook a|b|c]
All sound design is synthesized here (no samples). Voice lines come from vo.py.
"""
import json, os, sys
import numpy as np
from scipy import signal
from scipy.io import wavfile

SR = 48000
OUTP, LEN = sys.argv[1], float(sys.argv[2])
args = sys.argv[3:]
def arg(n, d=None): return args[args.index(n) + 1] if n in args else d
N = int(SR * LEN)
rng = np.random.default_rng(31)
L = np.zeros(N); R = np.zeros(N)
def at(s): return int(round(s * SR))
def sos(kind, f, order=2): return signal.butter(order, f, btype=kind, fs=SR, output='sos')
def add(x, start, gain=1.0, pan=0.0, bus=None):
    bus = bus or (L, R)
    s0 = at(start)
    if s0 >= N or s0 < 0: return
    x = x[:N - s0]; gl, gr = np.cos((pan + 1) * np.pi / 4) * 1.414, np.sin((pan + 1) * np.pi / 4) * 1.414
    bus[0][s0:s0 + len(x)] += x * gain * gl; bus[1][s0:s0 + len(x)] += x * gain * gr
def e(n, d): return np.exp(-np.arange(n) / SR / d)

def boom(level=1.0, f0=32):
    n = at(1.6); t = np.arange(n) / SR
    return (np.sin(2 * np.pi * np.cumsum(f0 + 70 * np.exp(-t / 0.07)) / SR) * e(n, 0.55)
            + signal.sosfilt(sos('lowpass', 160), rng.standard_normal(n)) * e(n, 0.05) * 0.5) * level
def whoosh(dur, lo, hi, level, rise=False):
    n = at(dur); t = np.arange(n) / SR; x = rng.standard_normal(n); out = np.zeros(n)
    for i in range(0, n, 1200):
        p = i / n; c = lo + (hi - lo) * (p ** 2 if rise else np.sin(np.pi * p) ** 2)
        out[i:i + 1200] = signal.sosfilt(sos('bandpass', [max(40, c * 0.55), min(c * 1.5, 20000)]), x[i:i + 1200])
    shape = (t / dur) ** 2.2 if rise else np.sin(np.pi * t / dur) ** 1.4
    return out * shape * level
def click(level=0.3, f=2600):
    n = at(0.035); t = np.arange(n) / SR
    return (np.sin(2 * np.pi * f * t) * 0.6 + signal.sosfilt(sos('highpass', 3000), rng.standard_normal(n)) * 0.4) * e(n, 0.005) * level
def shimmer(dur, level=0.08):
    n = at(dur); t = np.arange(n) / SR
    x = sum(np.sin(2 * np.pi * f * t + rng.uniform(0, 6)) for f in (2093, 2637, 3136, 3951)) / 4
    trem = 0.6 + 0.4 * np.sin(2 * np.pi * 7 * t)
    return x * trem * np.sin(np.pi * t / dur) * level
def shing(level=0.06):
    n = at(0.9); t = np.arange(n) / SR
    return signal.sosfilt(sos('bandpass', [5000, 12000]), rng.standard_normal(n)) * np.sin(np.pi * t / 0.9) ** 2 * level

# ---------------------------------------------------------------- sound design (opening, 0–4 s)
add(boom(0.9, 34), 0.0)                                         # the opening punch
add(click(0.35, 3200), 0.0)
add(whoosh(0.55, 300, 9000, 0.16, rise=True), 1.45)             # the camera rushes the phone
add(np.sin(2 * np.pi * 70 * np.arange(at(0.3)) / SR) * e(at(0.3), 0.05) * 0.5, 1.93)   # lights out
add(click(0.25, 1500), 1.93)
add(boom(1.1, 28), 2.0)                                         # PROVE IT
add(whoosh(0.35, 3000, 14000, 0.06), 2.0, pan=0.4)
for k in range(3):                                               # the ring travelling round the phone
    add(shimmer(0.7, 0.05), 2.05 + k * 0.55, pan=(-0.6, 0.6, -0.3)[k])
add(shing(0.05), 2.4, pan=-0.3)                                  # reflection across the glass

# ---------------------------------------------------------------- voiceover
VO = arg('--vo'); hook = arg('--hook', 'a')
CUES = [('hook_' + hook, 0.12), ('prove', 2.08)]
if LEN > 4.5:
    CUES += [('discover', 4.25), ('back', 7.3), ('track', 11.15), ('proof', 15.55), ('end', 18.3)]
VL = np.zeros(N); VR = np.zeros(N); vo_env = np.zeros(N)
if VO:
    for key, t0 in CUES:
        p = os.path.join(VO, f'{key}.wav')
        if not os.path.exists(p): continue
        import soundfile as sf
        v, vsr = sf.read(p, dtype='float32')
        if v.ndim > 1: v = v.mean(1)
        v = signal.resample_poly(v, SR, vsr)
        v = signal.sosfilt(sos('highpass', 90), v)               # clean low end
        v = v / (np.abs(v).max() + 1e-9) * 0.9
        add(v, t0, 1.0, 0.0, (VL, VR))
        s0 = at(t0); vo_env[s0:s0 + len(v)] = 1.0
    # duck everything else under the voice (60 ms attack, 250 ms release)
    k_att, k_rel = np.exp(-1 / (0.06 * SR)), np.exp(-1 / (0.25 * SR))
    g = np.zeros(N); y = 0.0
    for i in range(N):
        x = vo_env[i]; y = x + (y - x) * (k_att if x > y else k_rel); g[i] = y
    duckg = 1 - 0.62 * g
else:
    duckg = np.ones(N)

# ---------------------------------------------------------------- music + mix
mus = np.zeros((N, 2))
if arg('--music'):
    msr, m = wavfile.read(arg('--music')); m = m.astype(np.float64) / 32768
    n_ = min(len(m), N); mus[:n_] = m[:n_]
sfx = np.stack([L, R], 1); sfx = sfx / (np.abs(sfx).max() + 1e-9)
bed = (mus / (np.abs(mus).max() + 1e-9) * 0.8 + sfx * 0.45) * duckg[:, None]
vo = np.stack([VL, VR], 1) * 0.95
mix = bed + vo
mix = np.tanh(mix * 1.1) / np.tanh(1.1)
mix *= 10 ** (-4.0 / 20) / np.abs(mix).max()                     # sample peak -4 dBFS (true-peak headroom for AAC)
f_ = at(0.04); mix[-f_:] *= np.linspace(1, 0, f_)[:, None]
wavfile.write(OUTP, SR, (mix * 32767).astype(np.int16))
print('wrote', OUTP, f'{LEN}s', 'cues:', [c for c, _ in CUES])
