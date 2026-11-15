"""Final mix for NEXT Ad #2: score + original sound design + voiceover (ducked).
v2: the chimes and shimmers were rebuilt as low synth confirms and airy swishes (nothing bell-like).

  post-venv/bin/python mix2.py OUT.wav SECONDS --music music.wav --vo VO_DIR [--hook a|b|c] [--stems DIR]
All sound design is synthesized here (no samples). Voice lines come from vo.py.
"""
import json, os, sys
import numpy as np
from scipy import signal
from scipy.io import wavfile

SR = 48000
OUTP, LEN = sys.argv[1], float(sys.argv[2])
args = sys.argv[3:]
def arg(n, d=None): return args[args.index(n) + 1] if n in args else d
N = int(SR * LEN)
rng = np.random.default_rng(31)
L = np.zeros(N); R = np.zeros(N)
def at(s): return int(round(s * SR))
def sos(kind, f, order=2): return signal.butter(order, f, btype=kind, fs=SR, output='sos')
def add(x, start, gain=1.0, pan=0.0, bus=None):
    bus = bus or (L, R)
    s0 = at(start)
    if s0 >= N or s0 < 0: return
    x = x[:N - s0]; gl, gr = np.cos((pan + 1) * np.pi / 4) * 1.414, np.sin((pan + 1) * np.pi / 4) * 1.414
    bus[0][s0:s0 + len(x)] += x * gain * gl; bus[1][s0:s0 + len(x)] += x * gain * gr
def e(n, d): return np.exp(-np.arange(n) / SR / d)

def boom(level=1.0, f0=32):
    n = at(1.6); t = np.arange(n) / SR
    return (np.sin(2 * np.pi * np.cumsum(f0 + 70 * np.exp(-t / 0.07)) / SR) * e(n, 0.55)
            + signal.sosfilt(sos('lowpass', 160), rng.standard_normal(n)) * e(n, 0.05) * 0.5) * level
def whoosh(dur, lo, hi, level, rise=False):
    n = at(dur); t = np.arange(n) / SR; x = rng.standard_normal(n); out = np.zeros(n)
    for i in range(0, n, 1200):
        p = i / n; c = lo + (hi - lo) * (p ** 2 if rise else np.sin(np.pi * p) ** 2)
        out[i:i + 1200] = signal.sosfilt(sos('bandpass', [max(40, c * 0.55), min(c * 1.5, 20000)]), x[i:i + 1200])
    shape = (t / dur) ** 2.2 if rise else np.sin(np.pi * t / dur) ** 1.4
    return out * shape * level
def click(level=0.3, f=2600):
    n = at(0.035); t = np.arange(n) / SR
    return (np.sin(2 * np.pi * f * t) * 0.6 + signal.sosfilt(sos('highpass', 3000), rng.standard_normal(n)) * 0.4) * e(n, 0.005) * level
def shimmer(dur, level=0.08):
    """v2: an airy swish (band-passed noise swell), not a tremolo of high sines: nothing bell-like."""
    n = at(dur); t = np.arange(n) / SR
    x = signal.sosfilt(sos('bandpass', [1200, 4500]), rng.standard_normal(n))
    return x * np.sin(np.pi * t / dur) ** 2 * level * 1.3
def shing(level=0.06):
    n = at(0.9); t = np.arange(n) / SR
    return signal.sosfilt(sos('bandpass', [5000, 12000]), rng.standard_normal(n)) * np.sin(np.pi * t / 0.9) ** 2 * level

# ---------------------------------------------------------------- sound design (opening, 0–4 s)
add(boom(0.9, 34), 0.0)                                         # the opening punch
add(click(0.35, 3200), 0.0)
add(whoosh(0.55, 300, 9000, 0.16, rise=True), 1.45)             # the camera rushes the phone
add(np.sin(2 * np.pi * 70 * np.arange(at(0.3)) / SR) * e(at(0.3), 0.05) * 0.5, 1.93)   # lights out
add(click(0.25, 1500), 1.93)
add(boom(1.1, 28), 2.0)                                         # PROVE IT
add(whoosh(0.35, 3000, 14000, 0.06), 2.0, pan=0.4)
for k in range(3):                                               # the ring travelling round the phone
    add(shimmer(0.7, 0.05), 2.05 + k * 0.55, pan=(-0.6, 0.6, -0.3)[k])
