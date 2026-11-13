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
# Section markers (seconds), all on the beat grid (v2, 24 s). A 3 s render stops after the opener.
#   3.0 the buy · 8.4 the chart (peak) · 13.8 darkness, riser · 15.0 THE HIT (card) · 19.2 logo · 21.6 JOIN NEXT
S2, PEAK, RISE, HIT, LOGO, CTA = 3.0, 8.4, 13.8, 15.0, 19.2, 21.6
def section(t):
    if t < DROP: return 'intro'
    if t < PEAK: return 'groove'
    if t < RISE: return 'peak'
    if t < HIT: return 'rise'
    if t < LOGO: return 'peak'
    if t < CTA: return 'break'
    return 'outro'

def snare(level=1.0):
    n = at(0.18); t = np.arange(n) / SR
    body = np.sin(2 * np.pi * 190 * t) * np.exp(-t / 0.05) * 0.5
    x = signal.sosfilt(sos('bandpass', [1500, 9000]), rng.standard_normal(n)) * np.exp(-t / 0.07)
    return np.tanh((body + x) * 1.6) * 0.45 * level

ARP = [65, 68, 72, 75, 77, 75, 72, 68]   # F minor arpeggio (my own pattern)
def arp_note(note, dur, bright):
    n = at(dur); t = np.arange(n) / SR; f = midi(note)
    x = signal.sawtooth(2 * np.pi * f * t) + 0.5 * signal.square(2 * np.pi * f * 2 * t, 0.3)
    x = signal.sosfilt(sos('lowpass', bright), x)
    return np.tanh(x * 1.5) * np.exp(-t / (dur * 0.7)) * 0.13

steps = int(LEN / S16) + 2
for k in range(steps):
    t0 = k * S16
    if t0 >= LEN: break
    sec = section(t0)
    beat_pos = k % 4
    bar_beat = (k // 4) % 4
    drums = sec in ('intro', 'groove', 'peak')
    if beat_pos == 0 and drums:
        add(kick(1.15 if t0 in (0.0,) or abs(t0 - DROP) < 1e-6 or abs(t0 - PEAK) < 1e-6 else 1.0), t0, 1.0)
        dn = at(0.25); s0 = at(t0)
        if s0 < N: duck[s0:s0 + dn] = np.minimum(duck[s0:s0 + dn], 1 - 0.75 * np.exp(-np.arange(min(dn, N - s0)) / SR / 0.08))
    if abs(t0 - (DROP - S16)) < 1e-6:
        add(kick(0.8), t0, 0.7)
    if sec in ('groove', 'peak') and bar_beat in (1, 3) and beat_pos == 0:
        add(clap(), t0, 0.9 if sec == 'groove' else 1.0, pan=0.05)
    if drums:
        acc = 1.0 if beat_pos == 2 else 0.55
        add(hat(open_=(beat_pos == 2 and sec != 'intro'), accent=acc * (0.6 if sec == 'intro' else 1.0 if sec == 'groove' else 1.15)), t0, 1.0,
            pan=0.35 if k % 2 else -0.25)
    # snare rolls into the peak and into the logo
    for roll_end, span in ((PEAK, 0.6), (HIT, 1.2), (LOGO, 0.6)):
        if roll_end - span <= t0 < roll_end - 1e-6:
            add(snare(0.3 + 0.9 * (t0 - (roll_end - span)) / span), t0, 1.0, pan=-0.1)
    note = RIFF[k % len(RIFF)]
    if sec == 'intro':
        add(bass_note(note, S16 * 0.92, 250 + 500 * min(1, t0 / DROP) ** 2, drive=2.0), t0, 0.5)
    elif sec in ('groove', 'peak'):
        add(bass_note(note, S16 * 0.92, 2600 if sec == 'groove' else 3400, drive=3.5 if sec == 'groove' else 4.2), t0, 1.1)
    elif sec == 'break' and k % 8 == 0:
        add(bass_note(F1, BEAT * 2, 400, drive=1.6), t0, 0.8)
    if sec == 'rise' and k % 4 == 0:
        add(bass_note(F1, BEAT, 300 + 900 * (t0 - RISE) / (HIT - RISE), drive=1.8), t0, 0.7)
    if sec == 'peak':
        prog = (t0 - PEAK) / (RISE - PEAK) if t0 < RISE else (t0 - HIT) / (LOGO - HIT)
        add(arp_note(ARP[k % len(ARP)], S16 * 0.9, 2200 + 2000 * min(1, prog)), t0, 1.0 if t0 < RISE else 1.1, pan=-0.5 + 1.0 * ((k % 8) / 7))
    if sec == 'break' and k % 2 == 0:
        add(arp_note(ARP[(k // 2) % len(ARP)] + 12, S16 * 1.8, 1500), t0, 0.45, pan=0.6 * np.sin(k))

# impacts: first frame, drop, slam, the cuts, the logo and the call to action
add(stab([41, 44, 48, 53], 1.1, 4200), 0.0, 1.0)               # Fm, wide
add(crash(0.9), 0.0); add(crash(1.0), DROP)
add(stab([41, 44, 48, 53, 56], 1.4, 6000), DROP, 1.1)
add(stab([37, 41, 44, 49], 0.9, 3800), DROP + BEAT, 0.9)        # Db on the slam
if LEN > 3.5:
    add(stab([41, 44, 48, 53], 0.8, 5000), S2, 0.8); add(crash(0.6), S2)
    add(stab([41, 44, 48, 53, 56, 60], 1.6, 7000), PEAK, 1.15); add(crash(1.1), PEAK)
    add(crash(0.5), 10.8); add(crash(0.45), 12.0)                  # portfolio, leaderboard
    add(kick(1.45), HIT, 1.2); add(crash(1.3), HIT)                 # THE HIT: the card lands
    add(stab([41, 44, 48, 53, 56, 60, 65], 2.2, 7600), HIT, 1.25)
    add(kick(1.3), LOGO, 1.1); add(crash(1.2), LOGO)
    add(stab([37, 41, 44, 48, 53], 2.4, 5200), LOGO, 1.1)       # Dbmaj7-ish lift into the logo
    add(kick(1.3), CTA, 1.1); add(crash(1.0), CTA)
    add(stab([41, 44, 48, 53, 56], 2.8, 6000), CTA, 1.15)

# dark pad underneath everything, swelling in the breakdown
n = N; t = np.arange(n) / SR
pad = sum(np.sin(2 * np.pi * midi(m) * t + np.sin(2 * np.pi * 0.2 * t) * 0.6) for m in (53, 56, 60, 65)) / 4
pad_env = np.ones(n) * 0.05
if LEN > 3.5:
    pad_env += 0.10 * np.clip((t - LOGO) / 0.8, 0, 1) * (t < LEN)
    pad_env += 0.12 * np.clip((t - RISE) / (HIT - RISE), 0, 1) * (t < HIT)   # swell in the dark before the card
add(signal.sosfilt(sos('lowpass', 1400), pad) * pad_env, 0.0)

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
fade = at(0.04 if LEN <= 3.5 else 0.6); mix[-fade:] *= np.linspace(1, 0, fade)[:, None]
wavfile.write(sys.argv[1], SR, (mix * 32767).astype(np.int16))
print('wrote', sys.argv[1], f'{LEN}s @ {BPM:.0f} BPM, drop at {DROP}s')
