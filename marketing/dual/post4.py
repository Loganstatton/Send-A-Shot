"""Post for SCOUT × NEXT — "BEFORE THE BREAKOUT": grade (bloom, hue-preserving tone map,
lens, grain) and the title cards, composited at full resolution. Adapted from the
reveal trailer's post3.py (unchanged).

  post-venv/bin/python post4.py IN_DIR OUT_DIR [--frames a-b|--list a,b] [--offset N] [--wide] [--no-type] [--cover N]

Reads linear .hdr frames from Blender; writes p####.png named by global trailer frame.
--wide composites for 1920x1080 (16:9) instead of 1080x1920.

Title style: SCOUT's own typeface (Inter) wide-tracked; each title carries the colour of the
product on screen: SCOUT cyan-white, then warming to NEXT's paper-orange through the connection.
"""
import os, sys
import cv2, numpy as np
from PIL import Image, ImageDraw, ImageFont

HERE = os.path.dirname(os.path.abspath(__file__))
FONTS = os.path.join(HERE, '..', 'commercial', 'fonts')
DFONTS = os.path.join(HERE, 'fonts')
IN, OUT = sys.argv[1], sys.argv[2]
args = sys.argv[3:]
def arg(n, d=None): return args[args.index(n) + 1] if n in args else d
WIDE = '--wide' in args
W, H = (1920, 1080) if WIDE else (1080, 1920)
SANS = os.path.join(DFONTS, 'Inter-500.ttf')
SANS_B = os.path.join(DFONTS, 'Inter-700.ttf')
SANS_SB = os.path.join(FONTS, 'IBMPlexSans-SemiBold.ttf')
DISP = os.path.join(FONTS, 'BricolageGrotesque-ExtraBold.ttf')
EMBER, WHITE = (253, 104, 68), (243, 238, 228)
def smooth(x): x = min(max(x, 0.0), 1.0); return x * x * (3 - 2 * x)

# ---------------------------------------------------------------- grade (same family as Ad #2, softer contrast)
def bloom(lin, amount=0.55):
    lum = lin.max(axis=2, keepdims=True)
    bright = lin * np.clip((lum - 1.2) / 2.5, 0, 1) ** 2
    acc = np.zeros_like(lin); small = bright
    for i, w in enumerate((0.30, 0.26, 0.22, 0.18, 0.14, 0.10)):
        small = cv2.pyrDown(small); up = small
        for _ in range(i + 1): up = cv2.pyrUp(up)
        acc += w * cv2.resize(up, (lin.shape[1], lin.shape[0]), interpolation=cv2.INTER_LINEAR)
    return lin + acc * amount
