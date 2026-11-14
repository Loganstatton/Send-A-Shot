"""Original score for NEXT Ad #2 — dark, confident trap / cinematic hip-hop. 120 BPM,
C minor (Ad #1 was 100 BPM industrial in F minor). Synthesized from scratch: no
samples, loops or borrowed melodies, so it is ours to use in ads.

v2 (rescored): no bells or chimes. The melody is a low, gritty detuned-saw lead with a
slight glide over a dark string pad; the hats are tight filtered noise (no metallic
jingle); the accents are low brass-like stabs. Same hit points as before.

At 120 BPM a beat is 0.5 s = 15 frames; every scene boundary sits on a beat:
  0.0 hook (opening accent) · 2.0 PROVE IT (drop) · 4.0 discover · 7.0 trade
  11.0 track · 14.0 darkness · 15.0 BACKER #1 (metallic hit) · 18.0 logo · 20.0 CTA

  post-venv/bin/python music2.py out.wav [seconds]
"""
import sys
import numpy as np
from scipy import signal
from scipy.io import wavfile

SR = 48000
LEN = float(sys.argv[2]) if len(sys.argv) > 2 else 22.0
BPM = 120.0; BEAT = 60 / BPM; S16 = BEAT / 4
N = int(SR * (LEN + 2.0))
rng = np.random.default_rng(7)
L = np.zeros(N); R = np.zeros(N); duck = np.ones(N)
HOOK, DROP, DISC, TRADE, TRACK, DARK, HIT, LOGO, CTA = 0.0, 2.0, 4.0, 7.0, 11.0, 14.0, 15.0, 18.0, 20.0

def at(s): return int(round(s * SR))
def midi(n): return 440.0 * 2 ** ((n - 69) / 12)
def sos(kind, f, order=2): return signal.butter(order, f, btype=kind, fs=SR, output='sos')
def add(x, start, gain=1.0, pan=0.0):
    s0 = at(start)
    if s0 >= N or s0 < 0: return
    x = x[:N - s0]; gl, gr = np.cos((pan + 1) * np.pi / 4) * 1.414, np.sin((pan + 1) * np.pi / 4) * 1.414
    L[s0:s0 + len(x)] += x * gain * gl; R[s0:s0 + len(x)] += x * gain * gr
def env(n, a=0.002, d=0.2):
    t = np.arange(n) / SR; return np.minimum(1, t / a) * np.exp(-t / d)

def kick(level=1.0):
    n = at(0.5); t = np.arange(n) / SR
    f = 46 + 160 * np.exp(-t / 0.03)
    body = np.sin(2 * np.pi * np.cumsum(f) / SR) * np.exp(-t / 0.18)
    click = signal.sosfilt(sos('highpass', 2500), rng.standard_normal(n)) * np.exp(-t / 0.003) * 0.35
    return np.tanh((body + click) * 2.0 * level) * 0.85

def bass808(note, dur, glide_to=None, level=1.0):
    """808: sine sub with a slow decay, a little drive for phone speakers; optional glide."""
    n = at(dur); t = np.arange(n) / SR
    f0 = midi(note); f1 = midi(glide_to) if glide_to else f0
    f = f0 + (f1 - f0) * np.clip((t - dur * 0.45) / (dur * 0.35), 0, 1)
    x = np.sin(2 * np.pi * np.cumsum(f) / SR)
    x = np.tanh(x * 2.4) * 0.75 + 0.25 * np.sin(2 * np.pi * np.cumsum(f * 2) / SR) * 0.3
    return x * np.minimum(1, t / 0.004) * np.exp(-t / (dur * 1.8)) * 0.55 * level

def clap(level=1.0):
    n = at(0.35); t = np.arange(n) / SR
    x = signal.sosfilt(sos('bandpass', [1000, 5200]), rng.standard_normal(n))
    e = sum(np.exp(-np.clip(t - d, 0, None) / 0.006) * (t >= d) for d in (0, 0.009, 0.019)) * 0.55 + np.exp(-t / 0.16) * 0.5
    return x * e * 0.55 * level

