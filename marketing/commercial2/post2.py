"""Post for NEXT Ad #2: grade (bloom, hue-preserving tone map, lens, grain) and
full-resolution typography, composited at 1080x1920.

  post-venv/bin/python post2.py IN_DIR OUT_DIR [--frames a-b|--list a,b] [--offset N] [--hook a|b|c] [--captions] [--no-type]
Reads linear .hdr frames from Blender; writes PNGs named p####.png by global frame.
"""
import os, sys, math
import cv2, numpy as np
from PIL import Image, ImageDraw, ImageFont

HERE = os.path.dirname(os.path.abspath(__file__))
FONTS = os.path.join(HERE, '..', 'commercial', 'fonts')
IN, OUT = sys.argv[1], sys.argv[2]
args = sys.argv[3:]
def arg(n, d=None): return args[args.index(n) + 1] if n in args else d
W, H = 1080, 1920
DISP = os.path.join(FONTS, 'BricolageGrotesque-ExtraBold.ttf')
SANS_SB = os.path.join(FONTS, 'IBMPlexSans-SemiBold.ttf')
SANS = os.path.join(FONTS, 'IBMPlexSans-Medium.ttf')
EMBER, WHITE, MUTED = (253, 104, 68), (243, 242, 237), (205, 198, 186)
def smooth(x): x = min(max(x, 0.0), 1.0); return x * x * (3 - 2 * x)
def ease_out(x, p=3): x = min(max(x, 0.0), 1.0); return 1 - (1 - x) ** p

# ---------------------------------------------------------------- grade
def bloom(lin, amount=0.6):
    lum = lin.max(axis=2, keepdims=True)
    bright = lin * np.clip((lum - 1.3) / 2.5, 0, 1) ** 2
    acc = np.zeros_like(lin); small = bright
    for i, w in enumerate((0.30, 0.26, 0.22, 0.18, 0.14, 0.10)):
        small = cv2.pyrDown(small); up = small
        for _ in range(i + 1): up = cv2.pyrUp(up)
        acc += w * cv2.resize(up, (lin.shape[1], lin.shape[0]), interpolation=cv2.INTER_LINEAR)
    return lin + acc * amount
def aces(x):
    return np.clip((x * (2.51 * x + 0.03)) / (x * (2.43 * x + 0.59) + 0.14), 0, 1)
def tonemap(x):            # hue-preserving roll-off for the hottest pixels (no white-out)
    lum = x.max(axis=2, keepdims=True)
    hue = x * (aces(lum) / np.maximum(lum, 1e-5))
    w = np.clip((lum - 0.8) / 3.0, 0, 1) * 0.75
    return aces(x) * (1 - w) + hue * w
def lens(img):
    out = img.copy()
    for ch, s in ((2, 1.0012), (0, 0.9988)):
        M = np.float32([[s, 0, (1 - s) * W / 2], [0, s, (1 - s) * H / 2]])
        out[:, :, ch] = cv2.warpAffine(img[:, :, ch], M, (W, H), flags=cv2.INTER_LINEAR, borderMode=cv2.BORDER_REFLECT)
    return out
