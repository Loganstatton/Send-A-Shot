"""Original score for the NEXT reveal trailer — cinematic hybrid, D minor, a 60 BPM
pulse that doubles to 120 for the product demo. Synthesized from scratch (no
samples, loops or borrowed melodies). Different from Ad #1 (100 BPM industrial,
F minor) and Ad #2 (120 BPM hip-hop, C minor).

  0–5    near silence: a deep pulse every second, air, a faint shimmer
  5–11   build: ticking textures, a pluck arpeggio rising, toms into 11
  11–13  the cards converge: riser … 12.6 silence … 13.0 THE REVEAL (braam + sub)
  13–17  the phone: held chord, pulse
  17–25  demo: 120 BPM electronic drive (kick, snare, 16th arp, bass ostinato)
  25–32  hush: pad + bell motif, heartbeat, swell into the card's lines
  32–40  crescendo: 32 build, 34 final impact (logo), held chord, clean tail

  post-venv/bin/python music3.py out.wav [seconds] [--env env.json]
--env writes the per-frame (30 fps) loudness envelope that drives the 3D waveform.
"""
import json, sys
import numpy as np
from scipy import signal
from scipy.io import wavfile

SR = 48000
LEN = float(sys.argv[2]) if len(sys.argv) > 2 and not sys.argv[2].startswith('--') else 40.0
N = int(SR * (LEN + 3.0))
rng = np.random.default_rng(1977)
L = np.zeros(N); R = np.zeros(N)
def at(s): return int(round(s * SR))
def midi(n): return 440.0 * 2 ** ((n - 69) / 12)
def sos(kind, f, order=2): return signal.butter(order, f, btype=kind, fs=SR, output='sos')
def add(x, start, gain=1.0, pan=0.0):
    s0 = at(start)
    if s0 >= N or s0 < 0: return
    x = x[:N - s0]; gl, gr = np.cos((pan + 1) * np.pi / 4) * 1.414, np.sin((pan + 1) * np.pi / 4) * 1.414
    L[s0:s0 + len(x)] += x * gain * gl; R[s0:s0 + len(x)] += x * gain * gr
def T(n): return np.arange(n) / SR
def env(n, a, d): t = T(n); return np.minimum(1, t / a) * np.exp(-t / d)

def pulse(level=1.0):                          # deep heartbeat thump
    n = at(0.9); t = T(n)
    return np.sin(2 * np.pi * np.cumsum(34 + 40 * np.exp(-t / 0.05)) / SR) * env(n, 0.004, 0.32) * level
def air(dur, level):
    n = at(dur); x = signal.sosfilt(sos('bandpass', [2500, 9000]), rng.standard_normal(n))
    return x * np.sin(np.pi * T(n) / dur) * level
def pad(notes, dur, level, bright=1200, attack=1.5):
    n = at(dur); t = T(n); x = np.zeros(n)
    for m in notes:
        for det in (-0.004, 0.0, 0.004):
            x += np.sin(2 * np.pi * midi(m) * (1 + det) * t + 0.3 * np.sin(2 * np.pi * 0.11 * t))
    x = signal.sosfilt(sos('lowpass', bright), x / (3 * len(notes)))
    shape = np.minimum(1, t / attack) * np.minimum(1, (dur - t) / 1.2).clip(0)
    return x * shape * level
def pluck(m, level=1.0, bright=2500):
    n = at(0.5); t = T(n)
    x = signal.sawtooth(2 * np.pi * midi(m) * t) * 0.6 + np.sin(2 * np.pi * midi(m) * t)
    return signal.sosfilt(sos('lowpass', bright), x) * env(n, 0.002, 0.12) * 0.16 * level
def tick(level=1.0):
    n = at(0.03); return signal.sosfilt(sos('highpass', 5000), rng.standard_normal(n)) * env(n, 0.0005, 0.004) * level
def tom(f=90, level=1.0):
    n = at(0.7); t = T(n)
    return np.sin(2 * np.pi * np.cumsum(f * (1 + 0.6 * np.exp(-t / 0.04))) / SR) * env(n, 0.002, 0.25) * level
def kick(level=1.0):
    n = at(0.45); t = T(n)
    b = np.sin(2 * np.pi * np.cumsum(44 + 150 * np.exp(-t / 0.03)) / SR) * np.exp(-t / 0.2)
    c = signal.sosfilt(sos('highpass', 2500), rng.standard_normal(n)) * np.exp(-t / 0.003) * 0.3
    return np.tanh((b + c) * 2.0 * level) * 0.85
def snare(level=1.0):
    n = at(0.3); t = T(n)
    body = np.sin(2 * np.pi * 185 * t) * np.exp(-t / 0.05) * 0.45
    x = signal.sosfilt(sos('bandpass', [1800, 9000]), rng.standard_normal(n)) * np.exp(-t / 0.09)
    return np.tanh((body + x) * 1.5) * 0.45 * level