def hat(open_=False, level=1.0):
    """Tight, dark trap hat: band-limited noise only (no tuned partials, so nothing jingles)."""
    n = at(0.16 if open_ else 0.04); t = np.arange(n) / SR
    x = signal.sosfilt(sos('bandpass', [6500, 11000], 3), rng.standard_normal(n))
    return x * np.exp(-t / (0.045 if open_ else 0.009)) * 0.16 * level

def lead(note, dur, glide_from=None, level=1.0):
    """The melodic voice: a low, gritty detuned-saw lead (two voices + sub octave) through a
    resonant low-pass that opens a little on each note; optional glide in from the previous note."""
    n = at(dur); t = np.arange(n) / SR
    f1 = midi(note); f0 = midi(glide_from) if glide_from else f1
    f = f1 + (f0 - f1) * np.exp(-t / 0.045)
    x = sum(signal.sawtooth(2 * np.pi * np.cumsum(f * (1 + d)) / SR) for d in (-0.006, 0.006)) / 2
    x += 0.5 * np.sin(2 * np.pi * np.cumsum(f / 2) / SR)
    out = np.zeros(n); zi = None
    cut = 900 + 1900 * np.exp(-t / 0.12)
    for i in range(0, n, 256):
        s_ = signal.butter(2, float(cut[i]), btype='lowpass', fs=SR, output='sos')
        seg, zi = signal.sosfilt(s_, x[i:i + 256], zi=zi if zi is not None else signal.sosfilt_zi(s_) * x[i])
        out[i:i + 256] = seg
    shape = np.minimum(1, t / 0.008) * np.minimum(1, (dur - t) / 0.03).clip(0) * (0.75 + 0.25 * np.exp(-t / 0.2))
    return np.tanh(out * 2.2) * shape * 0.34 * level

def strings(notes, dur, level=1.0, bright=1400):
    """Dark string pad: many slightly detuned saws, slow swell, low-passed — cinematic weight, no shimmer."""
    n = at(dur); t = np.arange(n) / SR; x = np.zeros(n)
    for nn in notes:
        for d in (-0.008, -0.003, 0.003, 0.008):
            x += signal.sawtooth(2 * np.pi * midi(nn) * (1 + d) * t + rng.uniform(0, 6))
    x = signal.sosfilt(sos('lowpass', bright), x / (4 * len(notes)))
    return x * np.minimum(1, t / 0.6) * np.minimum(1, (dur - t) / 0.5).clip(0) * 0.55 * level

def stab(notes, dur=0.8, level=1.0, cutoff=2200):
    n = at(dur); t = np.arange(n) / SR; x = np.zeros(n)
    for nn in notes:
        for det in (-0.01, 0.0, 0.01):
            x += signal.sawtooth(2 * np.pi * midi(nn) * (1 + det) * t)
    x = signal.sosfilt(sos('lowpass', cutoff), x / (3 * len(notes)))
    return np.tanh(x * 2.2) * env(n, 0.004, dur * 0.4) * 0.32 * level

def noise_rise(dur, level=0.2):
    n = at(dur); t = np.arange(n) / SR; x = rng.standard_normal(n); out = np.zeros(n)
    for i in range(0, n, 1200):
        c = 300 + 9000 * (i / n) ** 2; out[i:i + 1200] = signal.sosfilt(sos('bandpass', [c * 0.6, min(c * 1.4, 20000)]), x[i:i + 1200])
    return out * (t / dur) ** 2.5 * level

