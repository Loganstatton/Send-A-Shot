"""Original sound design for the NEXT opener, synthesized from scratch
(no samples, no licensing). Timed to the picture at 30 fps:
  f37 = 1.200 s shatter, f56 = 1.833 s "ISN'T FAMOUS YET." slam,
  chart line draws f48–f80 (1.57–2.63 s).
  post-venv/bin/python audio.py out.wav [length_seconds]
"""
import sys
import numpy as np
from scipy import signal

SR = 48000
LEN = float(sys.argv[2]) if len(sys.argv) > 2 else 3.0
N = int(SR * LEN)
rng = np.random.default_rng(11)
t = np.arange(N) / SR
L = np.zeros(N); R = np.zeros(N)

def at(sec): return int(sec * SR)
def env_exp(n, decay): return np.exp(-np.arange(n) / (decay * SR))
def bp(x, lo, hi, order=4):
    sos = signal.butter(order, [lo, hi], btype='band', fs=SR, output='sos'); return signal.sosfilt(sos, x)
def lp(x, f, order=4):
    sos = signal.butter(order, f, btype='low', fs=SR, output='sos'); return signal.sosfilt(sos, x)
def hp(x, f, order=4):
    sos = signal.butter(order, f, btype='high', fs=SR, output='sos'); return signal.sosfilt(sos, x)
def add(sig, start, gain=1.0, pan=0.0):
    s0 = at(start); n = min(len(sig), N - s0)
    if n <= 0: return
    gl, gr = np.cos((pan + 1) * np.pi / 4), np.sin((pan + 1) * np.pi / 4)
    L[s0:s0 + n] += sig[:n] * gain * gl * 1.414; R[s0:s0 + n] += sig[:n] * gain * gr * 1.414

SHATTER, SLAM = 36 / 30, 54 / 30   # 1.2 s and 1.8 s: beats 3 and 4 at 100 BPM

# 1) Drone: sub + warm saw pad that swells into the break.
n = at(SHATTER)
tt = np.arange(n) / SR
swell = np.clip(tt / SHATTER, 0, 1) ** 1.6
sub = np.sin(2 * np.pi * 43 * tt) * (0.05 + 0.16 * swell)
saw = signal.sawtooth(2 * np.pi * 86 * tt) + 0.6 * signal.sawtooth(2 * np.pi * 86.6 * tt)
pad = np.zeros(n)
for i in range(0, n, 2400):   # filter opens as it swells (block-wise sweep)
    pad[i:i + 2400] = lp(saw[max(0, i - 2400):i + 2400], 260 + 1600 * swell[i] ** 2, order=2)[-len(saw[i:i + 2400]):]
pad *= 0.07 * (0.3 + swell)
pass  # drone replaced by the score (music.py)

# 2) Vinyl spin: band noise pulsing at the rotation rate, plus crackle.
noise = rng.standard_normal(n)
spin = bp(noise, 900, 4200) * (0.5 + 0.5 * np.sin(2 * np.pi * 0.96 * tt)) ** 2 * 0.05 * (0.4 + swell)
add(spin, 0.0, 1.0, pan=-0.2); add(np.roll(spin, 900), 0.0, 1.0, pan=0.2)
crackle = np.zeros(n)
for k in rng.choice(n - 400, 70, replace=False):
    crackle[k:k + 60] += rng.standard_normal(60) * env_exp(60, 0.0004)
add(hp(crackle, 2500) * 0.25, 0.0, 1.0)

# 3) Letter ticks for "THE NEXT SUPERSTAR…" (f6–f22).
for i in range(0):
    tick = np.sin(2 * np.pi * 3400 * np.arange(500) / SR) * env_exp(500, 0.0012)
    add(tick * 0.05, (6 + i * 0.9) / 30, pan=-0.6 + 1.2 * i / 17)

# 4) Riser + electrical sizzle as the cracks glow (0.75 s → shatter).
r0 = 0.72; rn = at(SHATTER - r0); rt = np.arange(rn) / SR; rp = rt / (SHATTER - r0)
riser = bp(rng.standard_normal(rn), 400, 9000) * rp ** 2.2 * 0.22
sweep = np.sin(2 * np.pi * np.cumsum(220 + 900 * rp ** 2) / SR) * rp ** 3 * 0.10
sizzle = hp(rng.standard_normal(rn) * (rng.random(rn) < 0.02 + 0.2 * rp ** 2), 3000) * rp ** 2 * 0.18
add(riser + sweep + sizzle, r0)

