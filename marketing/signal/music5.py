"""Original score + sound design for NEXT × SCOUT — "THE SIGNAL". D minor, 112.5 BPM (one beat =
16 frames at 30 fps, so every beat lands on a frame). Dark cinematic electronic: analog-style saws,
deep sub, tight percussion, a low string bed, a three-note sonic logo. Synthesized from scratch.

Writes two stems (music, sfx) so narration, music and effects stay separable:

  post-venv/bin/python music5.py OUT_DIR [--len 60]      -> OUT_DIR/music.wav, OUT_DIR/sfx.wav

Sections (seconds), picture-locked through CUE:
  0–1.3    the hook: bass impact + metallic accent + a sharp synthetic pulse; tight 8th-note sub
           pulse under "This isn't a stock."; a reverse swell into
  1.3      the waveform locks: clean impact, then the music drops back for "It's an artist."
  2.37     the drive starts (kick, 16th bass, hats, arp) as SCOUT and NEXT appear
"""
import os, sys
import numpy as np
from scipy import signal
from scipy.io import wavfile
from synth5 import *

OUT = sys.argv[1]
LEN = float(sys.argv[sys.argv.index('--len') + 1]) if '--len' in sys.argv else 60.0
BPM = 112.5; BEAT = 60.0 / BPM                    # 0.5333 s = 16 frames
GRID0 = 7 / 30                                    # beat 1 = frame 8
def beat(i): return GRID0 + i * BEAT               # the picture's beat grid (frames 8, 24, 40, 56, 72, ...)
F = lambda f: (f - 1) / 30.0                       # film frame -> seconds

CUE = dict(
    open=0.0,                 # frame 1: the first impact
    lock=F(40),               # the waveform locks
    cross=F(62),              # the camera passes through the waveform
    worlds=F(52),             # SCOUT and NEXT light up (seen through the opening)
    drive=beat(4),            # frame 72: the drive starts
)
music, sfx = Bus(LEN + 3), Bus(LEN + 3)

# ---------------------------------------------------------------- new voices
def sub_drop(level=1.0, f0=90, f1=34, dur=1.4):
    n = at(dur); t = T(n)
    return np.sin(2 * np.pi * np.cumsum(f1 + (f0 - f1) * np.exp(-t / 0.07)) / SR) * env(n, 0.002, dur * 0.35) * level
def crack(level=1.0):
    n = at(0.25); t = T(n)
    return np.tanh(signal.sosfilt(sos('bandpass', [900, 7000]), rng.standard_normal(n)) * 3) * np.exp(-t / 0.025) * 0.35 * level
def metal_hit(level=1.0, base=180.0):
    """A distorted metallic accent: inharmonic partials, struck, slightly driven."""
    n = at(1.6); t = T(n)
    x = sum(a * np.sin(2 * np.pi * base * r * t + rng.uniform(0, 6)) * np.exp(-t / d)
            for r, a, d in ((1.0, 1.0, 0.7), (2.76, 0.7, 0.45), (5.40, 0.45, 0.3), (8.93, 0.3, 0.2), (13.3, 0.2, 0.12)))
    return np.tanh(x * 1.8) * 0.22 * np.minimum(1, t / 0.0008) * level
def synth_pulse(level=1.0):
    """The sharp synthetic pulse right after the first impact: two fast square blips (D6, A6)."""
    out = np.zeros(at(0.2))
    for k, m in enumerate((86, 93)):
        n = at(0.07); t = T(n); x = signal.square(2 * np.pi * midi(m) * t, 0.3) * np.exp(-t / 0.02)
        s0 = at(k * 0.055); out[s0:s0 + n] += signal.sosfilt(sos('lowpass', 6000), x)[:len(out) - s0]
    return out * 0.12 * level
def reverse_swell(dur, level=1.0):
    """A reversed, filtered noise-and-tone tail: it sucks in toward the next impact."""
    n = at(dur); t = T(n)
    x = signal.sosfilt(sos('bandpass', [300, 9000]), rng.standard_normal(n)) * 0.5
    x += np.sin(2 * np.pi * midi(62) * t) * 0.3 + np.sin(2 * np.pi * midi(69) * t) * 0.2
    x *= np.exp(-t / (dur * 0.35))
    return x[::-1] * level * 0.5
def boom(level=1.0):
    """The clean, dramatic lock impact: sub + low body + a short bright transient + tail."""
    n = at(2.4); t = T(n)
    sub = np.sin(2 * np.pi * np.cumsum(38 + 60 * np.exp(-t / 0.05)) / SR) * env(n, 0.002, 0.7)
    body = np.sin(2 * np.pi * np.cumsum(72 + 50 * np.exp(-t / 0.03)) / SR) * env(n, 0.001, 0.18) * 0.6
    tr = signal.sosfilt(sos('highpass', 3000), rng.standard_normal(n)) * np.exp(-t / 0.004) * 0.35
    tail = signal.sosfilt(sos('lowpass', 900), rng.standard_normal(n)) * env(n, 0.01, 0.6) * 0.08
    return np.tanh((sub + body + tr + tail) * 1.6) * 0.7 * level