def hat(level=1.0):
    n = at(0.05); t = T(n)
    return signal.sosfilt(sos('highpass', 8000), rng.standard_normal(n)) * np.exp(-t / 0.012) * 0.16 * level
def bass(m, dur, level=1.0):
    n = at(dur); t = T(n)
    x = signal.sawtooth(2 * np.pi * midi(m) * t) + 0.7 * np.sin(2 * np.pi * midi(m) / 2 * t)
    return np.tanh(signal.sosfilt(sos('lowpass', 700), x) * 2.5) * env(n, 0.003, dur * 0.9) * 0.3 * level
def braam(notes, dur, level=1.0):
    """The trailer horn: detuned low saws through a slowly opening filter + sub."""
    n = at(dur); t = T(n); x = np.zeros(n)
    for m in notes:
        for det in (-0.012, -0.004, 0.004, 0.012):
            x += signal.sawtooth(2 * np.pi * midi(m) * (1 + det) * t)
    x /= 4 * len(notes); out = np.zeros(n); zi = None
    cut = 180 + 2600 * (1 - np.exp(-t / 0.25)) * np.exp(-t / (dur * 0.6))
    for i in range(0, n, 512):
        s_ = sos('lowpass', float(min(cut[i], SR / 2.5)))
        seg, zi = signal.sosfilt(s_, x[i:i + 512], zi=zi if zi is not None else signal.sosfilt_zi(s_) * x[i])
        out[i:i + 512] = seg
    sub = np.sin(2 * np.pi * midi(notes[0] - 12) * t) * 0.6
    return np.tanh((out * 2.6 + sub) * 1.2) * np.minimum(1, t / 0.01) * np.exp(-t / (dur * 0.55)) * 0.55 * level
def metal(level=1.0):
    n = at(2.2); t = T(n)
    x = sum(a * np.sin(2 * np.pi * f * t + rng.uniform(0, 6)) * np.exp(-t / d)
            for f, a, d in ((211, 1.0, 1.1), (487, 0.6, 0.8), (853, 0.4, 0.6), (1291, 0.28, 0.45), (1873, 0.18, 0.3)))
    return x * 0.2 * np.minimum(1, t / 0.001) * level
def riser(dur, level=0.25):
    n = at(dur); t = T(n); x = rng.standard_normal(n); out = np.zeros(n)
    for i in range(0, n, 1200):
        c = 250 + 9000 * (i / n) ** 2; out[i:i + 1200] = signal.sosfilt(sos('bandpass', [c * 0.6, min(c * 1.5, 20000)]), x[i:i + 1200])
    tone = np.sin(2 * np.pi * np.cumsum(110 + 330 * (t / dur) ** 2) / SR) * 0.4
    return (out + tone) * (t / dur) ** 2.6 * level
def bell(m, level=1.0, dur=2.4):
    n = at(dur); t = T(n); f = midi(m)
    x = np.sin(2 * np.pi * f * t + 1.6 * np.sin(2 * np.pi * f * 2.0 * t) * np.exp(-t / 0.4))
    return x * env(n, 0.002, 0.9) * 0.13 * level

Dm, Bb, F_, C_ = (50, 53, 57, 62), (46, 50, 53, 58), (41, 45, 48, 53), (48, 52, 55, 60)
# 0–5: pulse, air, shimmer
for k in range(5): add(pulse(0.22 + 0.04 * k), float(k))
add(air(5.0, 0.03), 0.0)
add(pad((74, 77, 81), 5.5, 0.025, 4000, 2.5), 0.3, pan=0.2)
add(bell(93, 0.7, 3.0), 0.13, pan=0.1)                            # SFX: the light wakes (frame 4)
add(riser(1.6, 0.2), 0.9)                                      # SFX: the wave unfolds (frames 28-96)
# 5–11: build
for k in range(5, 11): add(pulse(0.4 + 0.1 * (k - 5)), float(k))
add(pad(Dm, 6.5, 0.035, 900, 2.5), 5.0); add(pad(Bb, 3.5, 0.045, 1100), 8.0)
ARP = [62, 65, 69, 72, 69, 65]
for i in range(int(6.0 / 0.25)):
    t0 = 5.0 + i * 0.25; p = i / 24
    add(pluck(ARP[i % len(ARP)], 0.15 + 0.85 * p ** 1.5, 1200 + 3500 * p), t0, 1.0, pan=-0.4 + 0.8 * ((i % 4) / 3))
    add(tick(0.15 + 0.4 * p), t0 + 0.125, 1.0, pan=0.5)
