"""Original score and sound design for THE MOVE: dark cinematic electronic, D minor, 120 BPM. One beat
is 15 frames at 30 fps, one bar 60 frames, so every beat and bar lands exactly on a frame. Synthesized
from scratch: no samples, no licensed recordings.

  post-venv/bin/python music_move.py OUT_DIR [--len 25] [--hook a|b|c] [--journey J.json]   -> OUT_DIR/music.wav, OUT_DIR/sfx.wav

Picture-locked cues (film frames; frame 1 = 0.000 s):
  1      hook A: the counter is already climbing. Sub drop, crack, braam and a metallic hit.
  1–46   the counter rolls: one tick per change of the displayed figure, pitch rising with the value,
         computed from the same curve the picture uses (move_hook.py)
  46     the counter locks on +$1,432 (beat 4): a clean, dramatic impact and a minor-add9 stab
  91     3.0 s, the discovery rhythm: kick, offbeat hats, a 16th-note bass ostinato and a plucked arp
  241    8.0 s, the trade: the build starts (snare, rising filter, risers)
  481    16.0 s, the reveal: one substantial hit after a quarter-second of silence
  601    20.0 s, the visuals collapse into the logo: a reverse swell, then NEXT's sonic logo
"""
import json, os, sys
import numpy as np
from scipy import signal
from scipy.io import wavfile
HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(HERE, '..', 'signal'))
from synth5 import *                     # the shared synth primitives (unchanged)

OUT = sys.argv[1]
def arg(n, d=None): return sys.argv[sys.argv.index(n) + 1] if n in sys.argv else d
LEN = float(arg('--len', '25')); HOOK = arg('--hook', 'a')
J = json.load(open(arg('--journey', os.path.join(HERE, 'journey.json'))))
BPM = 120.0; BEAT = 0.5
F = lambda f: (f - 1) / 30.0
def beat(i): return i * BEAT                      # beat 0 = frame 1
CUE = dict(lock=F(46), drive=F(91), trade=F(241), reveal=F(481), logo=F(601))
music, sfx = Bus(LEN + 3), Bus(LEN + 3)
rng = np.random.default_rng(11)

# ---------------------------------------------------------------- voices (this film's own copies)
def sub_drop(level=1.0, f0=90, f1=34, dur=1.4):
    n = at(dur); t = T(n)
    return np.sin(2 * np.pi * np.cumsum(f1 + (f0 - f1) * np.exp(-t / 0.07)) / SR) * env(n, 0.002, dur * 0.35) * level
def crack(level=1.0):
    n = at(0.25); t = T(n)
    return np.tanh(signal.sosfilt(sos('bandpass', [900, 7000]), rng.standard_normal(n)) * 3) * np.exp(-t / 0.025) * 0.35 * level
def metal_hit(level=1.0, base=180.0):
    n = at(1.6); t = T(n)
    x = sum(a * np.sin(2 * np.pi * base * r * t + rng.uniform(0, 6)) * np.exp(-t / d)
            for r, a, d in ((1.0, 1.0, 0.7), (2.76, 0.7, 0.45), (5.40, 0.45, 0.3), (8.93, 0.3, 0.2), (13.3, 0.2, 0.12)))
    return np.tanh(x * 1.8) * 0.22 * np.minimum(1, t / 0.0008) * level
def reverse_swell(dur, level=1.0):
    n = at(dur); t = T(n)
    x = signal.sosfilt(sos('bandpass', [300, 9000]), rng.standard_normal(n)) * 0.5
    x += np.sin(2 * np.pi * midi(62) * t) * 0.3 + np.sin(2 * np.pi * midi(69) * t) * 0.2
    x *= np.exp(-t / (dur * 0.35))
    return x[::-1] * level * 0.5
def boom(level=1.0):
    n = at(2.4); t = T(n)
    sub = np.sin(2 * np.pi * np.cumsum(38 + 60 * np.exp(-t / 0.05)) / SR) * env(n, 0.002, 0.7)
    body = np.sin(2 * np.pi * np.cumsum(72 + 50 * np.exp(-t / 0.03)) / SR) * env(n, 0.001, 0.18) * 0.6
    tr = signal.sosfilt(sos('highpass', 3000), rng.standard_normal(n)) * np.exp(-t / 0.004) * 0.35
    tail = signal.sosfilt(sos('lowpass', 900), rng.standard_normal(n)) * env(n, 0.01, 0.6) * 0.08
    return np.tanh((sub + body + tr + tail) * 1.6) * 0.7 * level
