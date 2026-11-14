"""Original score + sound design for NEXT × SCOUT — "THE SIGNAL". D minor, 112.5 BPM (one beat =
16 frames at 30 fps, so every beat lands on a frame). Dark cinematic electronic: analog-style saws,
deep sub, tight percussion, a low string bed, a three-note sonic logo. Synthesized from scratch.

Writes two stems (music, sfx) so narration, music and effects stay separable:

  post-venv/bin/python music5.py OUT_DIR [--len 60] [--hook a|b|c]   -> OUT_DIR/music.wav, OUT_DIR/sfx.wav

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
    cross=F(61.5),            # the camera passes through the waveform plane (measured: y=15.0 at frame 61.4–61.6)
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

HOOK = sys.argv[sys.argv.index('--hook') + 1] if '--hook' in sys.argv else 'a'
def strings(notes, dur, level, bright=1800, attack=0.6):
    """A low string-like bed: many detuned saws through a soft filter, slow attack (cinematic layer)."""
    n = at(dur); t = T(n); x = np.zeros(n)
    for m in notes:
        for d in (-0.006, -0.002, 0.002, 0.006):
            x += signal.sawtooth(2 * np.pi * midi(m) * (1 + d) * t + rng.uniform(0, 6))
    x = signal.sosfilt(sos('lowpass', bright, 2), x / (4 * len(notes)))
    shape = np.minimum(1, t / attack) * np.minimum(1, (dur - t) / 0.8).clip(0)
    return x * shape * level
def ui_tick(level=1.0, f=2600):
    n = at(0.05); t = T(n)
    return (np.sin(2 * np.pi * f * t) + 0.3 * np.sin(2 * np.pi * f * 1.5 * t)) * np.exp(-t / 0.008) * 0.12 * level
def confirm(notes=(74, 81), level=1.0, gap=0.07):
    """A crisp two-note confirmation (not a casino sound): soft FM glass, a fifth apart."""
    out = np.zeros(at(1.2))
    for k, m in enumerate(notes):
        x = fm_bell(m, 1.0, 0.9, ratio=3.0, idx=1.0); s0 = at(k * gap); out[s0:s0 + len(x)] += x[:len(out) - s0]
    return out * level
def approve_sound(level=1.0):
    """SCOUT's approval: a rising cyan glass interval over a soft sub thump — distinctive, restrained."""
    out = np.zeros(at(1.6)); out[:at(0.9)] += pulse(0.5)[:at(0.9)]
    for k, m in enumerate((69, 76, 81)):
        x = fm_bell(m, 1.0, 1.3, ratio=4.0, idx=1.2); s0 = at(0.06 + k * 0.08); out[s0:s0 + len(x)] += x[:len(out) - s0] * 1.2
    return out * level
def warm_hit(level=1.0):
    """The profile lands on NEXT: a warm bass hit with a subtle metallic resonance."""
    a = boom(0.8); m_ = metal_hit(0.3, 150.0); n = max(len(a), len(m_)); out = np.zeros(n)
    out[:len(a)] += a; out[:len(m_)] += signal.sosfilt(sos('lowpass', 2500), m_)
    return out * level
def demo_track(dur, level=1.0):
    """The demo artist's preview: an original late-night R&B fragment (warm electric-piano chords, soft
    sub, a lazy snap) composed for this film — no licensed recording."""
    out = np.zeros(at(dur)); bt = 60 / 84.0
    chords = [(57, 60, 64, 67), (53, 57, 60, 64), (55, 59, 62, 65), (52, 55, 59, 62)]
    for i in range(int(dur / (2 * bt)) + 1):
        ch = chords[i % 4]; t0 = i * 2 * bt
        for m in ch:
            n = at(2 * bt); t = T(n)
            x = (np.sin(2 * np.pi * midi(m) * t) + 0.25 * np.sin(2 * np.pi * midi(m) * 2 * t) * np.exp(-t / 0.3)) * np.exp(-t / 1.2) * 0.05
            s0 = at(t0); out[s0:s0 + n] += x[:max(0, len(out) - s0)]
        sb = np.sin(2 * np.pi * midi(ch[0] - 24) * T(at(bt))) * env(at(bt), 0.01, 0.4) * 0.2; s0 = at(t0); out[s0:s0 + len(sb)] += sb[:max(0, len(out) - s0)]
        sn = clap(0.6); s1 = at(t0 + bt); out[s1:s1 + len(sn)] += sn[:max(0, len(out) - s1)]
    fade = np.minimum(1, T(len(out)) / 0.15) * np.minimum(1, (dur - T(len(out))) / 0.4).clip(0)
    return out * fade * level
