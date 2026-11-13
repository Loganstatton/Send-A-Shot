"""Original score + synchronized sound design for SCOUT × NEXT — "BEFORE THE BREAKOUT".
Dark electronic, F# minor, 128 BPM. Synthesized from scratch (no samples, loops or
borrowed melodies; nothing to license). Different key, tempo and groove from Ad #1,
Ad #2 and the reveal trailer; the synth voices come from the trailer's toolkit.

  0–4    the hook: sub pulses, a scanning tone that follows the waveform, opening accent at 0.0
  4–12   SCOUT: precise percussion (16th ticks, rim clicks, soft kick), a glassy FM arpeggio,
         UI clicks on the approval and on each rating
  12–17  the connection: rising synthetic tones, the glass panel's whoosh and flip glint,
         a breath of silence, the landing impact at 16.5
  17–28  NEXT: four-on-the-floor drive with an off-beat bass, claps, open hats; UI taps and
         the purchase chime
  28–34  restraint: everything falls away; the card's reveal hit at 29.0; bells; a riser
  34–40  finale: both products together; the logo impact; a long tail

  post-venv/bin/python music4.py out.wav [seconds] [--env env.json]
"""
import json, sys
import numpy as np
from scipy import signal
from scipy.io import wavfile

# ---------------------------------------------------------------- picture-locked cues (seconds), one place to retime
CUE = dict(
    approve=10.63,          # the evaluated profile glows on the monitor (transition local 20)
    lift=11.3,              # the panel leaves the screen (local 40)
    flip=14.13,             # edge-on: SCOUT panel becomes the NEXT card (local 124)
    land=16.5,              # the card lands in the phone (local 196)
    scout_clicks=(5.6, 6.9, 8.1, 8.5, 8.9, 9.3),      # queue · approve · rating sliders
    next_taps=(19.2, 20.4, 21.3, 22.1),                # profile · $250 · review · confirm
    bought=22.4,            # "Bought" chime
    panels=(23.5, 23.9, 24.3),
    card_hit=29.0,          # the Founding Believer card catches the light
    logo=37.0,              # SCOUT × NEXT
)
BPM = 128.0; BEAT = 60.0 / BPM
from scipy.io import wavfile

SR = 48000
LEN = float(sys.argv[2]) if len(sys.argv) > 2 and not sys.argv[2].startswith('--') else 40.0
N = int(SR * (LEN + 3.0))
rng = np.random.default_rng(4417)
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

def fm_bell(m, level=1.0, dur=1.2, ratio=3.5, idx=2.2):
    n = at(dur); t = T(n); f = midi(m)
    return np.sin(2 * np.pi * f * t + idx * np.sin(2 * np.pi * f * ratio * t) * np.exp(-t / 0.15)) * env(n, 0.001, dur * 0.3) * 0.12 * level
def click(level=1.0):                                        # a short glassy UI tap
    t = np.arange(int(SR * 0.035)) / SR
    return (np.sin(2 * np.pi * 2300 * t) + 0.4 * np.sin(2 * np.pi * 4100 * t)) * np.exp(-t / 0.006) * 0.22 * level
def rim(level=1.0):
    n = at(0.08); t = T(n)
    return (signal.sosfilt(sos('bandpass', [1500, 5000]), rng.standard_normal(n)) * 0.5 + np.sin(2 * np.pi * 820 * t)) * np.exp(-t / 0.012) * 0.25 * level
def clap(level=1.0):
    n = at(0.25); t = T(n); x = signal.sosfilt(sos('bandpass', [900, 6000]), rng.standard_normal(n))
    e = sum(np.exp(-np.maximum(t - d, 0) / 0.008) * (t >= d) for d in (0, 0.011, 0.022)) + np.exp(-np.maximum(t - 0.03, 0) / 0.07) * (t >= 0.03)
    return x * e * 0.22 * level
def whoosh(dur, level=0.3, f0=300, f1=6000):
    n = at(dur); t = T(n); x = rng.standard_normal(n); out = np.zeros(n)
    for i in range(0, n, 1200):
        p = i / n; c = f0 * (f1 / f0) ** p; out[i:i + 1200] = signal.sosfilt(sos('bandpass', [c * 0.6, min(c * 1.6, 20000)]), x[i:i + 1200])
    return out * np.sin(np.pi * t / dur) ** 2 * level
def scan(dur, level=0.15, f0=1200, f1=2400):                 # the waveform's tracking tone
    n = at(dur); t = T(n)
    return np.sin(2 * np.pi * np.cumsum(f0 + (f1 - f0) * (t / dur)) / SR) * np.sin(np.pi * t / dur) * level