add(shing(0.05), 2.4, pan=-0.3)                                  # reflection across the glass

def g(frame): return (frame - 1) / 30.0                       # global frame -> seconds
def tone(f, dur, level, decay=0.25, harm=0.3):
    n = at(dur); t = np.arange(n) / SR
    return (np.sin(2 * np.pi * f * t) + harm * np.sin(2 * np.pi * 2 * f * t)) * np.minimum(1, t / 0.003) * e(n, decay) * level
def chime(notes, step=0.05, level=0.08):
    """v2 'confirm': a low two-note synth hit (root, fifth) with a sub thump and a short noise
    tail — modern UI weight instead of a high bell arpeggio. Same call sites and timing."""
    n = at(0.9); t = np.arange(n) / SR; out = np.zeros(n)
    root = notes[0] - 36 if notes[0] >= 72 else notes[0] - 24
    for i, nn in enumerate((root, root + 7)):
        s0 = at(i * max(step, 0.06)); k = n - s0; tt = np.arange(k) / SR; f = 440 * 2 ** ((nn - 69) / 12)
        v = signal.sawtooth(2 * np.pi * f * tt) * 0.6 + np.sin(2 * np.pi * f / 2 * tt)
        out[s0:] += signal.sosfilt(sos('lowpass', 1600), v) * np.minimum(1, tt / 0.004) * np.exp(-tt / 0.22) * 0.5
    out += np.sin(2 * np.pi * np.cumsum(48 + 90 * np.exp(-t / 0.05)) / SR) * np.exp(-t / 0.18) * 0.8
    out += signal.sosfilt(sos('bandpass', [2000, 7000]), rng.standard_normal(n)) * np.exp(-t / 0.04) * 0.25
    return np.tanh(out * 1.4) * level * 3.2
def rnb_preview(dur=1.95):
    """Juno Marrow's 'preview': an original late-night R&B sketch (warm keys, soft beat, a hummed line)."""
    n = at(dur); t = np.arange(n) / SR; out = np.zeros(n)
    def m(x): return 440 * 2 ** ((x - 69) / 12)
    for c0, chord in ((0.0, (51, 55, 58, 62)), (0.98, (48, 51, 55, 58, 62))):          # Ebmaj7 → Cm9
        s0 = at(c0); k = n - s0; tt = np.arange(k) / SR
        keys_ = sum(np.sin(2 * np.pi * m(x) * tt + 0.8 * np.sin(2 * np.pi * m(x) * tt) * np.exp(-tt / 0.3)) for x in chord) / len(chord)
        out[s0:] += keys_ * np.exp(-tt / 0.9) * 0.5
    for b in np.arange(0, dur, 0.375 * 2):                                               # soft kick / rim
        s0 = at(b); k = min(at(0.3), n - s0); tt = np.arange(k) / SR
        out[s0:s0 + k] += np.sin(2 * np.pi * (50 + 60 * np.exp(-tt / 0.03)) * tt) * np.exp(-tt / 0.12) * 0.5
        s1 = at(b + 0.375)
        if s1 < n:
            k2 = min(at(0.05), n - s1); out[s1:s1 + k2] += signal.sosfilt(sos('bandpass', [1500, 6000]), rng.standard_normal(k2)) * e(k2, 0.01) * 0.25
    vib = np.sin(2 * np.pi * 5.2 * t) * 0.008
    for nt, t0, d in ((70, 0.15, 0.5), (67, 0.7, 0.35), (65, 1.1, 0.75)):                 # the hummed line
        s0 = at(t0); k = min(at(d), n - s0); tt = np.arange(k) / SR
        v = signal.sawtooth(2 * np.pi * m(nt) * (1 + vib[:k]) * tt)
        v = signal.sosfilt(sos('bandpass', [500, 1800]), v) * np.minimum(1, tt / 0.06) * np.minimum(1, (d - tt) / 0.08) * 0.35
        out[s0:s0 + k] += v
    out = signal.sosfilt(sos('lowpass', 7500), out)                                      # through a phone's preview player
    return out * np.minimum(1, t / 0.05) * np.minimum(1, (dur - t) / 0.15) * 0.5

