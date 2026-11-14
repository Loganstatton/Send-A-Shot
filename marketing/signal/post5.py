"""Post for NEXT × SCOUT — "THE SIGNAL": grade (bloom, hue-preserving tone map, lens, grain) and
typography composited at full resolution. Grade adapted from ../dual/post4.py (unchanged there).

  post-venv/bin/python post5.py IN_DIR OUT_DIR [--frames a-b|--list a,b] [--offset N] [--wide] [--no-type] [--hook a|b|c]

Reads linear .hdr frames from Blender; writes p####.png named by global film frame.
Titles live in a band between 12% and 30% of the frame height (clear of the platforms' top
bars and bottom caption/CTA areas); small print stays above the bottom 20%.
"""
import os, sys
import cv2, numpy as np
from PIL import Image, ImageDraw, ImageFont

HERE = os.path.dirname(os.path.abspath(__file__))
FONTS = os.path.join(HERE, '..', 'commercial', 'fonts')
DFONTS = os.path.join(HERE, '..', 'dual', 'fonts')
IN, OUT = sys.argv[1], sys.argv[2]
args = sys.argv[3:]
def arg(n, d=None): return args[args.index(n) + 1] if n in args else d
WIDE = '--wide' in args
W, H = (1920, 1080) if WIDE else (1080, 1920)
SANS = os.path.join(DFONTS, 'Inter-500.ttf')
SANS_B = os.path.join(DFONTS, 'Inter-700.ttf')
DISP = os.path.join(FONTS, 'BricolageGrotesque-ExtraBold.ttf')
EMBER, WHITE, CYAN = (253, 104, 68), (243, 238, 228), (69, 198, 240)
def smooth(x): x = min(max(x, 0.0), 1.0); return x * x * (3 - 2 * x)

# ---------------------------------------------------------------- grade
def bloom(lin, amount=0.32):
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
    w = np.clip((lum - 0.8) / 3.0, 0, 1) * 0.8
    return aces(x) * (1 - w) + hue * w
def lens(img):
    out = img.copy()
    for ch, s in ((2, 1.0012), (0, 0.9988)):
        M = np.float32([[s, 0, (1 - s) * W / 2], [0, s, (1 - s) * H / 2]])
        out[:, :, ch] = cv2.warpAffine(img[:, :, ch], M, (W, H), flags=cv2.INTER_LINEAR, borderMode=cv2.BORDER_REFLECT)
    return out