def saw_bass(m, dur, level=1.0, cut=520):
    n = at(dur); t = T(n)
    x = signal.sawtooth(2 * np.pi * midi(m) * t) * 0.8 + signal.sawtooth(2 * np.pi * midi(m) * 1.004 * t) * 0.5
    x = signal.sosfilt(sos('lowpass', cut, 4), x) + np.sin(2 * np.pi * midi(m - 12) * t) * 0.7
    return np.tanh(x * 1.6) * env(n, 0.002, dur * 0.5) * 0.24 * level
def arp_note(m, level=1.0, bright=3200):
    n = at(0.32); t = T(n)
    x = signal.sawtooth(2 * np.pi * midi(m) * t) * 0.5 + signal.square(2 * np.pi * midi(m) * 0.998 * t) * 0.3
    return signal.sosfilt(sos('lowpass', bright, 4), x) * env(n, 0.002, 0.07) * 0.1 * level
def stab(notes, level=1.0, dur=1.6, bright=3800):
    """A wide, polished synth chord stab: detuned saws, fast attack, filtered tail."""
    n = at(dur); t = T(n); x = np.zeros(n)
    for m in notes:
        for d in (-0.007, -0.0025, 0.0025, 0.007): x += signal.sawtooth(2 * np.pi * midi(m) * (1 + d) * t + rng.uniform(0, 6))
    x = signal.sosfilt(sos('lowpass', bright, 2), x / (4 * len(notes)))
    return x * env(n, 0.003, dur * 0.3) * 0.32 * level
def strings(notes, dur, level, bright=1800, attack=0.6):
    n = at(dur); t = T(n); x = np.zeros(n)
    for m in notes:
        for d in (-0.006, -0.002, 0.002, 0.006): x += signal.sawtooth(2 * np.pi * midi(m) * (1 + d) * t + rng.uniform(0, 6))
    x = signal.sosfilt(sos('lowpass', bright, 2), x / (4 * len(notes)))
    return x * np.minimum(1, t / attack) * np.minimum(1, (dur - t) / 0.8).clip(0) * level
def roll_tick(f_hz, level=1.0):
    """One digit of the counter: a short, glassy mechanical tick."""
    n = at(0.03); t = T(n)
    x = (np.sin(2 * np.pi * f_hz * t) + 0.35 * np.sin(2 * np.pi * f_hz * 2.71 * t)) * np.exp(-t / 0.006)
    return x * 0.09 * level
def confirm(notes=(74, 81), level=1.0, gap=0.07):
    out = np.zeros(at(1.2))
    for k, m in enumerate(notes):
        x = fm_bell(m, 1.0, 0.9, ratio=3.0, idx=1.0); s0 = at(k * gap); out[s0:s0 + len(x)] += x[:len(out) - s0]
    return out * level
def logo_motif(level=1.0):
    """NEXT's sonic logo (as in THE SIGNAL): A4, D5, then a resolving F#5 that rings, glass over a warm saw."""
    out = np.zeros(at(3.0))
    for k, (m, d) in enumerate(((69, 0.0), (74, 0.16), (78, 0.32))):
        g = fm_bell(m, 1.0, 2.4 if k == 2 else 1.0, ratio=4.0, idx=1.3)
        n = at(1.4 if k == 2 else 0.5); t = T(n)
        w = signal.sosfilt(sos('lowpass', 2600), signal.sawtooth(2 * np.pi * midi(m - 12) * t) + signal.sawtooth(2 * np.pi * midi(m - 12) * 1.004 * t))
        w = w * env(n, 0.004, 0.25 if k < 2 else 0.6) * 0.05
        s0 = at(d); out[s0:s0 + len(g)] += g[:len(out) - s0] * (1.25 if k == 2 else 1.0); out[s0:s0 + n] += w[:len(out) - s0]
    return out * level