def aces(x): return np.clip((x * (2.51 * x + 0.03)) / (x * (2.43 * x + 0.59) + 0.14), 0, 1)
def tonemap(x):
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
VIGNETTE = (1 - 0.4 * (((xx - W / 2) / (W * 0.74)) ** 2 + ((yy - H / 2) / (H * 0.66)) ** 2)).clip(0.45, 1)[..., None]
def grade(lin, frame):
    x = np.maximum(lens(bloom(lin)), 0.0)
    d = tonemap(x) ** (1 / 2.2) * VIGNETTE
    lift = np.array([6, 6, 10], np.float32)[None, None, :] / 255.0
    d = lift + d * (1 - lift)
    g = np.random.default_rng(frame).normal(0, 0.008, (H // 2, W // 2, 1)).astype(np.float32)
    return np.clip(d + cv2.resize(g, (W, H))[..., None] * (1 - d), 0, 1)

# ---------------------------------------------------------------- title cards
def card(text, size, tracking=0.32, font_path=SANS, color=WHITE):
    font = ImageFont.truetype(font_path, size)
    ws = [font.getlength(c) + size * tracking for c in text]
    tw = sum(ws) - size * tracking
    im = Image.new('RGBA', (int(tw) + 80, int(size * 1.6)), (0, 0, 0, 0)); d = ImageDraw.Draw(im)
    x = 40
    for c, w in zip(text, ws): d.text((x, size * 0.2), c, font=font, fill=color); x += w
    return im
def place(base, layer, cx, cy, alpha=1.0, blur=0.0, glow=0.25):
    arr = np.asarray(layer).astype(np.float32) / 255.0
    if blur > 0.3: k = int(blur * 3) * 2 + 1; arr = cv2.GaussianBlur(arr, (k, k), blur)
    arr[..., 3] *= alpha
    h, w = arr.shape[:2]; x0, y0 = int(cx - w / 2), int(cy - h / 2)
    xs, ys = max(0, -x0), max(0, -y0); xe, ye = min(w, W - x0), min(h, H - y0)
    if xe <= xs or ye <= ys: return
    reg = base[y0 + ys:y0 + ye, x0 + xs:x0 + xe]; src = arr[ys:ye, xs:xe]; a = src[..., 3:4]
    g = cv2.GaussianBlur(src, (0, 0), 14); reg += g[..., :3] * g[..., 3:4] * glow * alpha
    reg *= 1 - 0.5 * cv2.GaussianBlur(a, (0, 0), 18)[..., None]          # soft local darkening for legibility
    reg[:] = reg * (1 - a) + src[..., :3] * a

SCOUT_W, MID_W, NEXT_W = (228, 244, 255), (246, 236, 226), (255, 232, 214)
# (first frame, last frame, text, size, y as a fraction of height: vertical, wide, colour)
TITLES = [
    (12, 57, 'EVERY BREAKOUT HAS A BEGINNING.', 34, 0.2, 0.2, SCOUT_W),
    (60, 114, 'THIS IS WHERE IT STARTS.', 40, 0.2, 0.2, SCOUT_W),
    (131, 215, 'MEET SCOUT.', 60, 0.14, 0.12, SCOUT_W),
    (361, 404, 'DISCOVERED.', 54, 0.13, 0.12, SCOUT_W),
    (405, 448, 'EVALUATED.', 54, 0.13, 0.12, MID_W),
    (449, 506, 'APPROVED.', 54, 0.13, 0.12, NEXT_W),
    (511, 578, "NOW, IT'S YOUR TURN.", 48, 0.085, 0.1, NEXT_W),
    (600, 660, 'BACK.', 60, 0.075, 0.1, NEXT_W),
    (664, 726, 'TRADE.', 60, 0.075, 0.1, NEXT_W),
    (760, 826, 'COMPETE.', 60, 0.075, 0.1, NEXT_W),
    (873, 925, 'FOUNDING BELIEVER', 44, 0.9, 0.88, NEXT_W),
    (928, 976, 'BACKER #1', 58, 0.9, 0.88, NEXT_W),
    (979, 1032, 'YOU WERE EARLY.', 50, 0.9, 0.88, NEXT_W),
    (1124, 1160, 'ONE VISION.', 50, 0.86, 0.86, (243, 242, 237)),
    (1162, 1199, "FIND WHAT'S NEXT.", 50, 0.86, 0.86, (243, 242, 237)),
]
NOTES = [        # small print: (first, last, text, y vertical, y wide)
    (131, 356, 'INTERNAL TALENT DISCOVERY · HUMAN EVALUATION', 0.175, 0.17),
    (449, 520, 'APPROVED BY A SCOUT · NOW LISTED ON NEXT', 0.165, 0.165),
    (596, 830, 'VIRTUAL CREDITS · NO CASH VALUE · NOT REAL SECURITIES · DEMO DATA', 0.955, 0.95),
    (873, 1032, 'FIRST RECORDED NEXT BACKER · DEMO DATA', 0.945, 0.94),
    (1128, 1199, 'SCOUT POWERS INTERNAL DISCOVERY · NEXT IS THE PUBLIC EXPERIENCE', 0.915, 0.92),
]
TOP_SCRIM = (511, 830)           # darken the top of frame while the phone UI fills it, so the titles read
_yy = np.arange(H, dtype=np.float32)
SCRIM = np.clip(1 - _yy / (H * 0.2), 0, 1)[:, None, None] ** 1.5
FADE_IN, FADE_OUT = 14, 10
def env(f, a, b):
    return min(smooth((f - a) / FADE_IN), 1 - smooth((f - (b - FADE_OUT)) / FADE_OUT))
def typography(img, f):
    if TOP_SCRIM[0] - 10 <= f <= TOP_SCRIM[1] + 10:
        k = min(smooth((f - TOP_SCRIM[0] + 10) / 10), 1 - smooth((f - TOP_SCRIM[1]) / 10))
        img *= 1 - 0.7 * k * SCRIM
    for a, b, text, size, yv, yw, col in TITLES:
        if not a <= f <= b: continue
        alpha = env(f, a, b); pin = smooth((f - a) / FADE_IN); pout = 1 - smooth((f - (b - FADE_OUT)) / FADE_OUT)
        if alpha <= 0.001: continue
        s_ = size * (1.15 if WIDE else 1.0)
        place(img, card(text, int(s_), tracking=0.26, font_path=SANS_B if size >= 50 else SANS, color=col), W / 2, H * (yw if WIDE else yv) + (1 - pin) * 12,
              alpha=alpha, blur=(1 - pin) * 5 + (1 - pout) * 3)
    for a, b, text, yv, yw in NOTES:
        if not a <= f <= b: continue
        alpha = env(f, a, b) * 0.85
        if alpha > 0.001: place(img, card(text, 21, tracking=0.2), W / 2, H * (yw if WIDE else yv), alpha=alpha, glow=0.0)

def exposure(f):                 # cuts and impacts (global frames)
    if 826 <= f <= 840: return 1 - smooth((f - 826) / 14)          # the market fades to dark before the card
    if 1192 <= f <= 1200: return 1 - smooth((f - 1192) / 8)
    return {496: 1.8, 497: 1.35, 498: 1.12, 871: 1.45, 872: 1.15, 1111: 1.9, 1112: 1.4, 1113: 1.15}.get(f, 1.0)

OFFSET = int(arg('--offset', '0'))
def process(f):
    lin = cv2.imread(os.path.join(IN, f'f{f:04d}.hdr'), cv2.IMREAD_UNCHANGED)
    if lin is None: raise SystemExit(f'missing frame {f}')
    lin = lin[..., :3].astype(np.float32)
    if lin.shape[:2] != (H, W): lin = cv2.resize(lin, (W, H), interpolation=cv2.INTER_CUBIC)
    g = f + OFFSET
    lin *= exposure(g) if exposure(g) > 1 else 1.0
    img = grade(lin, g)[..., [2, 1, 0]].copy()
    if '--no-type' not in args: typography(img, g)
    if exposure(g) < 1: img *= exposure(g)
    Image.fromarray((np.clip(img, 0, 1) * 255 + 0.5).astype(np.uint8)).save(os.path.join(OUT, f'p{g:04d}.png'), compress_level=1)

os.makedirs(OUT, exist_ok=True)
if arg('--list'): frames = [int(x) for x in arg('--list').split(',')]
else:
    a, b = (int(x) for x in arg('--frames', '1-240').split('-')); frames = range(a, b + 1)
for f in frames:
    process(f); print('post', f, flush=True)