def logo_motif(level=1.0):
    """The NEXT sonic logo: three notes (A4, D5, then a resolving F#5 that rings), glass over a warm saw."""
    out = np.zeros(at(2.2))
    for k, (m, d) in enumerate(((69, 0.0), (74, 0.16), (78, 0.36))):
        x = fm_bell(m, 1.0 if k < 2 else 1.4, 2.0 if k == 2 else 0.8, ratio=3.0, idx=1.1)
        n = at(1.6 if k == 2 else 0.5); t = T(n)
        w = signal.sosfilt(sos('lowpass', 2200), signal.sawtooth(2 * np.pi * midi(m - 12) * t)) * env(n, 0.005, 0.5 if k == 2 else 0.15) * 0.05
        s0 = at(d); out[s0:s0 + len(x)] += x[:len(out) - s0] * 1.3; out[s0:s0 + len(w)] += w[:len(out) - s0]
    return out * level
OST = [38, 38, 50, 38, 41, 38, 48, 36]                       # 16th-note bass ostinato (D minor)
ARP = [62, 65, 69, 74, 69, 65]
def bars(t0, t1):
    i = int(np.ceil((t0 - GRID0) / BEAT - 1e-6))
    while beat(i) < t1:
        yield i, beat(i); i += 1

# ---------------------------------------------------------------- 0–2.37 the hook (A, B or C)
if HOOK == 'a':
    sfx.add(sub_drop(1.0), 0.0); sfx.add(crack(0.9), 0.0); sfx.add(metal_hit(0.55, 180.0), 0.0, pan=-0.1)
    sfx.add(braam((38, 45, 50), 0.8, 0.42), 0.0)
    sfx.add(synth_pulse(1.0), 0.11, pan=0.15)
    for i in range(-1, 2):                                  # tight 8th-note pulse under the first line
        for h in range(2):
            t = beat(i) + h * BEAT / 2
            if t < 0.18: continue
            music.add(saw_bass(38, BEAT / 2 * 0.9, 0.7 if h == 0 else 0.45), t)
            music.add(tick(0.35), t + BEAT / 4, pan=0.25)
    music.add(pad((50, 53, 57), 1.6, 0.02, 900, 0.3), 0.0)
    sfx.add(glitter(0.75, 1.0), F(20))
    sfx.add(whoosh(0.7, 0.12, 400, 5000), F(20), pan=-0.3); sfx.add(whoosh(0.7, 0.12, 500, 6000), F(22), pan=0.3)
    sw = reverse_swell(0.6, 1.0); sfx.add(sw, CUE['lock'] - len(sw) / SR)
    sfx.add(boom(1.0), CUE['lock']); sfx.add(metal_hit(0.35, 240.0), CUE['lock'], pan=0.1)
    music.add(pad((38, 50, 57), 1.3, 0.035, 500, 0.02), CUE['lock'])
    music.add(pulse(0.35), beat(3))
    sfx.add(whoosh(0.55, 0.32, 250, 7000), CUE['cross'] - 0.32)      # its loudness peaks 0.32 s in (measured, A-weighted): on the crossing