def glitter(dur, level=1.0, count=420):
    """Thousands of particles: a fine cloud of tiny high ticks, denser in the middle."""
    n = at(dur); out = np.zeros(n)
    for _ in range(count):
        p = rng.beta(2, 2); s0 = int(p * (n - at(0.02))); m = 90 + rng.integers(0, 14)
        k = at(0.012); t = T(k)
        out[s0:s0 + k] += np.sin(2 * np.pi * midi(m) * t) * np.exp(-t / 0.003) * rng.uniform(0.3, 1.0)
    return out * 0.05 * level
def saw_bass(m, dur, level=1.0, cut=520):
    n = at(dur); t = T(n)
    x = signal.sawtooth(2 * np.pi * midi(m) * t) * 0.8 + signal.sawtooth(2 * np.pi * midi(m) * 1.004 * t) * 0.5
    x = signal.sosfilt(sos('lowpass', cut, 4), x) + np.sin(2 * np.pi * midi(m - 12) * t) * 0.7
    return np.tanh(x * 1.6) * env(n, 0.002, dur * 0.5) * 0.24 * level
def arp_note(m, level=1.0, bright=3200):
    n = at(0.32); t = T(n)
    x = signal.sawtooth(2 * np.pi * midi(m) * t) * 0.5 + signal.square(2 * np.pi * midi(m) * 0.998 * t) * 0.3
    return signal.sosfilt(sos('lowpass', bright, 4), x) * env(n, 0.002, 0.07) * 0.1 * level
def dual_chime(level=1.0):
    """SCOUT and NEXT appear: a cool, glassy FM tone (left) and a warm saw stab (right), a fifth apart."""
    cyan = fm_bell(81, 1.0, 1.6, ratio=4.0, idx=1.4)
    n = at(1.2); t = T(n)
    warm = signal.sosfilt(sos('lowpass', 2400), sum(signal.sawtooth(2 * np.pi * midi(m) * (1 + d) * t) for m in (62, 69) for d in (-0.004, 0.004)))
    warm = warm * env(n, 0.006, 0.35) * 0.05
    return cyan * level, warm * level

# ---------------------------------------------------------------- 0–1.3 the hook
sfx.add(sub_drop(1.0), 0.0); sfx.add(crack(0.9), 0.0); sfx.add(metal_hit(0.8), 0.0, pan=-0.1)
sfx.add(braam((38, 45, 50), 1.0, 0.55), 0.0)
sfx.add(synth_pulse(1.0), 0.11, pan=0.15)
for i in range(-1, 2):                                      # tight 8th-note pulse under the first line
    for h in range(2):
        t = beat(i) + h * BEAT / 2
        if t < 0.18: continue
        music.add(saw_bass(38, BEAT / 2 * 0.9, 0.7 if h == 0 else 0.45), t)
        music.add(tick(0.35), t + BEAT / 4, pan=0.25)
music.add(pad((50, 53, 57), 1.6, 0.02, 900, 0.3), 0.0)
sfx.add(glitter(0.75, 1.0), F(20))                          # the particles stream with the transformation
sfx.add(whoosh(0.7, 0.12, 400, 5000), F(20), pan=-0.3); sfx.add(whoosh(0.7, 0.12, 500, 6000), F(22), pan=0.3)
sw = reverse_swell(0.6, 1.0); sfx.add(sw, CUE['lock'] - len(sw) / SR)

# ---------------------------------------------------------------- 1.3 lock, then space for "It's an artist."
sfx.add(boom(1.0), CUE['lock']); sfx.add(metal_hit(0.35, 240.0), CUE['lock'], pan=0.1)
music.add(pad((38, 50, 57), 1.3, 0.035, 500, 0.02), CUE['lock'])
music.add(pulse(0.35), beat(3))                            # the waveform's beat pulse (frame 56), felt not heard

# ---------------------------------------------------------------- through the waveform; the two worlds; the drive
sfx.add(whoosh(0.55, 0.32, 250, 7000), CUE['cross'] - 0.33)
c, w = dual_chime(0.9); sfx.add(c, CUE['worlds'] + 0.1, pan=-0.45); sfx.add(w, CUE['worlds'] + 0.12, pan=0.45)
music.add(riser(0.45, 0.12), CUE['drive'] - 0.45)
OST = [38, 38, 50, 38, 41, 38, 48, 36]                       # 16th-note bass ostinato (D minor)
ARP = [62, 65, 69, 74, 69, 65]
for i in range(4, 4 + int((LEN - CUE['drive']) / BEAT) + 1):
    t = beat(i)
    if t >= LEN: break
    music.add(kick(0.85), t)
    music.add(hat(0.8), t + BEAT / 2, pan=0.2)
    for s in range(4):
        music.add(saw_bass(OST[(i * 4 + s) % len(OST)], BEAT / 4 * 0.9, 0.8 if s == 0 else 0.55, cut=650), t + s * BEAT / 4)
        music.add(arp_note(ARP[(i * 4 + s) % len(ARP)] + 12, 0.8), t + s * BEAT / 4, pan=-0.3 + 0.2 * s)
    if i % 2 == 1: music.add(clap(0.55), t)

# ---------------------------------------------------------------- write the stems
def finish(bus, name):
    x = bus.stereo()[:at(LEN)]
    wavfile.write(os.path.join(OUT, name), SR, np.clip(x, -1, 1).astype(np.float32))
os.makedirs(OUT, exist_ok=True)
finish(music, 'music.wav'); finish(sfx, 'sfx.wav')
print('stems written', LEN, 's')
