"""Original score for the NEXT commercial: dark industrial electronic, F minor,
100 BPM. Synthesized from scratch (no samples, loops or borrowed melodies),
so it is fully ours to use in ads.

At 100 BPM a beat is 0.6 s = 18 frames at 30 fps, so cuts land on beats:
  0.0 s  impact (first frame)      1.2 s  shatter = drop (beat 3)
  1.8 s  "ISN'T FAMOUS YET." slam (beat 4)

  python music.py out.wav [seconds] [--drop 1.2]
"""
import sys
import numpy as np
from scipy import signal
from scipy.io import wavfile

SR = 48000
LEN = float(sys.argv[2]) if len(sys.argv) > 2 and not sys.argv[2].startswith('--') else 3.0
DROP = float(sys.argv[sys.argv.index('--drop') + 1]) if '--drop' in sys.argv else 1.2
BPM = 100.0
BEAT = 60.0 / BPM
S16 = BEAT / 4
N = int(SR * (LEN + 1.5))           # extra tail, trimmed at the end
rng = np.random.default_rng(23)
L = np.zeros(N); R = np.zeros(N)
duck = np.ones(N)                   # sidechain envelope from the kick

def at(s): return int(round(s * SR))
def midi(n): return 440.0 * 2 ** ((n - 69) / 12)
def sos(kind, f, order=2): return signal.butter(order, f, btype=kind, fs=SR, output='sos')
def add(x, start, gain=1.0, pan=0.0, ch=None):
    s0 = at(start)
    if s0 >= N: return
    x = x[:N - s0]
    gl, gr = np.cos((pan + 1) * np.pi / 4) * 1.414, np.sin((pan + 1) * np.pi / 4) * 1.414
    L[s0:s0 + len(x)] += x * gain * gl; R[s0:s0 + len(x)] += x * gain * gr

def kick(strength=1.0):
    n = at(0.45); t = np.arange(n) / SR
    f = 42 + 130 * np.exp(-t / 0.035)
    body = np.sin(2 * np.pi * np.cumsum(f) / SR) * np.exp(-t / 0.22)
    click = signal.sosfilt(sos('highpass', 1500), rng.standard_normal(n)) * np.exp(-t / 0.004) * 0.5
    return np.tanh((body + click) * 2.2 * strength) * 0.9

def hat(open_=False, accent=1.0):
    n = at(0.25 if open_ else 0.06); t = np.arange(n) / SR
    metal = sum(signal.square(2 * np.pi * f * t) for f in (3150, 4430, 5870, 7210, 8340)) / 5
    x = signal.sosfilt(sos('highpass', 7000, 4), metal + 0.6 * rng.standard_normal(n))
    return x * np.exp(-t / (0.09 if open_ else 0.018)) * 0.22 * accent

def clap():
    n = at(0.3); t = np.arange(n) / SR
    x = signal.sosfilt(sos('bandpass', [900, 4000]), rng.standard_normal(n))
    env = sum(np.exp(-np.clip(t - d, 0, None) / 0.008) * (t >= d) for d in (0, 0.011, 0.022)) * 0.6 + np.exp(-t / 0.12) * 0.5
    return x * env * 0.5

def bass_note(note, dur, cutoff_peak, drive=3.0):
    n = at(dur); t = np.arange(n) / SR
    f = midi(note)
    osc = signal.sawtooth(2 * np.pi * f * t) + signal.sawtooth(2 * np.pi * f * 1.006 * t) + 0.8 * np.sin(2 * np.pi * f / 2 * t)
    env_f = 120 + cutoff_peak * np.exp(-t / 0.05)
    out = np.zeros(n); zi = None
    for i in range(0, n, 256):            # filter envelope, block-wise
        s = sos('lowpass', min(env_f[i], SR / 2.2))
        seg, zi = signal.sosfilt(s, osc[i:i + 256], zi=zi if zi is not None else signal.sosfilt_zi(s) * osc[i]) if True else (None, None)
        out[i:i + 256] = seg
    amp = np.minimum(1, t / 0.003) * np.exp(-t / (dur * 1.4))
    return np.tanh(out * drive) * amp * 0.32

def stab(notes, dur, bright=3000):
    n = at(dur); t = np.arange(n) / SR
    x = np.zeros(n)
    for nn in notes:
        for det in (-0.012, -0.004, 0.004, 0.012):
            x += signal.sawtooth(2 * np.pi * midi(nn) * (1 + det) * t)
    x = signal.sosfilt(sos('lowpass', bright), x / (len(notes) * 4))
    return np.tanh(x * 2.5) * np.exp(-t / (dur * 0.5)) * 0.35