elif HOOK == 'b':                                           # tight on SCOUT's queue: a scan, two candidates light up
    sfx.add(sub_drop(0.8), 0.0); sfx.add(metal_hit(0.45, 260.0), 0.0, pan=-0.2)
    sfx.add(scan(1.4, 0.07, 900, 2400), F(4), pan=-0.2)
    for f in (18, 30): sfx.add(ui_tick(1.2, 2900), F(f), pan=-0.25)
    for i in range(0, 4): music.add(pulse(0.45), beat(i))
    music.add(pad((50, 57, 62), 2.4, 0.03, 1200, 0.3), 0.0)
    sfx.add(whoosh(0.9, 0.3, 250, 6500), F(58))               # the fast pull back
else:                                                       # two worlds split by a wall of light
    c, w = dual_chime(1.1); sfx.add(c, 0.0, pan=-0.6); sfx.add(w, 0.0, pan=0.6)
    sfx.add(sub_drop(0.9), 0.0); sfx.add(crack(0.5), 0.0)
    c, w = dual_chime(0.9); sfx.add(c, F(42), pan=-0.6); sfx.add(w, F(42), pan=0.6)
    sfx.add(reverse_swell(0.5, 0.8), F(36) - 0.5 + 0.5); sfx.add(boom(0.6), F(42))
    for i in range(0, 4): music.add(pulse(0.4), beat(i))
    music.add(pad((50, 57, 62), 2.4, 0.03, 1200, 0.3), 0.0)
    sfx.add(whoosh(0.8, 0.28, 250, 6500), F(60))
if HOOK == 'a':
    c, w = dual_chime(0.9); sfx.add(c, CUE['worlds'] + 0.1, pan=-0.45); sfx.add(w, CUE['worlds'] + 0.12, pan=0.45)
music.add(riser(0.45, 0.12), CUE['drive'] - 0.45)

# ---------------------------------------------------------------- 2.37–3.0 the drive starts (the two worlds)
for i, t in bars(CUE['drive'], F(91)):
    music.add(kick(0.85), t); music.add(hat(0.8), t + BEAT / 2, pan=0.2)
    for s_ in range(4):
        music.add(saw_bass(OST[(i * 4 + s_) % 8], BEAT / 4 * 0.9, 0.8 if s_ == 0 else 0.55, cut=650), t + s_ * BEAT / 4)
        music.add(arp_note(ARP[(i * 4 + s_) % 6] + 12, 0.8), t + s_ * BEAT / 4, pan=-0.3 + 0.2 * s_)