# 5) SHATTER: sub boom, transient, glass.
bn = at(1.6); bt = np.arange(bn) / SR
boom = np.sin(2 * np.pi * np.cumsum(28 + 60 * np.exp(-bt / 0.08)) / SR) * env_exp(bn, 0.55) * 0.95
click = hp(rng.standard_normal(at(0.03)), 1200) * env_exp(at(0.03), 0.006) * 0.9
add(boom, SHATTER); add(click, SHATTER)
glass = hp(rng.standard_normal(at(0.9)), 4000) * env_exp(at(0.9), 0.12) * 0.28
add(glass, SHATTER, pan=-0.35); add(np.roll(glass, 300), SHATTER, pan=0.35)
for _ in range(120):
    f = rng.uniform(2200, 9500); d = rng.uniform(0.02, 0.18); m = at(d * 3)
    ping = np.sin(2 * np.pi * f * np.arange(m) / SR) * env_exp(m, d)
    add(ping * rng.uniform(0.02, 0.07), SHATTER + rng.exponential(0.12), pan=rng.uniform(-0.9, 0.9))

# 6) Particle swirl: whoosh sweeping, plus sparkle grains.
wn = at(1.3); wt = np.arange(wn) / SR
cutoff = 600 + 5000 * np.exp(-((wt - 0.35) / 0.3) ** 2)
wh = rng.standard_normal(wn)
whoosh = np.zeros(wn)
for i in range(0, wn, 2400):   # block-wise moving band
    c = cutoff[i]; seg = wh[i:i + 2400]
    whoosh[i:i + 2400] = bp(seg, c * 0.6, min(c * 1.4, 20000), order=2)
whoosh *= np.sin(np.pi * np.clip(wt / 1.3, 0, 1)) * 0.10
add(whoosh, SHATTER + 0.05, pan=-0.4); add(np.roll(whoosh, 2000), SHATTER + 0.05, pan=0.4)
for _ in range(160):
    f = rng.uniform(3000, 10000); m = at(0.05)
    g = np.sin(2 * np.pi * f * np.arange(m) / SR) * np.hanning(m)
    add(g * rng.uniform(0.008, 0.03), rng.uniform(SHATTER + 0.1, 2.9), pan=rng.uniform(-1, 1))

# 7) Chart drawing: ascending "data" blips on a pentatonic scale (A minor).
notes = [65, 68, 70, 72, 75, 77, 80, 82, 84, 87, 89, 92]
for i, nn in enumerate(notes):
    f = 440 * 2 ** ((nn - 69) / 12); m = at(0.22)
    tone = (np.sin(2 * np.pi * f * np.arange(m) / SR) + 0.3 * np.sin(2 * np.pi * 2 * f * np.arange(m) / SR)) * env_exp(m, 0.07)
    add(tone * 0.05, 48 / 30 + i * (32 / 30) / len(notes), pan=-0.5 + i / len(notes))

# 8) SLAM on "ISN'T FAMOUS YET." — deep hit + snap.
hn = at(1.2); ht = np.arange(hn) / SR
hit = np.sin(2 * np.pi * np.cumsum(46 + 90 * np.exp(-ht / 0.05)) / SR) * env_exp(hn, 0.35) * 0.9
thump = lp(rng.standard_normal(hn), 180) * env_exp(hn, 0.07) * 0.8
snap = hp(rng.standard_normal(at(0.06)), 2500) * env_exp(at(0.06), 0.012) * 0.5
add(hit + thump, SLAM); add(snap, SLAM)
# sustained low chord after the slam to carry into the next scene
cn = N - at(SLAM); ct = np.arange(cn) / SR
chord = sum(np.sin(2 * np.pi * (440 * 2 ** ((m - 69) / 12)) * ct) for m in (41, 48, 53, 56)) / 4
chord = lp(chord, 900) * np.clip(ct / 0.4, 0, 1) * 0.12
add(chord, SLAM)

# ---------------------------------------------------------------- scenes 2–4 (only for the full-length mix)
def g(frame): return (frame - 1) / 30.0           # global frame -> seconds
def whoosh(dur=0.5, lo=300, hi=6000, level=0.12):
    n = at(dur); tt = np.arange(n) / SR
    x = rng.standard_normal(n); out = np.zeros(n)
    for i in range(0, n, 1200):
        c = lo + (hi - lo) * np.sin(np.pi * min(1, i / n)) ** 2
        out[i:i + 1200] = bp(x[i:i + 1200], max(60, c * 0.5), min(c * 1.5, 20000), order=2)
    return out * np.sin(np.pi * tt / dur) ** 1.5 * level
def click(level=0.25):
    n = at(0.04); tt = np.arange(n) / SR
    return (np.sin(2 * np.pi * 2300 * tt) * 0.6 + hp(rng.standard_normal(n), 3000) * 0.4) * env_exp(n, 0.006) * level