def metal_hit(level=1.0):
    """Inharmonic struck-metal partials + a sub — the Backer #1 hit."""
    n = at(2.5); t = np.arange(n) / SR
    parts = [(180, 1.0, 1.2), (419, 0.6, 0.9), (731, 0.45, 0.7), (1093, 0.3, 0.5), (1587, 0.22, 0.35), (2311, 0.15, 0.25)]
    x = sum(a * np.sin(2 * np.pi * f * t + rng.uniform(0, 6)) * np.exp(-t / d) for f, a, d in parts)
    sub = np.sin(2 * np.pi * np.cumsum(30 + 70 * np.exp(-t / 0.08)) / SR) * np.exp(-t / 0.6)
    return (x * 0.22 + sub * 0.7) * np.minimum(1, t / 0.001) * level

# ---------------------------------------------------------------- arrangement
C2, Eb2, F2, G1, Ab1, Bb1 = 36, 39, 41, 31, 32, 34
BASS_BAR = [(0.0, C2, 0.7, None), (0.75, C2, 0.5, None), (1.5, C2, 0.9, G1), (2.5, Ab1, 0.6, None), (3.25, Bb1, 0.6, None)]
BASS_BAR2 = [(0.0, C2, 0.7, None), (0.75, C2, 0.5, None), (1.5, Eb2, 0.9, None), (2.5, F2, 0.5, None), (3.0, G1, 0.9, C2)]
LEAD = [(0.0, 60, 1.4, None), (1.5, 63, 0.45, 60), (2.0, 62, 0.9, None), (3.0, 58, 0.9, 62)]       # my own, C minor
LEAD2 = [(0.0, 60, 1.4, None), (1.5, 67, 0.45, 60), (2.0, 65, 0.45, None), (2.5, 63, 1.3, 65)]
def section(t):
    if t < DROP: return 'hook'
    if t < DARK: return 'groove'
    if t < HIT: return 'dark'
    if t < LOGO: return 'hero'
    return 'end'
def duck_at(t, depth=0.7, length=0.22):
    s0 = at(t); n = min(at(length), N - s0)
    if n > 0: duck[s0:s0 + n] = np.minimum(duck[s0:s0 + n], 1 - depth * np.exp(-np.arange(n) / SR / 0.07))

bars = int(LEN / (4 * BEAT)) + 1
for b in range(bars):
    t_bar = b * 4 * BEAT
    sec = section(t_bar)
    energy = 0.0 if sec in ('dark',) else 0.55 if sec == 'hook' else 1.0 if sec in ('groove', 'hero') else 0.7
    if t_bar >= LEN: break
    # drums
    for k in range(16):
        t0 = t_bar + k * S16
        if t0 >= LEN or section(t0) == 'dark': continue
        s = section(t0)
        if k in (0, 6, 10) and s != 'hook':
            add(kick(1.05 if k == 0 else 0.9), t0, 0.95); duck_at(t0)
        if k in (4, 12) and s != 'hook':
            add(clap(1.0), t0, 0.8, pan=0.05)
        lvl = 0.5 if s == 'hook' else 1.0 if t0 >= TRADE and s == 'groove' else 0.8
        add(hat(open_=(k % 8 == 6 and s != 'hook'), level=lvl), t0, 1.0, pan=0.3 if k % 2 else -0.25)
        if s == 'groove' and t0 >= TRADE and k in (14, 15) and b % 2 == 1:         # 32nd-note hat rolls
            for r in range(2): add(hat(level=0.6), t0 + r * S16 / 2, 1.0, pan=0.4)
    # 808
    if sec != 'dark':
        for off, note, dur, gl in (BASS_BAR if b % 2 == 0 else BASS_BAR2):
            t0 = t_bar + off * BEAT
            if t0 < LEN and section(t0) != 'dark':
                lv = 0.35 if section(t0) == 'hook' else 1.0
                add(bass808(note, dur * BEAT * 1.6, gl, lv), t0, 1.0)
    # the lead (from the drop on; an octave up for the trade, where the energy lifts)
    if sec in ('groove', 'hero', 'end'):
        for off, note, dur, gl in (LEAD if b % 2 == 0 else LEAD2):
            t0 = t_bar + off * BEAT
            if t0 < LEN and section(t0) != 'dark':
                up = 7 if (TRADE <= t0 < TRACK and section(t0) == 'groove') else 0     # lifted for the trade only
                lv = 0.7 if TRACK <= t0 < DARK else 0.9                                  # leaves room for 'Track your picks'
                add(lead(note + up, dur * BEAT, (gl + up) if gl else None, lv), t0, 1.0, pan=-0.1 if b % 2 else 0.1)
    # dark strings under the groove
    if sec in ('groove', 'hero', 'end') and t_bar + 4 * BEAT <= LEN + 2 * BEAT:
        chord = ((48, 55, 63), (44, 51, 60), (46, 53, 62), (43, 50, 59))[b % 4]
        add(strings(chord, 4 * BEAT + 0.4, 0.8 if t_bar >= TRADE else 0.6), t_bar, 1.0)