for t0, f in ((9.0, 80), (9.5, 90), (10.0, 80), (10.25, 100), (10.5, 90), (10.75, 110)): add(tom(f, 0.9), t0)
# 11–13: converge → silence → 13.0 REVEAL
add(riser(1.6, 0.3), 11.0)
add(braam((38, 45, 50), 4.5, 1.15), 13.0); add(metal(1.0), 13.0); add(kick(1.4), 13.0)
add(pad(Dm, 4.2, 0.07, 1500), 13.2)
for k in (14, 15, 16): add(pulse(0.9), float(k))
add(bell(74, 0.7), 14.0); add(bell(81, 0.5), 15.0)          # the screen lights up
# 17–25: demo drive (120 BPM)
for i in range(16):                                          # 16 beats
    t0 = 17.0 + i * 0.5
    add(kick(1.0), t0)
    if i % 2 == 1: add(snare(0.9), t0, pan=0.05)
    for h in range(2): add(hat(0.9 if h else 0.6), t0 + h * 0.25, pan=0.3)
OST = [38, 38, 41, 38, 43, 38, 41, 36]
for i in range(32):
    t0 = 17.0 + i * 0.25
    add(bass(OST[i % 8], 0.22, 1.0), t0)
    add(pluck([62, 65, 69, 74][i % 4] + (12 if i >= 16 else 0), 0.7, 3200), t0, 1.0, pan=-0.5 + (i % 4) / 3)
add(pad(Dm, 4.2, 0.05, 1600), 17.0); add(pad(Bb, 4.2, 0.05, 1600), 21.0)
add(riser(0.9, 0.22), 24.1)
def click(level=1.0):                                        # a short glassy UI tap
    t = np.arange(int(SR * 0.035)) / SR
    return (np.sin(2 * np.pi * 2300 * t) + 0.4 * np.sin(2 * np.pi * 4100 * t)) * np.exp(-t / 0.006) * 0.22 * level
for t0 in (18.5, 19.167, 19.6, 20.6): add(click(1.0), t0, pan=0.1)    # SFX: Trade · $250 · Review · Confirm (frames 556, 576, 589, 619)
add(bell(81, 0.55, 1.6), 20.7, pan=0.1); add(bell(88, 0.4, 1.6), 20.78, pan=-0.1)      # SFX: "Bought" (frame 622)
for t0 in (21.57, 21.97, 22.37): add(bell(93, 0.28, 1.2), t0, pan=0.3)               # SFX: the three panels pop out
# 25–32: hush — the collectible
add(pad(F_, 4.0, 0.06, 1000, 1.0), 25.0); add(pad(C_, 3.6, 0.065, 1200, 1.0), 28.4)
for k in range(25, 32): add(pulse(0.55 + 0.05 * (k - 25)), float(k))
for t0, m in ((25.5, 69), (26.5, 72), (27.5, 74), (29.0, 77), (30.5, 81)): add(bell(m, 0.9), t0, pan=0.15)
add(metal(0.45), 27.5); add(metal(0.6), 29.0)                # FOUNDING BELIEVER · BACKER #1
add(riser(1.5, 0.18), 30.5)
# 32–40: crescendo and the logo
add(braam((38, 45, 50), 2.2, 0.9), 32.0); add(kick(1.2), 32.0)
for t0, f in ((32.5, 80), (32.75, 90), (33.0, 100), (33.25, 90), (33.5, 110), (33.75, 120)): add(tom(f, 1.0), t0)
add(braam((38, 45, 50, 57), 5.5, 1.3), 34.0); add(metal(1.1), 34.0); add(kick(1.5), 34.0)   # the logo lands
add(pad(Dm + (65,), 6.0, 0.08, 2000, 0.8), 34.0)
add(bell(86, 0.8, 3.0), 35.5); add(bell(81, 0.6, 3.0), 36.0)                                # the tagline
# master
mix = np.stack([L, R], 1)
ir = rng.standard_normal(at(2.2)) * np.exp(-T(at(2.2)) / 0.6); ir = signal.sosfilt(sos('lowpass', 5000), ir); ir /= np.abs(ir).sum() / 5
mix[:, 0] += 0.22 * signal.fftconvolve(mix[:, 0], ir)[:N]; mix[:, 1] += 0.22 * signal.fftconvolve(mix[:, 1], np.roll(ir, 397))[:N]
mix = np.tanh(mix * 1.1) / np.tanh(1.1)
mix = mix[:at(LEN)]
mix *= 10 ** (-4.5 / 20) / np.abs(mix).max()
f_ = at(0.6 if LEN > 30 else 0.05); mix[-f_:] *= np.linspace(1, 0, f_)[:, None] ** 2
wavfile.write(sys.argv[1], SR, (mix * 32767).astype(np.int16))
if '--env' in sys.argv:                                       # 30 fps loudness envelope for the 3D waveform
    m = np.abs(mix).mean(1); hop = SR // 30
    e = [float(np.sqrt((m[i * hop:(i + 1) * hop] ** 2).mean())) for i in range(len(m) // hop)]
    e = np.array(e); e = e / (e.max() + 1e-9)
    sm = np.convolve(e, np.ones(3) / 3, mode='same')
    json.dump([round(float(v), 4) for v in sm], open(sys.argv[sys.argv.index('--env') + 1], 'w'))
print('wrote', sys.argv[1], f'{LEN}s')