def chime(notes, step=0.07, level=0.09):
    out = np.zeros(at(1.6))
    for i, nn in enumerate(notes):
        f = 440 * 2 ** ((nn - 69) / 12); m = at(1.2); tt = np.arange(m) / SR
        tone = (np.sin(2 * np.pi * f * tt) + 0.4 * np.sin(2 * np.pi * 2.01 * f * tt) + 0.15 * np.sin(2 * np.pi * 3.02 * f * tt)) * env_exp(m, 0.35)
        s0 = at(i * step); out[s0:s0 + m] += tone[:len(out) - s0]
    return out * level
def impact(level=0.8, f0=50):
    n = at(1.2); tt = np.arange(n) / SR
    return (np.sin(2 * np.pi * np.cumsum(f0 * 0.6 + f0 * 1.8 * np.exp(-tt / 0.06)) / SR) * env_exp(n, 0.4) + lp(rng.standard_normal(n), 200) * env_exp(n, 0.06) * 0.6) * level
def reverse_swell(dur, level=0.18):
    n = at(dur); tt = np.arange(n) / SR
    x = bp(rng.standard_normal(n), 500, 9000) * (tt / dur) ** 3
    return x * level

if LEN > 3.5:
    # scene 2 — phone in, taps, listen, backed
    add(whoosh(0.7, 200, 5000, 0.16), g(91) - 0.1, pan=0.3)
    for fr in (91 + 79, 91 + 136, 91 + 152):            # the three taps on real buttons
        add(click(0.3), g(fr))
    add(chime([77, 80, 84, 89], 0.09, 0.05), g(91 + 91), pan=-0.2)       # listen shimmer
    add(chime([68, 72, 75, 80, 84], 0.06, 0.08), g(91 + 156), pan=0.2)  # backed: bright Ab arpeggio
    add(whoosh(0.4, 600, 9000, 0.08), g(91 + 121))                       # slide up
    # scene 3 — cut in, chart flythrough tags, phone, leaderboard swipe, card spin + landing
    add(whoosh(0.6, 200, 7000, 0.16), g(271) - 0.15)
    for k, fr in enumerate((271 + 40, 271 + 46, 271 + 52)):
        add(chime([84 + 3 * k], 0.0, 0.035), g(fr), pan=-0.4 + 0.4 * k)
    add(whoosh(0.4, 300, 6000, 0.1), g(271 + 72) - 0.1)
    add(whoosh(0.35, 800, 9000, 0.08), g(271 + 108))
    for k in range(6):                                                   # card spinning in
        add(whoosh(0.18, 1500, 9000, 0.05 + 0.01 * k), g(271 + 144) + k * 0.12, pan=(-1) ** k * 0.5)
    add(impact(0.45, 70), g(271 + 170)); add(chime([77, 81, 84, 89, 93], 0.04, 0.07), g(271 + 170))
    # scene 4 — swell into the logo, collapse, the logo lands, call to action
    add(reverse_swell(0.8, 0.2), g(487) - 0.8)
    add(impact(0.9, 46), g(487))
    add(whoosh(1.0, 300, 8000, 0.14), g(487) + 0.15, pan=-0.3); add(np.roll(whoosh(1.0, 300, 8000, 0.14), 900), g(487) + 0.15, pan=0.3)
    add(chime([89, 96], 0.0, 0.08), g(487 + 46))                          # the logo "lands"
    add(impact(0.7, 44), g(595))

# Simple reverb (decaying-noise impulse response) for space.
ir_n = at(1.4)
ir = rng.standard_normal(ir_n) * env_exp(ir_n, 0.35); ir = lp(ir, 6000); ir /= np.abs(ir).sum() / 6
wetL = signal.fftconvolve(L, ir)[:N]; wetR = signal.fftconvolve(R, np.roll(ir, 311))[:N]
L2 = L + 0.18 * wetL; R2 = R + 0.18 * wetR
# gentle bus compression (soft clip) and peak normalise to -1 dBFS
mix = np.stack([L2, R2], axis=1)
if '--music' in sys.argv:
    from scipy.io import wavfile as _wf
    msr, mus = _wf.read(sys.argv[sys.argv.index('--music') + 1])
    mus = mus.astype(np.float64) / 32768.0
    m = np.zeros_like(mix); n_ = min(len(mus), N); m[:n_] = mus[:n_]
    mix = mix / (np.abs(mix).max() + 1e-9) * 0.55 + m / (np.abs(m).max() + 1e-9) * 0.8
mix = np.tanh(mix * 1.3) / np.tanh(1.3)
mix *= 10 ** (-3.5 / 20) / np.abs(mix).max()
fade = np.ones(N); fade[-at(0.05):] = np.linspace(1, 0, at(0.05))
mix *= fade[:, None]
from scipy.io import wavfile
wavfile.write(sys.argv[1], SR, (mix * 32767).astype(np.int16))
print('wrote', sys.argv[1], f'{LEN}s')