# accents
add(stab([48, 51, 55, 58, 62], 1.2, 1.1, 6000), HOOK, 1.0)                     # the opening accent (Cm9)
add(kick(1.3), HOOK, 1.0)
add(noise_rise(1.0, 0.22), DROP - 1.0)
add(kick(1.4), DROP, 1.1); add(stab([48, 51, 55, 60], 0.9, 1.15, 5500), DROP, 1.0)
if LEN > 4.2:
    add(stab([44, 48, 51, 55], 0.7, 0.8, 4000), DISC, 0.9)
    add(stab([46, 50, 53, 58], 0.7, 0.85, 4800), TRADE, 1.0)
    add(stab([44, 48, 51, 56], 0.7, 0.8, 4800), TRACK, 0.9)
    add(noise_rise(1.0, 0.3), HIT - 1.0)
    add(metal_hit(1.0), HIT, 1.0); add(kick(1.4), HIT, 1.0); add(stab([48, 51, 55, 58, 62, 67], 1.6, 1.2, 7000), HIT, 1.0)
    add(stab([44, 48, 51, 55, 60], 1.4, 0.9, 5000), LOGO, 1.0)
    add(kick(1.3), CTA, 1.0); add(stab([48, 51, 55, 60, 63], 2.0, 1.1, 6000), CTA, 1.0)
# dark pad: under the hook, swelling in the darkness before the card
t = np.arange(N) / SR
pad = sum(np.sin(2 * np.pi * midi(m) * t + 0.5 * np.sin(2 * np.pi * 0.15 * t)) for m in (48, 51, 55, 58)) / 4
pe = 0.04 + 0.1 * np.clip((t - DARK) / 1.0, 0, 1) * (t < HIT) + 0.05 * (t >= LOGO)
add(signal.sosfilt(sos('lowpass', 1300), pad) * pe, 0.0)

mix = np.stack([L * duck, R * duck], axis=1)
ir_n = at(0.8); ir = rng.standard_normal(ir_n) * np.exp(-np.arange(ir_n) / SR / 0.22)
ir = signal.sosfilt(sos('lowpass', 6000), ir); ir /= np.abs(ir).sum() / 4
mix[:, 0] += 0.1 * signal.fftconvolve(mix[:, 0], ir)[:N]; mix[:, 1] += 0.1 * signal.fftconvolve(mix[:, 1], np.roll(ir, 177))[:N]
mix = np.tanh(mix * 1.15) / np.tanh(1.15)
mix = mix[:at(LEN)]
mix *= 10 ** (-4.0 / 20) / np.abs(mix).max()
f_ = at(0.04 if LEN <= 4.5 else 0.5); mix[-f_:] *= np.linspace(1, 0, f_)[:, None]
wavfile.write(sys.argv[1], SR, (mix * 32767).astype(np.int16))
print('wrote', sys.argv[1], f'{LEN}s @ {BPM:.0f} BPM')
