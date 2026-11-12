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
def bloom(lin):
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
    return lin + acc * 0.75

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

def grade(lin, frame):
    x = bloom(lin) * 0.95
    x = lens(x)
    disp = aces(x)
    disp = disp ** (1 / 2.2)
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
SAFE_W = 860
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
# Beats every 18 frames (100 BPM): cuts at 91, 271, 487.
SANS = os.path.join(HERE, 'fonts', 'IBMPlexSans-Medium.ttf')
SANS_SB = os.path.join(HERE, 'fonts', 'IBMPlexSans-SemiBold.ttf')
MUTED = (205, 198, 186)
CTA_URL = os.environ.get('NEXT_CTA_URL', 'send-a-shot.onrender.com')
CUTS = (91, 271, 487)

def plain_layer(text, size, color, font_path=SANS, tracking=0.0):
    font = ImageFont.truetype(font_path, size)
    return text_layer(text, color, tracking=tracking, font=font)

def words_layer(words, alphas, colors, font, tracking=0.02):
    """One line of words with fixed layout; each word has its own alpha/colour (so the line never jumps)."""
    line = ' '.join(words)
    layer = Image.new('RGBA', (W * 2, 300), (0, 0, 0, 0))
    widths = [font.getlength(ch) + font.size * tracking for ch in line]
    x = (W * 2 - (sum(widths) - font.size * tracking)) / 2
    wi = 0
    for i, ch in enumerate(line):
        if ch == ' ': wi += 1
        a = alphas[wi]
        if a > 0 and ch != ' ':
            g = Image.new('RGBA', layer.size, (0, 0, 0, 0))
            ImageDraw.Draw(g).text((x, 90 + 18 * (1 - a)), ch, font=font, fill=(*colors[wi], int(255 * a)))
            layer = Image.alpha_composite(layer, g)
        x += widths[i]
    return layer

def slam(f, f0, dur=9):
    p = ease_out((f - f0) / dur, 4)
    return dict(scale=1.22 - 0.22 * p, blur=(1 - p) * 10, alpha=min(1, p * 1.6), glow=0.35 * (1 - p) + 0.12)

def fade_out(f, f0, dur=6):
    return 1 - smooth((f - f0) / dur)

TEXT1, TEXT2 = 'THE NEXT SUPERSTAR…', 'ISN’T FAMOUS YET.'
DISCLAIM_A = 'NEXT Credits are virtual — no real money.'
DISCLAIM_B1, DISCLAIM_B2 = 'Virtual credits only. No real money.', 'No ownership of artists’ music or earnings.'

def typography(img, f):
    # 0–3 s  opener
    if 6 <= f < 46:
        r = (f - 6) / 16
        out = smooth((f - 37) / 7)
        place(img, text_layer(TEXT1, WHITE, reveal=r), cy=330 - out * 40, scale=1.0 + out * 0.25, blur=out * 14, alpha=1 - out)
    if 55 <= f <= 90:
        famous = set(range(TEXT2.index('FAMOUS'), TEXT2.index('FAMOUS') + 6))
        st = slam(f, 55); st['alpha'] *= fade_out(f, 85, 5)
        place(img, text_layer(TEXT2, lambda i: EMBER if i in famous else WHITE), cy=330, **st)
    # 3–9 s  DISCOVER. BACK. TRADE.
    if 109 <= f <= 270:
        words = ['DISCOVER.', 'BACK.', 'TRADE.']
        starts = (109, 217, 253)
        font = fit_font(' '.join(words), 0.02, 92)
        alphas = [ease_out((f - s0) / 7, 3) if f >= s0 else 0.0 for s0 in starts]
        newest = max([i for i, s0 in enumerate(starts) if f >= s0])
        colors = [EMBER if i == newest else WHITE for i in range(3)]
        o = fade_out(f, 265, 5)
        place(img, words_layer(words, [a * o for a in alphas], colors, font), cy=250, glow=0.1)
        if f >= 217:
            place(img, plain_layer(DISCLAIM_A, 32, MUTED), cy=345, alpha=ease_out((f - 217) / 8) * o)
    # 9–16.2 s  PROVE YOU WERE EARLY.
    if 289 <= f <= 486:
        t = 'PROVE YOU WERE EARLY.'
        early = set(range(t.index('EARLY'), len(t)))
        st = slam(f, 289); st['alpha'] *= fade_out(f, 480, 6)
        place(img, text_layer(t, lambda i: EMBER if i in early else WHITE), cy=250, **st)
        o = ease_out((f - 300) / 8) * fade_out(f, 480, 6)
        place(img, plain_layer(DISCLAIM_B1, 31, MUTED), cy=345, alpha=o)
        place(img, plain_layer(DISCLAIM_B2, 31, MUTED), cy=388, alpha=o)
    # 16.2–22.2 s  logo, tagline, call to action
    if 541 <= f < 597:
        o = fade_out(f, 589, 6)
        place(img, text_layer('DISCOVER TOMORROW’S STARS.', WHITE, reveal=min(1, (f - 541) / 12)), cy=1060, alpha=o)
        if f >= 559:
            st = slam(f, 559); st['alpha'] *= o
            place(img, text_layer('TODAY.', EMBER, font=ImageFont.truetype(os.path.join(HERE, 'fonts', 'BricolageGrotesque-ExtraBold.ttf'), 132)), cy=1180, **st)
    if f >= 595:
        st = slam(f, 595, 10)
        place(img, text_layer('JOIN NEXT', WHITE, font=ImageFont.truetype(os.path.join(HERE, 'fonts', 'BricolageGrotesque-ExtraBold.ttf'), 150)), cy=1080, **st)
        if f >= 603:
            place(img, plain_layer(f'Play free at {CTA_URL}', 46, WHITE, SANS_SB), cy=1225, alpha=ease_out((f - 603) / 8))
        if f >= 611:
            place(img, plain_layer('Free to play · Virtual credits only · No real money', 30, MUTED), cy=1295, alpha=ease_out((f - 611) / 8))

OFFSET = int(arg('--offset', '0'))

# Reframes: (first, last global frame) -> pixels to push the render down.
# Scene 3 shot A: the chart price tags otherwise run into the headline.
REFRAME = {(271, 342): 300}
def reframe(lin, g):
    for (a, b), dy in REFRAME.items():
        if a <= g <= b:
            out = np.zeros_like(lin)             # dark sky above; content fades in below the seam
            out[dy:] = lin[:H - dy]
            t = np.clip((np.arange(H, dtype=np.float32) - dy) / 160, 0, 1)
            return out * (t * t * (3 - 2 * t))[:, None, None]
    return lin

# A soft dark band behind the top headline + disclaimer, so a bright phone
# screen pushed up behind it can't eat the type.
_y = np.arange(H, dtype=np.float32)
_t = np.clip((_y - 380) / 240, 0, 1)
SCRIM = (1 - _t * _t * (3 - 2 * _t))[:, None, None]
def scrim_amount(g):
    if 103 <= g <= 271: return smooth((g - 103) / 9) * fade_out(g, 265, 6)
    if 289 <= g <= 486: return smooth((g - 289) / 8) * fade_out(g, 480, 6)
    return 0.0

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
    img = grade(lin, g)
    img = img[..., [2, 1, 0]].copy()      # to RGB
    k = scrim_amount(g)
    if k > 0: img *= 1 - 0.72 * k * SCRIM
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
