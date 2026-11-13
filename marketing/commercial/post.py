"""Post for the NEXT opener: bloom, tone map, grade, lens, grain, typography.

  post-venv/bin/python post.py IN_DIR OUT_DIR [--frames 1-90] [--list a,b,c]
Reads linear EXR frames from Blender, writes 1080x1920 PNGs.
"""
import os, sys, math
os.environ['OPENCV_IO_ENABLE_OPENEXR'] = '1'
import cv2, numpy as np
from PIL import Image, ImageDraw, ImageFont

HERE = os.path.dirname(os.path.abspath(__file__))
IN, OUT = sys.argv[1], sys.argv[2]
args = sys.argv[3:]
def arg(n, d=None): return args[args.index(n) + 1] if n in args else d
W, H = 1080, 1920
FPS = 30
DISPLAY = ImageFont.truetype(os.path.join(HERE, 'fonts', 'BricolageGrotesque-ExtraBold.ttf'), 104)
EMBER = (253, 104, 68)
WHITE = (243, 242, 237)

def smooth(x):
    x = min(max(x, 0.0), 1.0); return x * x * (3 - 2 * x)
def ease_out(x, p=3):
    x = min(max(x, 0.0), 1.0); return 1 - (1 - x) ** p

# ---------------------------------------------------------------- image
def bloom(lin, amount=0.75):
    lum = lin.max(axis=2, keepdims=True)
    knee = np.clip((lum - 1.2) / 2.5, 0, 1) ** 2
    bright = lin * knee
    acc = np.zeros_like(lin)
    small = bright
    weights = (0.30, 0.26, 0.22, 0.18, 0.14, 0.10)
    for i, w in enumerate(weights):
        small = cv2.pyrDown(small)
        up = small
        for _ in range(i + 1): up = cv2.pyrUp(up)
        acc += w * cv2.resize(up, (lin.shape[1], lin.shape[0]), interpolation=cv2.INTER_LINEAR)
    return lin + acc * amount

def aces(x):
    a, b, c, d, e = 2.51, 0.03, 2.43, 0.59, 0.14
    return np.clip((x * (a * x + b)) / (x * (c * x + d) + e), 0, 1)

def lens(img):
    h, w = img.shape[:2]
    out = img.copy()
    for ch, s in ((2, 1.0016), (0, 0.9984)):   # BGR: R out, B in
        M = np.float32([[s, 0, (1 - s) * w / 2], [0, s, (1 - s) * h / 2]])
        out[:, :, ch] = cv2.warpAffine(img[:, :, ch], M, (w, h), flags=cv2.INTER_LINEAR, borderMode=cv2.BORDER_REFLECT)
    return out

yy, xx = np.mgrid[0:H, 0:W].astype(np.float32)
VIGNETTE = (1 - 0.42 * (((xx - W / 2) / (W * 0.75)) ** 2 + ((yy - H / 2) / (H * 0.62)) ** 2)).clip(0.45, 1)[..., None]

# Highlight control. Per-channel ACES drives very bright orange sparks to pure
# white; blending toward a hue-preserving curve (tone-map the brightest
# channel, keep the ratios) for the hottest pixels keeps them ember-coloured
# and keeps detail in the bursts. Bursts also get a short exposure dip.
HUE_KEEP = float(os.environ.get('HUE_KEEP', '0.7'))
BURSTS = ((33, 86, 0.58), (577, 616, 0.8)) if os.environ.get('BURSTS', '1') == '1' else ()   # (first, last global frame, exposure at peak)
def burst(frame):
    """0..1 envelope over the particle bursts: quick attack, long release."""
    for a, b, lo in BURSTS:
        if a <= frame <= b:
            t = (frame - a) / (b - a)
            return (smooth(t / 0.15) if t < 0.15 else 1 - smooth((t - 0.55) / 0.45) if t > 0.55 else 1.0), lo
    return 0.0, 1.0

