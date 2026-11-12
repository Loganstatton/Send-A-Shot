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
SAFE_W = 900
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

TEXT1, TEXT2 = 'THE NEXT SUPERSTAR…', 'ISN’T FAMOUS YET.'
def typography(img, f):
    # Line 1: letters rise in (f6–f22), hold, blown away by the shatter (f37–f44).
    if 6 <= f < 46:
        r = (f - 6) / 16
        out = smooth((f - 37) / 7)
        place(img, text_layer(TEXT1, WHITE, reveal=r), cy=330 - out * 40, scale=1.0 + out * 0.25, blur=out * 14, alpha=1 - out)
    # Line 2: slams in at f56 — scale down, blur to sharp, ember on FAMOUS.
    if f >= 55:
        p = ease_out((f - 55) / 9, 4)
        famous = set(range(TEXT2.index('FAMOUS'), TEXT2.index('FAMOUS') + 6))
        col = lambda i: EMBER if i in famous else WHITE
        place(img, text_layer(TEXT2, col, reveal=1.0), cy=330, scale=1.22 - 0.22 * p, blur=(1 - p) * 10, alpha=min(1, p * 1.6), glow=0.35 * (1 - p) + 0.12)

def process(f):
    src = os.path.join(IN, f'f{f:04d}.hdr')
    lin = cv2.imread(src, cv2.IMREAD_UNCHANGED)
    if lin is None: raise SystemExit(f'missing {src}')
    lin = lin[..., :3].astype(np.float32)
    if lin.shape[1] != W:
        lin = cv2.resize(lin, (W, H), interpolation=cv2.INTER_CUBIC)
    img = grade(lin, f)
    img = img[..., [2, 1, 0]].copy()      # to RGB
    typography(img, f)
    Image.fromarray((np.clip(img, 0, 1) * 255 + 0.5).astype(np.uint8)).save(os.path.join(OUT, f'p{f:04d}.png'), compress_level=1)

os.makedirs(OUT, exist_ok=True)
if arg('--list'):
    frames = [int(x) for x in arg('--list').split(',')]
else:
    a, b = (int(x) for x in arg('--frames', '1-90').split('-'))
    frames = range(a, b + 1)
for f in frames:
    process(f)
    print('post', f, flush=True)