# ---------------------------------------------------------------- the counter's curve (as move_hook.py)
SERIES = J['series'][:-1]; PICK = J['plan']['pick']; SHARES = J['hero_buy']['shares']; N = len(SERIES)
def exit_pnl(p):
    notional = round(SHARES * p); post = max(100, round(p * (1 - notional / 1_000_000 * 0.05)))
    return round(SHARES * max(100, round((p + post) / 2))) - PICK
PNL = [exit_pnl(p) for p in SERIES]
LOCK, I0 = 46, 1.35
def head_index(f):
    t = min(max((f - 1) / (LOCK - 1), 0.0), 1.0); return I0 + (N - 1 - I0) * (1 - (1 - t) ** 2.6)
def shown(f):
    idx = head_index(f); k = min(int(idx), N - 2); fr = idx - k
    return int(round((PNL[k] + (PNL[k + 1] - PNL[k]) * fr) / 100))

# ---------------------------------------------------------------- 0–3 s: the hook
if HOOK == 'a':
    sfx.add(sub_drop(1.0), 0.0); sfx.add(crack(0.9), 0.0); sfx.add(metal_hit(0.5, 170.0), 0.0, pan=-0.1)
    sfx.add(braam((38, 45, 50), 0.9, 0.45), 0.0)
    # the roll: for each frame, as many ticks as the displayed figure moved (capped), spread across the frame
    prev = shown(1)
    for f in range(2, LOCK + 1):
        v = shown(f); d = abs(v - prev); prev = v
        if d == 0: continue
        n = int(min(4, 1 + d // 18))
        for j in range(n):
            t = F(f) - (1 / 30) * (1 - (j + 1) / n)
            pitch = 1400 + 1500 * min(1.0, v / 1432)
            sfx.add(roll_tick(pitch * rng.uniform(0.97, 1.03), 0.55 + 0.45 * min(1.0, d / 60)), t, pan=rng.uniform(-0.25, 0.25))
    sw = reverse_swell(0.7, 1.0); sfx.add(sw, CUE['lock'] - len(sw) / SR)
    sfx.add(boom(1.05), CUE['lock']); sfx.add(metal_hit(0.38, 240.0), CUE['lock'], pan=0.1)
    music.add(stab((50, 53, 57, 64), 1.0, 1.8), CUE['lock'])                 # D minor add9
    music.add(strings((38, 50, 57), 1.6, 0.05, 900, 0.05), CUE['lock'])
    for i in range(3, 6):                                                  # 8th-note sub pulse after the lock, toward the drive
        for h in range(2):
            t = beat(i) + h * BEAT / 2
            if t >= CUE['lock'] + 0.15: music.add(saw_bass(38, BEAT / 2 * 0.9, 0.6 if h == 0 else 0.4), t)
    music.add(riser(0.5, 0.12), CUE['drive'] - 0.5)
elif HOOK == 'b':                                                          # the phone first: a clean UI hit
    sfx.add(sub_drop(0.85), 0.0); sfx.add(metal_hit(0.4, 240.0), 0.0)
    sfx.add(confirm((74, 81), 0.9), F(40))
    for i in range(0, 6): music.add(pulse(0.45), beat(i))
    music.add(strings((50, 57, 62), 2.8, 0.035, 1200, 0.3), 0.0); music.add(riser(0.6, 0.12), CUE['drive'] - 0.6)
else:                                                                      # the chart erupts from the floor
    sfx.add(sub_drop(1.0), 0.0); sfx.add(crack(0.7), 0.0); sfx.add(braam((38, 45, 50), 1.2, 0.5), 0.0)
    sfx.add(whoosh(0.9, 0.3, 200, 6000), F(10)); sfx.add(boom(0.8), F(46))
    for i in range(0, 6): music.add(pulse(0.4), beat(i))
    music.add(riser(0.6, 0.12), CUE['drive'] - 0.6)

# ---------------------------------------------------------------- 3–8 s: discovery, a confident rhythm
OST = [38, 38, 50, 38, 41, 38, 45, 43]                     # D minor ostinato (16ths)
ARP = [62, 65, 69, 74, 69, 65, 62, 57]
def bars(t0, t1):
    i = 0; t = t0
    while t < t1 - 1e-6: yield i, t; i += 1; t += BEAT
for i, t in bars(CUE['drive'], CUE['trade']):
    music.add(kick(0.85), t); music.add(hat(0.7), t + BEAT / 2, pan=0.2)
    for s_ in range(4): music.add(saw_bass(OST[(i * 4 + s_) % 8], BEAT / 4 * 0.9, 0.75 if s_ == 0 else 0.5, cut=600), t + s_ * BEAT / 4)
    for s_ in range(2): music.add(arp_note(ARP[(i * 2 + s_) % 8] + 12, 0.8, 3000), t + s_ * BEAT / 2, pan=-0.3 + 0.6 * s_)
music.add(strings((50, 57, 62), CUE['trade'] - CUE['drive'], 0.03, 1400, 1.0), CUE['drive'])

# ---------------------------------------------------------------- 8–15.75 s: the trade, the market moves, the sale: building
BUILD_END = CUE['reveal'] - 0.25
for i, t in bars(CUE['trade'], BUILD_END):
    p = (t - CUE['trade']) / (BUILD_END - CUE['trade'])               # 0 → 1 across the build
    music.add(kick(0.9), t)
    if i % 2: music.add(snare(0.55 + 0.3 * p), t, pan=0.05)
    music.add(hat(0.6 + 0.3 * p), t + BEAT / 2, pan=0.2); music.add(hat(0.35 + 0.3 * p), t + BEAT / 4, pan=-0.2)
    for s_ in range(4): music.add(saw_bass(OST[(i * 4 + s_) % 8] + (5 if i // 8 % 2 else 0), BEAT / 4 * 0.9, 0.8 if s_ == 0 else 0.55, cut=600 + 1800 * p), t + s_ * BEAT / 4)
    for s_ in range(4): music.add(arp_note(ARP[(i * 4 + s_) % 8] + 12, 0.7 + 0.4 * p, 2600 + 3000 * p), t + s_ * BEAT / 4, pan=-0.35 + 0.23 * s_)
music.add(strings((50, 57, 62, 65), BUILD_END - CUE['trade'], 0.04, 1600, 2.5), CUE['trade'])
music.add(riser(3.0, 0.22), BUILD_END - 3.0)

# ---------------------------------------------------------------- 16 s: the reveal: one substantial, polished hit
sfx.add(boom(1.25), CUE['reveal']); sfx.add(sub_drop(1.0, 70, 30, 2.2), CUE['reveal']); sfx.add(metal_hit(0.45, 150.0), CUE['reveal'], pan=-0.1)
sfx.add(braam((38, 45, 50, 57), 2.8, 0.55), CUE['reveal'])
music.add(stab((50, 53, 57, 62, 64), 1.25, 2.6, 4500), CUE['reveal'])
music.add(strings((38, 50, 57, 62, 65), CUE['logo'] - CUE['reveal'] + 0.4, 0.06, 1500, 0.08), CUE['reveal'])
for i, t in bars(CUE['reveal'] + 2 * BEAT, CUE['logo'] - 0.4):                   # the groove returns, softer, under the glass
    music.add(kick(0.55), t); music.add(hat(0.4), t + BEAT / 2, pan=0.2)
    music.add(saw_bass(OST[i % 8], BEAT * 0.45, 0.45, cut=500), t)

# ---------------------------------------------------------------- 20–25 s: the collapse into the logo, the identity
sw = reverse_swell(1.0, 0.9); sfx.add(sw, CUE['logo'] - len(sw) / SR)
sfx.add(boom(0.75), CUE['logo']); sfx.add(logo_motif(1.0), CUE['logo'] + 0.55)
music.add(strings((50, 57, 62, 66), LEN - CUE['logo'], 0.04, 1300, 0.4), CUE['logo'])
music.add(pulse(0.4), CUE['logo'] + 2.0)

# ---------------------------------------------------------------- write
os.makedirs(OUT, exist_ok=True)
for nm, bus in (('music', music), ('sfx', sfx)):
    x = bus.stereo()[:at(LEN)].copy()
    e = at(0.6); x[-e:] *= np.linspace(1, 0, e)[:, None] ** 2
    wavfile.write(os.path.join(OUT, f'{nm}.wav'), SR, x.astype(np.float32))
print('music', OUT)