PL = np.zeros(N); PR = np.zeros(N); prev_env = np.zeros(N)
if LEN > 4.5:
    # 3 DISCOVER
    add(whoosh(0.4, 400, 7000, 0.08), g(121), pan=-0.2)
    add(click(0.18, 2400), g(127))                                 # Discover slides to Juno
    add(click(0.3, 2800), g(134))                                  # tap the card
    add(whoosh(0.5, 300, 6000, 0.12), g(135), pan=0.3)            # the card lifts off the screen
    pv = rnb_preview(1.95); add(pv, g(156), 1.0, 0.1, (PL, PR)); prev_env[at(g(156)):at(g(156)) + len(pv)] = 1.0
    for k in range(4): add(shimmer(0.5, 0.025), g(158 + 14 * k), pan=0.3)
    # 4 BACK / TRADE
    add(click(0.32, 2600), g(211))                                 # Back this artist
    add(whoosh(0.35, 800, 9000, 0.1), g(212), pan=-0.2)
    add(click(0.25, 2400), g(228)); add(click(0.3, 2700), g(241)); add(click(0.34, 3000), g(259))
    add(chime([68, 72, 75, 80, 84, 87], 0.05, 0.11), g(262), pan=0.1)      # bought
    add(boom(0.45, 46), g(262))
    for i in range(9):                                                       # market lines growing: rising data ticks
        add(click(0.12 + 0.012 * i, 900 + 140 * i), g(264 + i * 3.5), pan=-0.7 + 1.4 * i / 8)
    add(whoosh(1.1, 200, 8000, 0.15, rise=True), g(296) - 0.2)    # into the chart
    # 5 TRACK
    for k, fr in enumerate((338, 348, 358, 367, 376)):
        add(whoosh(0.28, 1500, 10000, 0.06), g(fr), pan=(-0.7, 0.7)[k % 2])
    add(whoosh(0.3, 600, 9000, 0.07), g(391))                      # portfolio → leaderboard
    add(chime([77, 81, 84, 89], 0.045, 0.09), g(396))              # #1 lights up
    # 6 BACKER #1
    add(tone(130.8, 1.0, 0.05, 0.6, 0.1) * np.sin(np.pi * np.arange(at(1.0)) / at(1.0)), g(424))     # the small light appears
    add(boom(1.0, 30), g(451)); add(shing(0.07), g(451), pan=0.2)
    add(chime([84, 89, 91, 96], 0.03, 0.08), g(452))
    add(shing(0.04), g(486), pan=-0.4)                             # glint across the foil
    # 7 WHO'S NEXT
    add(whoosh(0.9, 400, 9000, 0.12), g(556), pan=-0.3); add(whoosh(0.9, 400, 9000, 0.12), g(558), pan=0.3)
    add(whoosh(0.7, 200, 6000, 0.1, rise=True), g(560), pan=0.0)                # particles into the logo: a short rise
    add(chime([89, 96], 0.0, 0.09), g(588)); add(boom(0.5, 44), g(588))
    add(click(0.2, 2000), g(612))

# ---------------------------------------------------------------- voiceover
VO = arg('--vo'); hook = arg('--hook', 'a')
CUES = [('hook_' + hook, 0.12), ('prove', 2.08)]
if LEN > 4.5:
    CUES += [('discover', 4.25), ('back', 7.3), ('track', 11.15), ('proof', 15.55), ('end', 18.3)]
VL = np.zeros(N); VR = np.zeros(N); vo_env = np.zeros(N)
lines = {}
if VO:
    import soundfile as sf
    for key, t0 in CUES:
        p = os.path.join(VO, f'{key}.wav')
        if not os.path.exists(p): continue
        v, vsr = sf.read(p, dtype='float32')
        if v.ndim > 1: v = v.mean(1)
        v = signal.resample_poly(v, SR, vsr)
        v = signal.sosfilt(sos('highpass', 90), v)               # clean low end
        lines[key] = (t0, v / (np.abs(v).max() + 1e-9) * 0.9)
        add(lines[key][1], t0, 1.0, 0.0, (VL, VR))
        s0 = at(t0); vo_env[s0:s0 + len(v)] = 1.0