yy, xx = np.mgrid[0:H, 0:W].astype(np.float32)
VIGNETTE = (1 - 0.36 * (((xx - W / 2) / (W * 0.78)) ** 2 + ((yy - H / 2) / (H * 0.64)) ** 2)).clip(0.5, 1)[..., None]
def grade(lin, frame):
    x = np.maximum(lens(bloom(lin) * 0.95), 0.0)
    d = tonemap(x) ** (1 / 2.2) * VIGNETTE
    lift = np.array([8, 9, 16], np.float32)[None, None, :] / 255.0
    d = lift + d * (1 - lift)
    d = np.clip((d - 0.5) * 1.05 + 0.5, 0, 1)
    g = np.random.default_rng(frame).normal(0, 0.009, (H // 2, W // 2, 1)).astype(np.float32)
    return np.clip(d + cv2.resize(g, (W, H))[..., None] * (1 - d), 0, 1)

# ---------------------------------------------------------------- type
def layer_text(lines, size, colors, tracking=0.01, font_path=DISP, line_gap=0.98, max_w=980):
    """Centered multi-line block; colors(i_line, i_char) -> rgb. Returns RGBA (W, h)."""
    font = ImageFont.truetype(font_path, size)
    while max(sum(font.getlength(c) + size * tracking for c in ln) for ln in lines) > max_w and size > 16:
        size -= 2; font = ImageFont.truetype(font_path, size)
    lh = int(size * line_gap); h = lh * len(lines) + int(size * 0.5)
    im = Image.new('RGBA', (W, h), (0, 0, 0, 0)); d = ImageDraw.Draw(im)
    for li, ln in enumerate(lines):
        ws = [font.getlength(c) + size * tracking for c in ln]; x = (W - (sum(ws) - size * tracking)) / 2
        for ci, (c, w) in enumerate(zip(ln, ws)):
            d.text((x, li * lh), c, font=font, fill=colors(li, ci)); x += w
    return im
def place(base, layer, cy, scale=1.0, alpha=1.0, blur=0.0, shadow=0.6, glow=0.0):
    arr = np.asarray(layer).astype(np.float32) / 255.0
    if scale != 1.0: arr = cv2.resize(arr, (int(arr.shape[1] * scale), int(arr.shape[0] * scale)), interpolation=cv2.INTER_CUBIC)
    if blur > 0.3: k = int(blur * 3) * 2 + 1; arr = cv2.GaussianBlur(arr, (k, k), blur)
    arr[..., 3] *= alpha
    h, w = arr.shape[:2]; x0, y0 = int(W / 2 - w / 2), int(cy - h / 2)
    xs, ys = max(0, -x0), max(0, -y0); xe, ye = min(w, W - x0), min(h, H - y0)
    if xe <= xs or ye <= ys: return
    reg = base[y0 + ys:y0 + ye, x0 + xs:x0 + xe]; src = arr[ys:ye, xs:xe]; a = src[..., 3:4]
    if glow > 0:
        g = cv2.GaussianBlur(src, (0, 0), 16); reg += g[..., :3] * g[..., 3:4] * glow
    sh = cv2.GaussianBlur(a, (0, 0), 12)
    if sh.ndim == 2: sh = sh[..., None]
    reg *= (1 - shadow * sh)
    reg[:] = reg * (1 - a) + src[..., :3] * a
def slam(f, f0, dur=6):
    p = ease_out((f - f0) / dur, 4)
    return dict(scale=1.18 - 0.18 * p, blur=(1 - p) * 9, alpha=min(1, p * 1.7), glow=0.3 * (1 - p) + 0.08)
def fade(f, f0, dur=5): return 1 - smooth((f - f0) / dur)

_y = np.arange(H, dtype=np.float32)
_t = np.clip((_y - 560) / 260, 0, 1)
SCRIM_TOP = (1 - _t * _t * (3 - 2 * _t))[:, None, None]

HOOK = arg('--hook', 'a')
INK = (16, 9, 8)
CTA_URL = os.environ.get('NEXT_CTA_URL', 'send-a-shot.onrender.com')
DISCLOSE = 'Virtual Credits · no cash value · no ownership of artists, music or earnings · demo artists'

def pill(text, size, fg, bg, outline=None, font_path=SANS_SB, pad=1.0):
    font = ImageFont.truetype(font_path, size)
    while font.getlength(text) > W - 160 and size > 20:
        size -= 1; font = ImageFont.truetype(font_path, size)
    tw = font.getlength(text); h = int(size * 1.75 * pad); w = int(tw + size * 1.4)
    im = Image.new('RGBA', (W, h + 20), (0, 0, 0, 0)); d = ImageDraw.Draw(im)
    x0 = (W - w) // 2; d.rounded_rectangle((x0, 10, x0 + w, 10 + h), h // 2, fill=bg, outline=outline, width=3 if outline else 0)
    d.text((x0 + size * 0.7, 10 + (h - size * 1.3) / 2), text, font=font, fill=fg)
    return im
def line(text, size, color=MUTED, font_path=SANS):
    return layer_text([text], size, lambda li, ci: color, tracking=0.0, font_path=font_path, max_w=W - 120)
def hot_after(word_start):
    return lambda li, ci: EMBER if ci >= word_start else WHITE

# Voiceover captions for the sound-off version (cue times match mix2.py)
CAPTIONS = [(128, 182, 'Discover artists before the crowd.'), (219, 266, 'Back them with virtual Credits.'),
            (335, 362, 'Track your picks.'), (467, 520, 'And if you’re first? You’ve got the proof.')]

def typography(img, f):
    # SCENE 1 (1–57): the hook, readable from the first frame, sound off
    if 1 <= f <= 57:
        o = fade(f, 53, 5); st = slam(f, 0, 4)
        if HOOK == 'a':
            lay = layer_text(['I FOUND', 'THEM FIRST.'], 168, lambda li, ci: EMBER if (li == 1 and ci >= 5) else WHITE)
        elif HOOK == 'b':
            lay = layer_text(['WAIT… YOU CAN', 'TRADE MUSIC', 'ARTISTS?'], 128, lambda li, ci: EMBER if li == 1 else WHITE)
        else:
            lay = layer_text(['CAN YOU FIND', 'THE NEXT BIG', 'ARTIST?'], 132, lambda li, ci: EMBER if li == 1 else WHITE)
        place(img, lay, 420, scale=st['scale'] * (1 + 0.08 * (1 - o)), alpha=st['alpha'] * o, blur=st['blur'] + (1 - o) * 8, glow=st['glow'])
    # SCENE 2 (60–118): PROVE IT.
    if 60 <= f <= 118:
        st = slam(f, 60, 4); st['alpha'] *= fade(f, 114, 5)
        place(img, layer_text(['PROVE IT.'], 230, lambda li, ci: EMBER if ci >= 6 else WHITE), 300, **st)
    # SCENE 3 (122–205): DISCOVER.
    if 122 <= f <= 205:
        st = slam(f, 122, 5); st['alpha'] *= fade(f, 200, 5)
        place(img, layer_text(['DISCOVER.'], 200, lambda li, ci: WHITE if ci < 8 else EMBER), 230, **st)
    # SCENE 4 (211–328): BACK ARTISTS. → TRADE VIRTUAL SHARES.
    if 211 <= f <= 256:
        st = slam(f, 211, 5); st['alpha'] *= fade(f, 252, 4)
        place(img, layer_text(['BACK ARTISTS.'], 170, hot_after(5)), 220, **st)
    if 258 <= f <= 328:
        st = slam(f, 258, 5); st['alpha'] *= fade(f, 323, 5)
        place(img, layer_text(['TRADE VIRTUAL', 'SHARES.'], 150, lambda li, ci: EMBER if li == 1 else WHITE), 270, **st)
    if 213 <= f <= 410:
        place(img, line(DISCLOSE, 26), 1855, alpha=min(ease_out((f - 213) / 8), fade(f, 404, 6)), shadow=0.8)
    # SCENE 5 (331–410): TRACK YOUR PICKS.
    if 331 <= f <= 410:
        st = slam(f, 331, 5); st['alpha'] *= fade(f, 404, 6)
        place(img, layer_text(['TRACK', 'YOUR PICKS.'], 170, lambda li, ci: EMBER if li == 1 and ci >= 5 else WHITE), 300, **st)
    # SCENE 6 (451–538): YOU WERE EARLY.
    if 451 <= f <= 538:
        o = fade(f, 532, 6); st = slam(f, 451, 5); st['alpha'] *= o
        place(img, layer_text(['YOU WERE', 'EARLY.'], 170, lambda li, ci: EMBER if li == 1 else WHITE), 245, **st)
        if f >= 462:
            a = ease_out((f - 462) / 8) * o
            place(img, layer_text(['FOUNDING BELIEVER · BACKER #1'], 50, lambda li, ci: EMBER if ci >= 20 else WHITE, font_path=SANS_SB, tracking=0.04),
                  1735, alpha=a, shadow=0.8)
            place(img, line('Backer #1 = first recorded backer of this artist on NEXT. A permanent record, not a prediction.', 26),
                  1808, alpha=a, shadow=0.8)
    # SCENE 7 (541–660): THINK YOU KNOW WHO'S NEXT? → PROVE IT. → NEXT · FIND THEM FIRST. · COMING SOON
    if 541 <= f <= 574:
        st = slam(f, 541, 5); st['alpha'] *= fade(f, 570, 5)
        place(img, layer_text(['THINK YOU KNOW', 'WHO’S NEXT?'], 140, lambda li, ci: EMBER if li == 1 else WHITE), 330, **st)
    if 576 <= f <= 599:
        st = slam(f, 576, 4); st['alpha'] *= fade(f, 595, 5)
        place(img, layer_text(['PROVE IT.'], 220, lambda li, ci: EMBER if ci >= 6 else WHITE), 330, **st)
    if f >= 600:
        st = slam(f, 600, 6)
        place(img, layer_text(['FIND THEM FIRST.'], 104, hot_after(10)), 1010, **st)
    if f >= 612:
        st = slam(f, 612, 6); st.pop('glow')
        place(img, pill('COMING SOON', 64, INK, (*EMBER, 255)), 1190, **st)
    if f >= 618:
        place(img, line('Be first in line.', 46, WHITE, SANS_SB), 1302, alpha=ease_out((f - 618) / 8), shadow=0.8)
    if f >= 624:
        place(img, line('Virtual Credits. No cash value.', 32), 1372, alpha=ease_out((f - 624) / 8), shadow=0.8)
    # captions (sound-off version)
    if '--captions' in args:
        for a, b, text in CAPTIONS:
            if a <= f <= b:
                al = min(ease_out((f - a) / 4), fade(f, b - 4, 4))
                place(img, pill(text, 44, WHITE, (16, 9, 8, 215), outline=(80, 60, 52, 255)), 1600, alpha=al, shadow=0.0)

def scrim(f):
    for a, b in ((1, 57), (60, 118), (122, 205), (211, 328), (331, 410), (451, 538), (541, 599)):
        if a <= f <= b: return 0.5 * smooth((f - a + 1) / 4) * fade(f, b - 4, 5)
    return 0.0
def blackout(f):                     # "the market graphics fade into darkness" before the card
    return 1 - smooth((f - 408) / 12) if 408 <= f <= 420 else (0.0 if 420 < f <= 421 else 1.0)

OFFSET = int(arg('--offset', '0'))
def process(f):
    lin = cv2.imread(os.path.join(IN, f'f{f:04d}.hdr'), cv2.IMREAD_UNCHANGED)
    if lin is None: raise SystemExit(f'missing frame {f}')
    lin = lin[..., :3].astype(np.float32)
    if lin.shape[1] != W: lin = cv2.resize(lin, (W, H), interpolation=cv2.INTER_CUBIC)
    g = f + OFFSET
    lin *= {60: 1.25, 61: 1.9, 62: 1.35, 63: 1.1, 451: 1.5, 452: 1.2}.get(g, 1.0)   # the drop + the card hit: flashes on the beat
    img = grade(lin, g)[..., [2, 1, 0]].copy()
    k = scrim(g)
    if k > 0: img *= 1 - k * SCRIM_TOP
    img *= blackout(g)
    if '--no-type' not in args: typography(img, g)
    Image.fromarray((np.clip(img, 0, 1) * 255 + 0.5).astype(np.uint8)).save(os.path.join(OUT, f'p{g:04d}.png'), compress_level=1)

os.makedirs(OUT, exist_ok=True)
if arg('--thumb'):                   # cover: one graded frame + the campaign line
    f = int(arg('--thumb'))
    lin = cv2.imread(os.path.join(IN, f'f{f:04d}.hdr'), cv2.IMREAD_UNCHANGED)[..., :3].astype(np.float32)
    img = grade(lin, f + OFFSET)[..., [2, 1, 0]].copy(); img *= 1 - 0.55 * SCRIM_TOP
    place(img, layer_text(['I FOUND', 'THEM FIRST.'], 150, lambda li, ci: EMBER if (li == 1 and ci >= 5) else WHITE), 225, glow=0.08)
    place(img, pill('PROVE IT ON NEXT', 54, INK, (*EMBER, 255)), 1750)
    Image.fromarray((np.clip(img, 0, 1) * 255 + 0.5).astype(np.uint8)).save(os.path.join(OUT, 'NEXT-ad2-cover.png'))
    raise SystemExit(0)
if arg('--list'): frames = [int(x) for x in arg('--list').split(',')]
else:
    a, b = (int(x) for x in arg('--frames', '1-120').split('-')); frames = range(a, b + 1)
for f in frames:
    process(f); print('post', f, flush=True)