Fm, D_, A_, E_ = (54, 57, 61), (50, 54, 57), (45, 49, 52), (52, 56, 59)
# ---------------------------------------------------------------- 0–4 the hook
add(braam((42, 49, 54), 2.0, 0.75), 0.0); add(metal(0.5), 0.0)             # opening accent
for k in range(4): add(pulse(0.55 + 0.1 * k), 0.4 + k * 0.9)
add(air(4.0, 0.03), 0.0); add(scan(3.8, 0.05), 0.1, pan=-0.2)
add(pad((66, 69, 73), 4.4, 0.02, 3500, 2.0), 0.2)
add(riser(1.2, 0.18), 2.8)
# ---------------------------------------------------------------- 4–12 SCOUT: precise
t0 = 4.0; nb = int(8.0 / BEAT)
ARP = [66, 69, 73, 78, 73, 69]
for i in range(nb):
    t = t0 + i * BEAT
    if i % 2 == 0: add(kick(0.55), t)
    if i % 4 == 2: add(rim(0.9), t, pan=0.15)
    for s in range(4): add(tick(0.12 + (0.1 if s == 0 else 0)), t + s * BEAT / 4, pan=0.4 - 0.2 * s)
    for h in range(2): add(fm_bell(ARP[(2 * i + h) % len(ARP)] + (0 if i < nb // 2 else 0), 0.35 + 0.25 * (i / nb), 0.9), t + h * BEAT / 2, pan=-0.3 + 0.6 * h)
    if i % 4 == 0: add(bass(42, BEAT * 3.5, 0.45), t)
add(pad(Fm, 4.2, 0.04, 1400), 4.0); add(pad(D_, 4.2, 0.04, 1400), 8.0)
for t in CUE['scout_clicks']: add(click(0.9), t, pan=0.1)
add(fm_bell(78, 0.7, 1.6), CUE['approve']); add(fm_bell(85, 0.5, 1.6), CUE['approve'] + 0.08)   # approved
# ---------------------------------------------------------------- 12–17 the connection
add(whoosh(1.4, 0.32, 250, 5000), CUE['lift'] - 0.2, pan=-0.2)
for k in range(5):                                            # rising synthetic tones
    s_ = 12.0 + k * 0.85
    add(pad((61 + 2 * k, 66 + 2 * k), 1.6, 0.03 + 0.008 * k, 1600 + 900 * k, 0.4), s_, pan=(-0.4, 0.4)[k % 2])
for i in range(int(4.0 / (BEAT / 2))):                       # pulses accelerate into the landing
    t = 12.0 + i * BEAT / 2
    if t < CUE['land'] - 0.35: add(pulse(0.4 + 0.12 * i / 10), t)
add(whoosh(0.9, 0.28, 800, 12000), CUE['flip'] - 0.45, pan=0.3); add(metal(0.35), CUE['flip'])
add(riser(2.0, 0.3), CUE['land'] - 2.2)
add(braam((42, 49, 54), 2.6, 1.0), CUE['land']); add(kick(1.4), CUE['land']); add(metal(0.9), CUE['land'])
# ---------------------------------------------------------------- 17–28 NEXT: drive
t0 = 17.0; nb = int(11.0 / BEAT)
OST = [42, 42, 54, 42, 45, 42, 52, 40]
for i in range(nb):
    t = t0 + i * BEAT
    add(kick(1.0), t)
    if i % 2 == 1: add(clap(1.0), t, pan=0.05)
    add(hat(0.7), t + BEAT / 2, pan=0.3); add(hat(0.35), t + BEAT / 4, pan=-0.3); add(hat(0.35), t + 3 * BEAT / 4, pan=-0.3)
    add(bass(OST[i % 8], BEAT * 0.45, 0.9), t + BEAT / 2)
    if i % 8 in (0, 3, 6): add(pluck(ARP[i % 6] + 12, 0.55, 3800), t, pan=-0.4 + 0.8 * ((i % 3) / 2))
add(pad(Fm, 5.6, 0.05, 1800), 17.0); add(pad(A_ + (64,), 5.6, 0.05, 1800), 22.6)
for t in CUE['next_taps']: add(click(1.0), t, pan=0.1)
add(bell(81, 0.55, 1.6), CUE['bought'], pan=0.1); add(bell(88, 0.4, 1.6), CUE['bought'] + 0.08, pan=-0.1)
for t in CUE['panels']: add(fm_bell(90, 0.3, 1.0), t, pan=0.3)
add(riser(1.0, 0.22), 27.0)
# ---------------------------------------------------------------- 28–34 restraint → the card
add(pad(D_, 6.2, 0.06, 900, 1.0), 28.0)
for k in range(6): add(pulse(0.45 + 0.04 * k), 28.3 + k * 0.95)
add(braam((38, 45, 50), 1.6, 0.55), CUE['card_hit']); add(metal(0.8), CUE['card_hit'])
for t, m in ((29.6, 73), (30.6, 76), (31.6, 78), (32.4, 81)): add(bell(m, 0.8), t, pan=0.15)
add(riser(1.6, 0.26), 32.4)
# ---------------------------------------------------------------- 34–40 finale
add(braam((42, 49, 54), 3.0, 1.05), 34.0); add(kick(1.3), 34.0)
for i in range(int(3.0 / BEAT)):
    t = 34.0 + i * BEAT; add(kick(0.9), t)
    if i % 2: add(clap(0.8), t)
    add(tom(70 + 8 * i, 0.5), t + BEAT / 2)
add(pad(E_ + (64,), 3.0, 0.06, 2200), 34.0)
add(riser(0.9, 0.3), CUE['logo'] - 0.9)
add(braam((42, 49, 54, 61), 3.0, 1.3), CUE['logo']); add(metal(1.1), CUE['logo']); add(kick(1.5), CUE['logo'])
add(pad(Fm + (66,), 3.0, 0.08, 2400, 0.6), CUE['logo'])
add(fm_bell(85, 0.6, 2.5), CUE['logo'] + 0.6)
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