# ---------------------------------------------------------------- 3–17 SCOUT: precise, cooler, restrained
for i, t in bars(F(91), F(511)):
    if i % 2 == 0: music.add(kick(0.55), t)
    if i % 4 == 2: music.add(rim(0.8), t, pan=0.15)
    for s_ in range(4): music.add(tick(0.28 if s_ % 2 else 0.4), t + s_ * BEAT / 4, pan=0.3)
    music.add(saw_bass(38 if (i // 4) % 2 == 0 else 34, BEAT * 0.9, 0.45, cut=380), t)
    music.add(pluck([74, 77, 81, 86][i % 4], 0.5, 3600), t + BEAT / 2, pan=-0.35)
for k, (t0, ch) in enumerate(((F(91), (50, 57, 62)), (F(91) + 8 * BEAT, (46, 53, 62)), (F(91) + 16 * BEAT, (48, 55, 60)))):
    music.add(pad(ch, 8 * BEAT + 0.5, 0.035, 1400, 1.0), t0)
sfx.add(whoosh(1.0, 0.16, 300, 4000), F(112), pan=-0.4)       # the identity tile flies in
sfx.add(scan(1.6, 0.04, 1500, 2600), F(130), pan=-0.2)
sfx.add(confirm((81, 86), 0.8), F(186), pan=-0.1)            # it lands in the queue
sfx.add(ui_tick(0.9), F(262), pan=0.2)                       # hover on Approve
sfx.add(ui_tick(1.4, 3200), F(298)); sfx.add(approve_sound(1.0), F(299))
for f in (360, 365, 370, 375, 405, 410, 415, 420): sfx.add(ui_tick(0.55, 2400), F(f), pan=-0.15 if f < 400 else 0.15)
sfx.add(confirm((76, 81), 0.7), F(372), pan=-0.2); sfx.add(confirm((78, 83), 0.7), F(418), pan=0.2)
sfx.add(confirm((74, 81, 86), 0.9), F(446))                  # 86.0

# ---------------------------------------------------------------- 17–22 THE TRANSFER: a riser; cyan turns orange
sfx.add(whoosh(0.8, 0.3, 300, 6000), F(516)); sfx.add(metal_hit(0.25, 300.0), F(518), pan=-0.2)
music.add(riser(F(631) - F(520), 0.22), F(520))
music.add(strings((50, 57, 62), F(631) - F(511), 0.06, 1200, 1.5), F(511))
music.add(strings((54, 57, 62), 2.2, 0.05, 2200, 1.2), F(570))       # the harmony brightens (D minor -> D major) as cyan turns orange
for i, t in bars(F(511), F(631)):
    music.add(pulse(0.3 + 0.4 * (t - F(511)) / (F(631) - F(511))), t)
    for s_ in range(2): music.add(saw_bass(38, BEAT / 2 * 0.8, 0.35, cut=300 + 900 * (t - F(511)) / 4.0), t + s_ * BEAT / 2)
sfx.add(whoosh(0.6, 0.18, 800, 9000), F(580)); sfx.add(fm_bell(93, 0.5, 0.8), F(589), pan=0.3)      # the flip glints
sfx.add(warm_hit(1.0), F(631))

# ---------------------------------------------------------------- 22–40 NEXT: full rhythm, deeper bass, arps
for i, t in bars(F(631), F(1201)):
    music.add(kick(0.95), t); music.add(hat(0.85), t + BEAT / 2, pan=0.2)
    if i % 2 == 1: music.add(clap(0.6), t)
    for s_ in range(4):
        music.add(saw_bass(OST[(i * 4 + s_) % 8], BEAT / 4 * 0.9, 0.85 if s_ == 0 else 0.6, cut=720), t + s_ * BEAT / 4)
        music.add(arp_note(ARP[(i * 4 + s_) % 6] + 12, 0.75, 3600), t + s_ * BEAT / 4, pan=-0.3 + 0.2 * s_)
for k in range(4):
    music.add(strings([(50, 57, 62), (46, 53, 62), (48, 55, 60), (45, 52, 61)][k % 4], 8 * BEAT, 0.035, 2200, 0.8), F(631) + k * 8 * BEAT)
for f in (690, 718, 744, 784, 842, 940, 962): sfx.add(ui_tick(0.8, 2700), F(f), pan=0.1)
sfx.add(demo_track(F(838) - F(786), 0.75), F(786), pan=0.0)          # the preview: an original demo fragment
sfx.add(confirm((74, 78), 0.6), F(842))                                 # Watching
sfx.add(ui_tick(1.0, 3000), F(984)); sfx.add(confirm((74, 81), 1.0, 0.06), F(988))   # the purchase
sfx.add(boom(0.75), F(992)); sfx.add(braam((38, 45, 50), 1.4, 0.4), F(992)); sfx.add(whoosh(1.0, 0.2, 200, 5000), F(990))   # the chart grows out
for k in range(14): sfx.add(fm_bell(81 + (k % 4) * 2, 0.22, 0.4, ratio=3.0, idx=0.8), F(996 + int(k * 72 / 13)), pan=-0.2 + 0.03 * k)
sfx.add(whoosh(0.7, 0.18, 300, 5000), F(1108))
for f in (1140, 1160): sfx.add(ui_tick(0.8, 2700), F(f))
sfx.add(ui_tick(1.0, 3000), F(1178)); sfx.add(confirm((78, 74), 0.8, 0.06), F(1182))   # the sale (falling interval)

# ---------------------------------------------------------------- 40–47 portfolio & community: rhythm kept, simplified
for i, t in bars(F(1201), F(1405)):
    music.add(kick(0.8), t); music.add(hat(0.6), t + BEAT / 2, pan=0.2)
    music.add(saw_bass(OST[(i * 4) % 8], BEAT * 0.45, 0.7, cut=600), t); music.add(saw_bass(38, BEAT * 0.4, 0.45, cut=600), t + BEAT / 2)
    if i % 2 == 1: music.add(clap(0.45), t)
music.add(strings((50, 57, 62, 66), F(1405) - F(1201), 0.04, 2000, 1.0), F(1201))
for f in (1222, 1228, 1234): sfx.add(whoosh(0.5, 0.1, 500, 6000), F(f), pan={1222: -0.4, 1228: 0.4, 1234: 0.0}[f])
for f in (1236, 1288, 1346): sfx.add(ui_tick(0.6, 2500), F(f))

# ---------------------------------------------------------------- 47–53 restraint, then the card
music.add(strings((38, 50, 57), F(1440) - F(1400) + 0.3, 0.05, 600, 0.8), F(1400))
music.add(riser(F(1440) - F(1405), 0.12), F(1405))
sfx.add(sub_drop(0.7, 70, 30, 2.0), F(1440)); sfx.add(warm_hit(0.9), F(1440)); sfx.add(metal_hit(0.35, 330.0), F(1440), pan=0.15)
sfx.add(glitter(0.6, 0.7, 200), F(1440))
for k, ch in enumerate(((50, 57, 62, 66), (47, 54, 59, 62), (52, 59, 64, 68), (54, 57, 62, 69))):   # a triumphant phrase: D – Bm – E – D/F#
    music.add(strings(ch, 4 * BEAT + 0.4, 0.07, 2600, 0.5), F(1440) + k * 4 * BEAT)
    music.add(pad(ch, 4 * BEAT + 0.4, 0.04, 3000, 0.4), F(1440) + k * 4 * BEAT)
for i, t in bars(F(1460), F(1595)):
    music.add(pulse(0.4), t)
    if i % 2 == 0: music.add(kick(0.5), t)

# ---------------------------------------------------------------- 53–60 one system: both themes, the logo, a clean end
for i, t in bars(F(1600), F(1676)):
    music.add(kick(0.75), t); music.add(hat(0.6), t + BEAT / 2, pan=0.2)
    music.add(pluck([74, 77, 81, 86][i % 4], 0.55, 3600), t + BEAT / 2, pan=-0.35)                # SCOUT's cool pluck
    music.add(arp_note(ARP[i % 6] + 12, 0.6, 3600), t + BEAT / 4, pan=0.35)                       # NEXT's arp
    music.add(saw_bass(38, BEAT * 0.9, 0.6, cut=600), t)
music.add(strings((50, 57, 62, 66), F(1680) - F(1600), 0.06, 2400, 1.0), F(1600))
music.add(riser(F(1680) - F(1640), 0.18), F(1640))
sfx.add(boom(1.0), F(1680)); sfx.add(metal_hit(0.4, 220.0), F(1680)); sfx.add(braam((38, 45, 50, 54), 2.4, 0.7), F(1680))
music.add(strings((38, 50, 57, 62, 66), 3.4, 0.085, 2600, 0.15), F(1680))          # the rich final chord (D major)
music.add(pad((62, 66, 69, 74), 3.4, 0.05, 3200, 0.2), F(1680))
sfx.add(logo_motif(1.0), 58.05)                                                   # after "Find what's next."
END_T = 59.95
for bus in (music, sfx):                                                          # end cleanly: a short tail, then silence
    e0 = at(END_T - 0.5); e1 = at(END_T)
    for ch in (bus.L, bus.R):
        ch[e0:e1] *= np.linspace(1, 0, e1 - e0) ** 2; ch[e1:] = 0

# ---------------------------------------------------------------- write the stems
def finish(bus, name):
    x = bus.stereo()[:at(LEN)]
    wavfile.write(os.path.join(OUT, name), SR, np.clip(x, -1, 1).astype(np.float32))
os.makedirs(OUT, exist_ok=True)
finish(music, 'music.wav'); finish(sfx, 'sfx.wav')
print('stems written', LEN, 's')