def crash(level=1.0):
    n = at(2.2); t = np.arange(n) / SR
    x = signal.sosfilt(sos('highpass', 4000), rng.standard_normal(n))
    return x * np.exp(-t / 0.7) * 0.18 * level

# ---------------------------------------------------------------- arrangement
# Bass riff (my own): 16ths in F minor, two bars, pushing on the off-steps.
F1, Ab1, Bb1, C2, Db2, Eb2, F2 = 29, 32, 34, 36, 37, 39, 41
RIFF = [F1, F1, F2, F1,  F1, Ab1, F1, C2,  F1, F1, Eb2, F1,  Db2, F1, C2, Ab1,
        F1, F1, F2, F1,  F1, Ab1, F1, C2,  F1, F1, F2, Eb2,  Db2, C2, Bb1, Ab1]
steps = int(LEN / S16) + 2
for k in range(steps):
    t0 = k * S16
    if t0 >= LEN + 0.6: break
    beat_pos = k % 4
    # kick every beat; doubled 16th before the drop for tension
    if beat_pos == 0:
        add(kick(1.15 if abs(t0 - DROP) < 1e-6 or t0 == 0 else 1.0), t0, 1.0)
        dn = at(0.25); s0 = at(t0)
        if s0 < N: duck[s0:s0 + dn] = np.minimum(duck[s0:s0 + dn], 1 - 0.75 * np.exp(-np.arange(min(dn, N - s0)) / SR / 0.08))
    if abs(t0 - (DROP - S16)) < 1e-6:
        add(kick(0.8), t0, 0.7)
    # clap on beats 2 and 4 of each bar after the drop
    if t0 >= DROP and (k // 4) % 2 == 1 and beat_pos == 0:
        add(clap(), t0, 0.9, pan=0.05)
    # hats: 16ths, accents on off-beats; quieter before the drop
    acc = 1.0 if beat_pos == 2 else 0.55
    add(hat(open_=(beat_pos == 2 and t0 >= DROP), accent=acc * (0.6 if t0 < DROP else 1.0)), t0, 1.0, pan=0.35 if k % 2 else -0.25)
    # bass: filter closed before the drop, opens after
    note = RIFF[k % len(RIFF)]
    peak = 250 + 500 * min(1, t0 / DROP) ** 2 if t0 < DROP else 2600
    add(bass_note(note, S16 * 0.92, peak, drive=2.0 if t0 < DROP else 3.5), t0, 0.5 if t0 < DROP else 1.1)

# impact on the very first frame, the drop, and the slam
add(stab([41, 44, 48, 53], 1.1, 4200), 0.0, 1.0)               # Fm, wide
add(crash(0.9), 0.0); add(crash(1.0), DROP)
add(stab([41, 44, 48, 53, 56], 1.4, 6000), DROP, 1.1)
add(stab([37, 41, 44, 49], 0.9, 3800), DROP + BEAT, 0.9)        # Db on the slam
# dark pad underneath everything
n = N; t = np.arange(n) / SR
pad = sum(np.sin(2 * np.pi * midi(m) * t + np.sin(2 * np.pi * 0.2 * t) * 0.6) for m in (53, 56, 60, 65)) / 4
add(signal.sosfilt(sos('lowpass', 1400), pad) * 0.05, 0.0)

# ---------------------------------------------------------------- mix
mix = np.stack([L * duck + 0.0, R * duck], axis=1)
# a little room
ir_n = at(0.9); ir = rng.standard_normal(ir_n) * np.exp(-np.arange(ir_n) / SR / 0.25)
ir = signal.sosfilt(sos('lowpass', 5000), ir); ir /= np.abs(ir).sum() / 4
mix[:, 0] += 0.12 * signal.fftconvolve(mix[:, 0], ir)[:N]
mix[:, 1] += 0.12 * signal.fftconvolve(mix[:, 1], np.roll(ir, 211))[:N]
mix = np.tanh(mix * 1.2) / np.tanh(1.2)
mix = mix[:at(LEN)]
mix *= 10 ** (-3.5 / 20) / np.abs(mix).max()
fade = at(0.04); mix[-fade:] *= np.linspace(1, 0, fade)[:, None]
wavfile.write(sys.argv[1], SR, (mix * 32767).astype(np.int16))
print('wrote', sys.argv[1], f'{LEN}s @ {BPM:.0f} BPM, drop at {DROP}s')