def tonemap(x, k):
    lum = x.max(axis=2, keepdims=True)
    hue = x * (aces(lum) / np.maximum(lum, 1e-5))
    knee = 0.8 - 0.4 * k
    w = np.clip((lum - knee) / (3.0 - 1.5 * k), 0, 1) * (HUE_KEEP + (1 - HUE_KEEP) * k)
    return aces(x) * (1 - w) + hue * w

def grade(lin, frame):
    k, lo = burst(frame)
    x = bloom(lin, 0.75 - 0.35 * k) * 0.95 * (1 - (1 - lo) * k)
    x = np.maximum(lens(x), 0.0)
    disp = tonemap(x, k)
    disp = disp ** (1 / 2.2)
    if k > 0: disp = disp ** (1 + 0.45 * k)          # more contrast in the bursts: sparks read as sparks
    disp = disp * VIGNETTE
    # warm the blacks toward the brand background, slight S-curve
    lift = np.array([8, 9, 16], np.float32)[None, None, :] / 255.0   # BGR of #100908
    disp = lift + disp * (1 - lift)
    disp = np.clip((disp - 0.5) * 1.04 + 0.5, 0, 1)
    rng = np.random.default_rng(frame)
    grain = rng.normal(0, 0.012, (H // 2, W // 2, 1)).astype(np.float32)
    disp = disp + cv2.resize(grain, (W, H))[..., None] * (1 - disp)
    return np.clip(disp, 0, 1)

# ---------------------------------------------------------------- type
SAFE_W = 960
def fit_font(text, tracking=0.02, size=104):
    while size > 40:
        f = ImageFont.truetype(os.path.join(HERE, 'fonts', 'BricolageGrotesque-ExtraBold.ttf'), size)
        if sum(f.getlength(c) + size * tracking for c in text) <= SAFE_W: return f
        size -= 2
    return f
def text_layer(text, color, tracking=0.02, reveal=1.0, stagger=0.55, rise=26, font=None):
    """RGBA layer with per-letter rise+fade reveal (reveal 0..1)."""
    font = font or fit_font(text, tracking)
    layer = Image.new('RGBA', (W * 2, 300), (0, 0, 0, 0))
    d = ImageDraw.Draw(layer)
    widths = [font.getlength(ch) + font.size * tracking for ch in text]
    total = sum(widths) - font.size * tracking
    x = (W * 2 - total) / 2
    n = len(text)
    for i, ch in enumerate(text):
        p = (reveal * (1 + stagger * n) - stagger * i) / 1.0
        p = ease_out(p, 3)
        if p > 0:
            col = color(i) if callable(color) else color
            a = int(255 * p)
            glyph = Image.new('RGBA', layer.size, (0, 0, 0, 0))
            ImageDraw.Draw(glyph).text((x, 90 + rise * (1 - p)), ch, font=font, fill=(*col, a))
            layer = Image.alpha_composite(layer, glyph)
        x += widths[i]
    return layer

def place(base, layer, cy, scale=1.0, blur=0.0, alpha=1.0, glow=0.0):
    lw, lh = layer.size
    arr = np.array(layer).astype(np.float32) / 255.0
    if scale != 1.0:
        arr = cv2.resize(arr, (int(lw * scale), int(lh * scale)), interpolation=cv2.INTER_LINEAR)
    if blur > 0.3:
        k = int(blur * 3) * 2 + 1
        arr = cv2.GaussianBlur(arr, (k, k), blur)
    arr[..., 3] *= alpha
    h, w = arr.shape[:2]
    # the layer is built at 2x width around the center; map to frame
    x0 = int(W / 2 - w / 2); y0 = int(cy - h / 2)
    xs0, ys0 = max(0, -x0), max(0, -y0)
    xs1, ys1 = min(w, W - x0), min(h, H - y0)
    region = base[y0 + ys0:y0 + ys1, x0 + xs0:x0 + xs1]
    src = arr[ys0:ys1, xs0:xs1]
    a = src[..., 3:4]
    rgb = src[..., :3]
    if glow > 0:
        g = cv2.GaussianBlur(src, (0, 0), 18)
        region += g[..., :3] * g[..., 3:4] * glow
    # soft shadow under type for legibility over bright particles
    sh = cv2.GaussianBlur(a, (0, 0), 10)
    if sh.ndim == 2: sh = sh[..., None]
    region *= (1 - 0.55 * sh)
    region[:] = region * (1 - a) + rgb * a

# ---------------------------------------------------------------- the full timeline (global frames, 30 fps)
# v2, 24.0 s. Beats every 18 frames (100 BPM). Cuts on the beat at 91 (the buy),
# 253 (the chart), 325 (portfolio → leaderboard), 415 (darkness → the card);
# THE HIT at 451 (15.0 s); the logo forms from 577; JOIN NEXT at 649 (21.6 s).
import json
SANS = os.path.join(HERE, 'fonts', 'IBMPlexSans-Medium.ttf')
SANS_SB = os.path.join(HERE, 'fonts', 'IBMPlexSans-SemiBold.ttf')
MONO = os.path.join(HERE, 'fonts', 'IBMPlexMono-Medium.ttf')
DISP = os.path.join(HERE, 'fonts', 'BricolageGrotesque-ExtraBold.ttf')
MUTED = (205, 198, 186)
SUBTLE = (228, 222, 212)
UPC = (74, 222, 128)
INK = (16, 9, 8)
CTA_URL = os.environ.get('NEXT_CTA_URL', 'send-a-shot.onrender.com')
CUTS = (91, 253, 325)
HITS = (451,)
ASSETS = arg('--assets', os.path.join(HERE, 'assets'))
def _load(name):
    p = os.path.join(ASSETS, name)
    return json.load(open(p)) if os.path.exists(p) else None
JUNO = _load('juno.json')
PROJ = _load('proj_market.json') or {}
BUY = JUNO['buy']['price'] / 100 if JUNO else 44.03
SHARES = JUNO['buy']['shares'] if JUNO else 5.68
AFTER = (JUNO['backers'] - 1) if JUNO else 14

def plain_layer(text, size, color, font_path=SANS, tracking=0.0):
    font = ImageFont.truetype(font_path, size)
    while font.getlength(text) > W - 110 and size > 18:
        size -= 1; font = ImageFont.truetype(font_path, size)
    return text_layer(text, color, tracking=tracking, font=font)

def slam(f, f0, dur=9):
    p = ease_out((f - f0) / dur, 4)
    return dict(scale=1.22 - 0.22 * p, blur=(1 - p) * 10, alpha=min(1, p * 1.6), glow=0.35 * (1 - p) + 0.12)
def pop(f, f0, dur=7):
    p = ease_out((f - f0) / dur, 3)
    return dict(scale=0.9 + 0.1 * p, alpha=p)
def fade_out(f, f0, dur=6):
    return 1 - smooth((f - f0) / dur)

def headline(text, hot_word, size=104):
    i0 = text.index(hot_word)
    font = fit_font(text, 0.02, size)
    return text_layer(text, lambda i: EMBER if i >= i0 else WHITE, font=font)

def chip_layer(text, badge, size=40, accent=EMBER):
    """A step chip: dark pill, ember outline, a numbered (or check) badge, then the text."""
    font = ImageFont.truetype(SANS_SB, size)
    while font.getlength(text) > W - 230 and size > 24:
        size -= 1; font = ImageFont.truetype(SANS_SB, size)
    tw = font.getlength(text); bh = int(size * 2.0); bw = int(tw + bh + 70)
    layer = Image.new('RGBA', (W * 2, 300), (0, 0, 0, 0)); d = ImageDraw.Draw(layer)
    x0 = W - bw // 2; y0 = 150 - bh // 2
    d.rounded_rectangle((x0, y0, x0 + bw, y0 + bh), bh // 2, fill=(20, 11, 9, 236), outline=accent, width=3)
    r = bh // 2 - 9; cx, cy = x0 + 9 + r, 150
    d.ellipse((cx - r, cy - r, cx + r, cy + r), fill=accent)
    if badge == 'check':
        d.line([(cx - r * 0.45, cy + r * 0.02), (cx - r * 0.1, cy + r * 0.38), (cx + r * 0.5, cy - r * 0.35)], fill=INK, width=max(4, size // 8), joint='curve')
    else:
        bf = ImageFont.truetype(SANS_SB, int(size * 0.95)); d.text((cx - bf.getlength(badge) / 2, cy - size * 0.62), badge, font=bf, fill=INK)
    d.text((x0 + bh + 22, cy - size * 0.68), text, font=font, fill=WHITE)
    return layer

def tag_layer(text, size=34, fg=WHITE, bg=(20, 11, 9, 232), outline=(243, 242, 237)):
    font = ImageFont.truetype(SANS_SB, size)
    tw = font.getlength(text); h = int(size * 1.7); w = int(tw + 44)
    layer = Image.new('RGBA', (W * 2, 300), (0, 0, 0, 0)); d = ImageDraw.Draw(layer)
    x0 = W - w // 2; y0 = 150 - h // 2
    d.rounded_rectangle((x0, y0, x0 + w, y0 + h), h // 2, fill=bg, outline=outline, width=2)
    d.text((x0 + 22, 150 - size * 0.68), text, font=font, fill=fg)
    return layer

def ticker_layer(price, pct):
    big = ImageFont.truetype(MONO, 84); small = ImageFont.truetype(SANS_SB, 50)
    a, b = f'${price:,.2f}', f'+{pct:.1f}%'
    gap, tri = 26, 34
    tw = big.getlength(a) + gap + tri + 10 + small.getlength(b)
    layer = Image.new('RGBA', (W * 2, 300), (0, 0, 0, 0)); d = ImageDraw.Draw(layer)
    x = W - tw / 2
    d.text((x, 150 - 60), a, font=big, fill=WHITE)
    tx = x + big.getlength(a) + gap                     # an up-triangle (the font has no ▲)
    d.polygon([(tx, 150 + 20), (tx + tri, 150 + 20), (tx + tri / 2, 150 - 10)], fill=UPC)
    d.text((tx + tri + 10, 150 - 36), b, font=small, fill=UPC)
    return layer

def place_at(base, layer, cx, cy, **kw):
    """place(), but centred on (cx, cy) instead of the frame's centre line."""
    shift = int(round(cx - W / 2))
    if shift: layer = layer.transform(layer.size, Image.AFFINE, (1, 0, -shift, 0, 1, 0))
    place(base, layer, cy, **kw)

# the chart (v2_market shot A): the same reveal + resampling Blender used, so the ticker matches the line
def _smooth_series(values, n):
    out = []
    for i in range(n):
        t = i / (n - 1) * (len(values) - 1); k = min(int(t), len(values) - 2); fr = t - k
        fr = fr * fr * (3 - 2 * fr); out.append(values[k] * (1 - fr) + values[k + 1] * fr)
    return out
CHART0 = 252
_VALS = _smooth_series(JUNO['history'], 90) if JUNO else [4400, 5110]
def chart_price(g):
    f = g - CHART0
    x = min(max((f - 4) / 50, 0.0), 1.0); t = x * x * (3 - 2 * x)
    k = t * (len(_VALS) - 1); i = min(int(k), len(_VALS) - 2); a = k - i
    return (_VALS[i] * (1 - a) + _VALS[i + 1] * a) / 100
def proj(name, g):
    v = PROJ.get(name, {}).get(str(g))
    return v if v else None

TEXT1, TEXT2 = 'THE NEXT SUPERSTAR…', 'ISN’T FAMOUS YET.'
MICRO = 'NEXT Credits are virtual — no real money · No ownership of artists’ music or earnings'

def typography(img, f):
    # 0–3 s  opener: the first line is readable from frame 4
    if 4 <= f < 46:
        out = smooth((f - 37) / 7)
        st = slam(f, 4, 8)
        place(img, text_layer(TEXT1, WHITE), cy=330 - out * 40, scale=st['scale'] * (1.0 + out * 0.25), blur=st['blur'] + out * 14,
              alpha=st['alpha'] * (1 - out), glow=st['glow'])
    if 55 <= f <= 90:
        famous = set(range(TEXT2.index('FAMOUS'), TEXT2.index('FAMOUS') + 6))
        st = slam(f, 55); st['alpha'] *= fade_out(f, 85, 5)
        place(img, text_layer(TEXT2, lambda i: EMBER if i in famous else WHITE), cy=330, **st)
    # 3.0–8.4 s  THE BUY
    if 92 <= f <= 252:
        o = fade_out(f, 246, 6)
        st = slam(f, 92); st['alpha'] *= o
        place(img, headline('TRADE ARTISTS LIKE STOCKS.', 'STOCKS.'), cy=175, **st)
        place(img, plain_layer('With free virtual credits — no real money.', 38, SUBTLE), cy=262, alpha=ease_out((f - 100) / 8) * o)
        for a, b, badge, text in ((96, 143, '1', 'FIND AN ARTIST EARLY'), (146, 197, '2', 'BUY SHARES WITH VIRTUAL CREDITS'),
                                  (200, 252, 'check', f'BOUGHT {SHARES:.2f} SHARES AT ${BUY:.2f}')):
            if a <= f <= b:
                st = pop(f, a); st['alpha'] *= fade_out(f, b - 4, 4)
                place(img, chip_layer(text, badge, accent=UPC if badge == 'check' else EMBER), cy=1768, **st)
    # 8.4–10.8 s  THE PRICE MOVES
    if 254 <= f <= 324:
        o = fade_out(f, 318, 6)
        st = slam(f, 254); st['alpha'] *= o
        place(img, headline('WATCH THE PRICE MOVE.', 'MOVE.'), cy=175, **st)
        place(img, plain_layer(f'{AFTER} more players backed Juno Marrow after you.', 36, SUBTLE), cy=262, alpha=ease_out((f - 262) / 8) * o)
        b = proj('buy', f)
        if b and f >= 259:
            place_at(img, tag_layer(f'YOU BOUGHT  ${BUY:.2f}', 40), min(max(b[0] + 190, 210), W - 210), b[1] + 74, alpha=ease_out((f - 259) / 6) * o)
        h = proj('head', f)
        if h and f >= 262:
            price = chart_price(f); pct = (price - BUY) / BUY * 100
            place_at(img, ticker_layer(price, max(pct, 0.0)), min(max(h[0] - 150, 250), W - 250), h[1] - 118, alpha=ease_out((f - 262) / 6) * o)
    # 10.8–13.8 s  PORTFOLIO → LEADERBOARD
    if 326 <= f <= 360:
        o = fade_out(f, 355, 5); st = slam(f, 326); st['alpha'] *= o
        place(img, headline('TRACK YOUR GAINS.', 'GAINS.'), cy=175, **st)
        place(img, plain_layer('Your portfolio, live — all in virtual credits.', 36, SUBTLE), cy=262, alpha=ease_out((f - 333) / 7) * o)
    if 362 <= f <= 414:
        o = fade_out(f, 408, 6); st = slam(f, 362); st['alpha'] *= o
        place(img, headline('CLIMB THE LEADERBOARD.', 'LEADERBOARD.'), cy=175, **st)
        place(img, plain_layer('Rank against every player — and your friends.', 36, SUBTLE), cy=262, alpha=ease_out((f - 369) / 7) * o)
    if 254 <= f <= 414:
        place(img, plain_layer(MICRO, 25, MUTED), cy=1868, alpha=min(ease_out((f - 256) / 8), fade_out(f, 409, 5)))
    # 15.0–19.2 s  THE PAYOFF (the card lands on the hit at 451)
    if 451 <= f <= 575:
        o = fade_out(f, 568, 7)
        st = slam(f, 451, 8); st['alpha'] *= o
        place(img, headline('YOU WERE EARLY.', 'EARLY.', 128), cy=168, **st)
        if f >= 468:
            place(img, plain_layer('Permanent proof you backed them first.', 46, WHITE, SANS_SB), cy=1755, alpha=ease_out((f - 468) / 8) * o)
        if f >= 478:
            place(img, plain_layer('Virtual credits only · No real money · No ownership of music or earnings', 26, MUTED), cy=1822,
                  alpha=ease_out((f - 478) / 8) * o)
    # 19.2–24.0 s  the logo, then the call to action
    if 612 <= f < 647:
        o = fade_out(f, 641, 6)
        place(img, text_layer('DISCOVER TOMORROW’S STARS.', WHITE, reveal=min(1, (f - 612) / 12)), cy=1060, alpha=o)
    if f >= 649:
        st = slam(f, 649, 10)
        place(img, text_layer('JOIN NEXT', WHITE, font=ImageFont.truetype(DISP, 150)), cy=1050, **st)
        if f >= 655:
            st = pop(f, 655, 8)
            place(img, tag_layer(CTA_URL, 66, fg=INK, bg=(*EMBER, 255), outline=EMBER), cy=1232, **st)
        if f >= 662:
            place(img, plain_layer('Free to play · Virtual credits only · No real money', 34, MUTED), cy=1362, alpha=ease_out((f - 662) / 8))

OFFSET = int(arg('--offset', '0'))

def reframe(lin, g):
    return lin

# Soft dark bands behind type: top (headline + sub) and bottom (chips / proof line),
# so a bright phone screen or card behind them can never eat the words.
_y = np.arange(H, dtype=np.float32)
_t = np.clip((_y - 330) / 220, 0, 1)
SCRIM = (1 - _t * _t * (3 - 2 * _t))[:, None, None]
_b = np.clip((_y - 1600) / 170, 0, 1)
SCRIM_LOW = (_b * _b * (3 - 2 * _b))[:, None, None]
def _env(g, a, b, rin=8, rout=6):
    return smooth((g - a) / rin) * fade_out(g, b - rout, rout) if a <= g <= b else 0.0
def scrim_amount(g):
    return max(_env(g, 92, 252), _env(g, 254, 324), _env(g, 326, 414), _env(g, 451, 575))
def scrim_low_amount(g):
    return max(_env(g, 96, 252) * 0.85, _env(g, 254, 414) * 0.5, _env(g, 466, 575) * 0.85)

def process(f):
    src = os.path.join(IN, f'f{f:04d}.hdr')
    lin = cv2.imread(src, cv2.IMREAD_UNCHANGED)
    if lin is None: raise SystemExit(f'missing {src}')
    lin = lin[..., :3].astype(np.float32)
    if lin.shape[1] != W:
        lin = cv2.resize(lin, (W, H), interpolation=cv2.INTER_CUBIC)
    g = f + OFFSET
    lin = reframe(lin, g)
    # a quick flash on every cut, on the beat
    for c in CUTS:
        lin *= {c - 1: 1.45, c: 2.0, c + 1: 1.3, c + 2: 1.1}.get(g, 1.0)
    for c in HITS:
        lin *= {c: 1.7, c + 1: 1.3, c + 2: 1.1}.get(g, 1.0)
    img = grade(lin, g)
    img = img[..., [2, 1, 0]].copy()      # to RGB
    k = scrim_amount(g)
    if k > 0: img *= 1 - 0.72 * k * SCRIM
    k = scrim_low_amount(g)
    if k > 0: img *= 1 - 0.7 * k * SCRIM_LOW
    if '--no-type' not in args: typography(img, g)
    Image.fromarray((np.clip(img, 0, 1) * 255 + 0.5).astype(np.uint8)).save(os.path.join(OUT, f'p{g:04d}.png'), compress_level=1)

os.makedirs(OUT, exist_ok=True)
if arg('--list'):
    frames = [int(x) for x in arg('--list').split(',')]
else:
    a, b = (int(x) for x in arg('--frames', '1-90').split('-'))
    frames = range(a, b + 1)
for f in frames:
    process(f)
    print('post', f, flush=True)