yy, xx = np.mgrid[0:H, 0:W].astype(np.float32)
VIGNETTE = (1 - 0.4 * (((xx - W / 2) / (W * 0.74)) ** 2 + ((yy - H / 2) / (H * 0.66)) ** 2)).clip(0.45, 1)[..., None]
def grade(lin, frame, exposure=0.85):
    x = np.maximum(lens(bloom(lin * exposure)), 0.0)
    d = tonemap(x) ** (1 / 2.2) * VIGNETTE
    lift = np.array([5, 5, 8], np.float32)[None, None, :] / 255.0
    d = lift + d * (1 - lift)
    g = np.random.default_rng(frame).normal(0, 0.008, (H // 2, W // 2, 1)).astype(np.float32)
    return np.clip(d + cv2.resize(g, (W, H))[..., None] * (1 - d), 0, 1)

# ---------------------------------------------------------------- type
def card(text, size, tracking=0.08, font_path=SANS_B, color=WHITE):
    font = ImageFont.truetype(font_path, size)
    ws = [font.getlength(c) + size * tracking for c in text]
    tw = sum(ws) - size * tracking
    im = Image.new('RGBA', (int(tw) + 80, int(size * 1.6)), (0, 0, 0, 0)); d = ImageDraw.Draw(im)
    x = 40
    for c, w in zip(text, ws): d.text((x, size * 0.2), c, font=font, fill=color); x += w
    return im
def lockup(size):
    """SCOUT × NEXT in the products' own marks: the glowing cyan square + SCOUT (Inter Bold),
    × , NEXT (Bricolage Grotesque ExtraBold) + the ember dot."""
    fs, fx, fn = ImageFont.truetype(SANS_B, size), ImageFont.truetype(SANS, int(size * 0.7)), ImageFont.truetype(DISP, int(size * 1.06))
    sq = int(size * 0.22); gap = int(size * 0.32); dot = int(size * 0.2)
    ws, wx, wn = fs.getlength('SCOUT'), fx.getlength('×'), fn.getlength('NEXT')
    w = int(sq + size * 0.22 + ws + gap + wx + gap + wn + size * 0.08 + dot) + 80
    im = Image.new('RGBA', (w, int(size * 1.7)), (0, 0, 0, 0)); d = ImageDraw.Draw(im)
    x = 40; cy = size * 0.85
    d.rounded_rectangle((x, cy - sq / 2 - size * 0.02, x + sq, cy + sq / 2 - size * 0.02), radius=max(2, sq // 5), fill=CYAN)
    x += sq + size * 0.22; d.text((x, cy), 'SCOUT', font=fs, fill=(243, 246, 250), anchor='lm'); x += ws + gap
    d.text((x, cy), '×', font=fx, fill=(200, 196, 190), anchor='lm'); x += wx + gap
    d.text((x, cy + size * 0.02), 'NEXT', font=fn, fill=(243, 242, 237), anchor='lm'); x += wn + size * 0.08
    d.ellipse((x, cy + size * 0.18 - dot / 2, x + dot, cy + size * 0.18 + dot / 2), fill=EMBER)
    return im
def place(base, layer, cx, cy, alpha=1.0, blur=0.0, glow=0.25, scale=1.0, darken=0.5):
    if scale != 1.0: layer = layer.resize((max(1, int(layer.width * scale)), max(1, int(layer.height * scale))), Image.LANCZOS)
    arr = np.asarray(layer).astype(np.float32) / 255.0
    if blur > 0.3: k = int(blur * 3) * 2 + 1; arr = cv2.GaussianBlur(arr, (k, k), blur)
    arr[..., 3] *= alpha
    h, w = arr.shape[:2]; x0, y0 = int(cx - w / 2), int(cy - h / 2)
    xs, ys = max(0, -x0), max(0, -y0); xe, ye = min(w, W - x0), min(h, H - y0)
    if xe <= xs or ye <= ys: return
    reg = base[y0 + ys:y0 + ye, x0 + xs:x0 + xe]; src = arr[ys:ye, xs:xe]; a = src[..., 3:4]
    g = cv2.GaussianBlur(src, (0, 0), 14); reg += g[..., :3] * g[..., 3:4] * glow * alpha
    reg *= 1 - darken * cv2.GaussianBlur(a, (0, 0), 22)[..., None]        # soft local darkening for legibility
    reg[:] = reg * (1 - a) + src[..., :3] * a

HOOK = arg('--hook', 'a')
# (first, last, text or None for the lockup, size, y vertical, y wide, colour, fade in, fade out)
TITLES = {
    'a': [
        (1, 33, "THIS ISN'T A STOCK.", 106, 0.2, 0.18, WHITE, 0, 5),
        (38, 63, "IT'S AN ARTIST.", 128, 0.2, 0.18, (255, 226, 204), 2, 6),
        (63, 105, None, 128, 0.195, 0.16, None, 8, 0),
    ],
}[HOOK]
def typography(img, f):
    for a, b, text, size, yv, yw, col, fi, fo in TITLES:
        if not a <= f <= b: continue
        pin = smooth((f - a + 1) / fi) if fi else 1.0
        pout = 1 - smooth((f - (b - fo)) / fo) if fo else 1.0
        alpha = min(pin, pout)
        if alpha <= 0.001: continue
        s_ = size * (1.1 if WIDE else 1.0)
        layer = lockup(int(s_)) if text is None else card(text, int(s_), color=col)
        fit = min(1.0, (W * (0.62 if WIDE else 0.86)) / max(1, layer.width - 80))     # never wider than the safe width
        # a hard-cut title arrives full size with a fast 4% settle; others drift up 12 px as they fade in
        settle = 1.0 + 0.04 * (1 - smooth((f - a) / 6)) if not fi else 1.0
        place(img, layer, W / 2, H * (yw if WIDE else yv) + (1 - pin) * 12, alpha=alpha, blur=(1 - pin) * 5 + (1 - pout) * 4, scale=settle * fit)

FLASH = {40: 1.7, 41: 1.3, 42: 1.1}                  # the waveform locks
OFFSET = int(arg('--offset', '0'))
def process(f):
    lin = cv2.imread(os.path.join(IN, f'f{f:04d}.hdr'), cv2.IMREAD_UNCHANGED)
    if lin is None: raise SystemExit(f'missing frame {f}')
    lin = lin[..., :3].astype(np.float32)
    if lin.shape[:2] != (H, W): lin = cv2.resize(lin, (W, H), interpolation=cv2.INTER_CUBIC)
    g = f + OFFSET
    lin *= FLASH.get(g, 1.0)
    img = grade(lin, g)[..., [2, 1, 0]].copy()
    if '--no-type' not in args: typography(img, g)
    Image.fromarray((np.clip(img, 0, 1) * 255 + 0.5).astype(np.uint8)).save(os.path.join(OUT, f'p{g:04d}.png'), compress_level=1)

os.makedirs(OUT, exist_ok=True)
if arg('--list'): frames = [int(x) for x in arg('--list').split(',')]
else:
    a, b = (int(x) for x in arg('--frames', '1-90').split('-')); frames = range(a, b + 1)
for f in frames:
    process(f); print('post', f, flush=True)
