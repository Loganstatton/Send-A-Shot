"""Synth voices for "THE SIGNAL" score and sound design: the dual ad's voices (../dual/music4.py,
copied, unchanged there) plus new ones. Everything is synthesized from scratch — no samples,
loops or borrowed melodies, nothing to license.
"""
import numpy as np
from scipy import signal

SR = 48000
rng = np.random.default_rng(4417)
def at(s): return int(round(s * SR))
def midi(n): return 440.0 * 2 ** ((n - 69) / 12)
def sos(kind, f, order=2): return signal.butter(order, f, btype=kind, fs=SR, output='sos')
class Bus:
    """A stereo stem. add(x, start_seconds, gain, pan -1..1)."""
    def __init__(self, seconds): self.N = int(SR * seconds); self.L = np.zeros(self.N); self.R = np.zeros(self.N)
    def add(self, x, start, gain=1.0, pan=0.0):
        s0 = at(start)
        if s0 >= self.N or s0 < 0: return
        x = x[:self.N - s0]; gl, gr = np.cos((pan + 1) * np.pi / 4) * 1.414, np.sin((pan + 1) * np.pi / 4) * 1.414
        self.L[s0:s0 + len(x)] += x * gain * gl; self.R[s0:s0 + len(x)] += x * gain * gr
    def stereo(self): return np.stack([self.L, self.R], 1)
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