def follower(x, att, rel):
    ka, kr = np.exp(-1 / (att * SR)), np.exp(-1 / (rel * SR)); out = np.zeros(len(x)); y = 0.0
    for i in range(len(x)):
        y = x[i] + (y - x[i]) * (ka if x[i] > y else kr); out[i] = y
    return out
duckg = 1 - 0.68 * follower(vo_env, 0.06, 0.25)
prevg = 1 - 0.55 * follower(prev_env, 0.08, 0.3)                  # the score steps back for Juno's preview

# ---------------------------------------------------------------- music + mix
mus = np.zeros((N, 2))
if arg('--music'):
    msr, m = wavfile.read(arg('--music')); m = m.astype(np.float64) / 32768
    n_ = min(len(m), N); mus[:n_] = m[:n_]
# v2: under the voice, the score's speech band (500 Hz-3 kHz, where its melody sits) dips further,
# so the words stay clear while the low end and the drums keep their weight
vo_f = follower(vo_env, 0.05, 0.3)[:, None]
mus_sp = signal.sosfilt(signal.butter(2, [400, 3600], btype='bandpass', fs=SR, output='sos'), mus, axis=0)
mus = mus - 1.0 * vo_f * mus_sp
sfx = np.stack([L, R], 1); sfx = sfx / (np.abs(sfx).max() + 1e-9)
prev = np.stack([PL, PR], 1)
bed = (mus / (np.abs(mus).max() + 1e-9) * 0.8 * prevg[:, None] + sfx * 0.5 + prev * 0.9) * duckg[:, None]
vo = np.stack([VL, VR], 1) * 0.95

EDIT = arg('--edit')                  # e.g. "0-4,8-10,14-16,18-22": a condensed cut on bar lines
if EDIT:
    segs = [tuple(float(x) for x in sp.split('-')) for sp in EDIT.split(',')]
    parts, vparts, t_out, newvo, last_end = [], None, 0.0, [], 0.0
    xf = at(0.01)
    for a, b in segs:
        piece = bed[at(a):at(b)].copy(); piece[:xf] *= np.linspace(0, 1, xf)[:, None]; piece[-xf:] *= np.linspace(1, 0, xf)[:, None]
        parts.append(piece)
        for key, (t0, v) in sorted(lines.items(), key=lambda kv: kv[1][0]):
            if a <= t0 < b:
                nt = t_out + (t0 - a)
                if nt >= last_end: newvo.append((nt, v)); last_end = nt + len(v) / SR
        t_out += b - a
    bed = np.concatenate(parts); N2 = len(bed)
    vo = np.zeros((N2, 2)); ve = np.zeros(N2)
    for nt, v in newvo:
        s0 = at(nt); k = min(len(v), N2 - s0); vo[s0:s0 + k] += (v[:k] * 0.95)[:, None]; ve[s0:s0 + k] = 1
    bed = bed * (1 - 0.35 * follower(ve, 0.06, 0.25))[:, None]
mix = bed + vo
if arg('--stems'):                    # optional: write the music+sfx bed and the voice separately (for edits and checks)
    os.makedirs(arg('--stems'), exist_ok=True)
    pk = np.abs(mix).max() + 1e-9
    for nm, st in (('bed', bed), ('voice', vo)):
        wavfile.write(os.path.join(arg('--stems'), os.path.basename(OUTP).replace('.wav', f'_{nm}.wav')), SR, (st / pk * 0.6 * 32767).astype(np.int16))
mix = np.tanh(mix * 1.1) / np.tanh(1.1)
mix *= 10 ** (-4.0 / 20) / np.abs(mix).max()                     # sample peak -4 dBFS (true-peak headroom for AAC)
f_ = at(0.04); mix[-f_:] *= np.linspace(1, 0, f_)[:, None]
wavfile.write(OUTP, SR, (mix * 32767).astype(np.int16))
print('wrote', OUTP, f'{len(mix) / SR:.2f}s', 'cues:', [c for c, _ in CUES], '(edit)' if EDIT else '')
