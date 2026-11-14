"""Post for THE MOVE: grade (bloom, hue-preserving tone map, lens, grain, a soft warm atmosphere) and
typography composited at full 1080x1920 resolution (sharp type is never rendered through the 3D lens).

  post-venv/bin/python post_move.py IN_DIR OUT_DIR [--frames a-b|--list a,b] [--offset N] [--hook a|b|c] [--no-type]

Reads linear .hdr (or half-float EXR) frames from Blender; writes p####.png named by film frame.
Safe zones: labels and titles between 17% and 62% of the height; disclosures never in the bottom 20%.
"""
import os, sys
os.environ['OPENCV_IO_ENABLE_OPENEXR'] = '1'
import cv2, numpy as np
from PIL import Image, ImageDraw, ImageFont

HERE = os.path.dirname(os.path.abspath(__file__))
FONTS = os.path.join(HERE, '..', 'commercial', 'fonts'); DFONTS = os.path.join(HERE, '..', 'dual', 'fonts')
IN, OUT = sys.argv[1], sys.argv[2]
args = sys.argv[3:]
def arg(n, d=None): return args[args.index(n) + 1] if n in args else d
W, H = 1080, 1920
SANS, SANS_B = os.path.join(DFONTS, 'Inter-500.ttf'), os.path.join(DFONTS, 'Inter-700.ttf')
DISP = os.path.join(FONTS, 'BricolageGrotesque-ExtraBold.ttf')
EMBER, WHITE, SOFT = (253, 104, 68), (243, 238, 228), (226, 220, 212)
HOOK = arg('--hook', 'a')
def smooth(x): x = min(max(x, 0.0), 1.0); return x * x * (3 - 2 * x)

# ---------------------------------------------------------------- grade (as THE SIGNAL's post5.py, plus atmosphere)
def bloom(lin, amount=0.3):
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
# atmosphere: a very soft warm haze rising off the floor (BGR, linear)
ATMOS = (np.clip((yy / H - 0.35) / 0.65, 0, 1) ** 1.5)[..., None] * np.array([0.004, 0.010, 0.022], np.float32)
def grade(lin, frame, exposure=0.85):
    lin = lin + ATMOS + cv2.GaussianBlur(lin, (0, 0), 40) * 0.06       # haze: a wide, faint veil from the light sources
    x = np.maximum(lens(bloom(lin * exposure)), 0.0)
    d = tonemap(x) ** (1 / 2.2) * VIGNETTE
    lift = np.array([5, 5, 7], np.float32)[None, None, :] / 255.0
    d = lift + d * (1 - lift)
    g = np.random.default_rng(frame).normal(0, 0.007, (H // 2, W // 2, 1)).astype(np.float32)
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
def pill(text, size, color=SOFT, border=(255, 150, 120)):
    """A small bordered tag (used for the disclosure), crisp at final resolution."""
    t = card(text, size, tracking=0.14, font_path=SANS_B, color=color)
    pad = int(size * 0.7)
    im = Image.new('RGBA', (t.width - 80 + 2 * pad + 4, int(size * 2.2)), (0, 0, 0, 0)); d = ImageDraw.Draw(im)
    d.rounded_rectangle((1, 1, im.width - 2, im.height - 2), radius=im.height // 2, outline=(*border, 200), width=2, fill=(12, 8, 7, 150))
    im.alpha_composite(t, (pad + 2 - 40, int((im.height - t.height) / 2)))
    return im
def place(base, layer, cx, cy, alpha=1.0, blur=0.0, glow=0.2, scale=1.0, darken=0.45):
    if scale != 1.0: layer = layer.resize((max(1, int(layer.width * scale)), max(1, int(layer.height * scale))), Image.LANCZOS)
    arr = np.asarray(layer).astype(np.float32) / 255.0
    if blur > 0.3: k = int(blur * 3) * 2 + 1; arr = cv2.GaussianBlur(arr, (k, k), blur)
    arr[..., 3] *= alpha
    h, w = arr.shape[:2]; x0, y0 = int(cx - w / 2), int(cy - h / 2)
    xs, ys = max(0, -x0), max(0, -y0); xe, ye = min(w, W - x0), min(h, H - y0)
    if xe <= xs or ye <= ys: return
    reg = base[y0 + ys:y0 + ye, x0 + xs:x0 + xe]; src = arr[ys:ye, xs:xe]; a = src[..., 3:4]
    g = cv2.GaussianBlur(src, (0, 0), 12); reg += g[..., :3] * g[..., 3:4] * glow * alpha
    reg *= 1 - darken * cv2.GaussianBlur(a, (0, 0), 20)[..., None]
    reg[:] = reg * (1 - a) + src[..., :3] * a

# (first, last, kind, text, size, y, colour, fade in, fade out)
HOOKS = {
    'a': [(1, 98, 'label', 'VIRTUAL PORTFOLIO GAIN', 30, 0.362, EMBER, 0, 8),
          (1, 98, 'pill', 'ILLUSTRATIVE EXAMPLE · VIRTUAL CREDITS', 24, 0.565, SOFT, 0, 8),
          (1, 98, 'small', 'NO CASH VALUE · DEMO DATA', 22, 0.6, SOFT, 0, 8)],
    'b': [(1, 98, 'label', 'VIRTUAL PORTFOLIO GAIN', 28, 0.085, EMBER, 0, 8),
          (1, 98, 'counter', '', 150, 0.15, WHITE, 0, 8),
          (1, 98, 'pill', 'ILLUSTRATIVE EXAMPLE · VIRTUAL CREDITS', 22, 0.222, SOFT, 0, 8),
          (1, 98, 'small', 'NO CASH VALUE · DEMO DATA', 20, 0.252, SOFT, 0, 8)],
    'c': None,
}
HOOKS['c'] = HOOKS['a']
TITLES = HOOKS[HOOK]
# hook B's counter: the same curve as move_hook.py (the position's realistic exit value along the real price path)
import json
J = json.load(open(arg('--journey', os.path.join(HERE, 'journey.json'))))
_S = J['series'][:-1]; _PK = J['plan']['pick']; _SH = J['hero_buy']['shares']; _N = len(_S)
def _pnl(p):
    n = round(_SH * p); post = max(100, round(p * (1 - n / 1_000_000 * 0.05)))
    return round(_SH * max(100, round((p + post) / 2))) - _PK
_P = [_pnl(p) for p in _S]
def counter_value(f, lock=46, i0=1.35):
    t = min(max((f - 1) / (lock - 1), 0.0), 1.0); idx = i0 + (_N - 1 - i0) * (1 - (1 - t) ** 2.6)
    k = min(int(idx), _N - 2); fr = idx - k
    return int(round((_P[k] + (_P[k + 1] - _P[k]) * fr) / 100))
def counter_card(v, size):
    """+$1,432 in the NEXT display face: the sign in ember, the figure in white."""
    f = ImageFont.truetype(DISP, size); sign, num = '+$', f'{v:,}'
    w = int(f.getlength(sign) + f.getlength(num)) + 80
    im = Image.new('RGBA', (w, int(size * 1.35)), (0, 0, 0, 0)); d = ImageDraw.Draw(im)
    d.text((40, size * 0.08), sign, font=f, fill=EMBER); d.text((40 + f.getlength(sign), size * 0.08), num, font=f, fill=WHITE)
    return im
def typography(img, f):
    for a, b, kind, text, size, y, col, fi, fo in TITLES:
        if not a <= f <= b: continue
        pin = smooth((f - a + 1) / fi) if fi else 1.0
        pout = 1 - smooth((f - (b - fo)) / fo) if fo else 1.0
        al = min(pin, pout)
        if al <= 0.001: continue
        if kind == 'label': layer = card(text, size, tracking=0.32, font_path=SANS_B, color=col); glow, dk = 0.35, 0.3
        elif kind == 'pill': layer = pill(text, size, color=col); glow, dk = 0.0, 0.35
        elif kind == 'counter': layer = counter_card(counter_value(f), size); glow, dk = 0.3, 0.4
        elif kind == 'small': layer = card(text, size, tracking=0.2, font_path=SANS_B, color=col); glow, dk = 0.0, 0.35
        else: layer = card(text, size, color=col); glow, dk = 0.25, 0.45
        place(img, layer, W / 2, H * y + (1 - pin) * 10, alpha=al, blur=(1 - pin) * 4, glow=glow, darken=dk)

def read_frame(path):
    if not os.path.exists(path): return None
    if open(path, 'rb').read(4) == b'\x76\x2f\x31\x01':
        import OpenEXR
        with OpenEXR.File(path) as fx: rgb = fx.channels()['RGB'].pixels.astype(np.float32)
        return np.ascontiguousarray(rgb[..., ::-1])
    a = cv2.imread(path, cv2.IMREAD_UNCHANGED)
    return None if a is None else a[..., :3].astype(np.float32)
FLASH = {46: 1.25, 47: 1.1} if HOOK in 'ac' else {46: 1.12}
OFFSET = int(arg('--offset', '0'))
def process(f):
    lin = read_frame(os.path.join(IN, f'f{f:04d}.hdr'))
    if lin is None: raise SystemExit(f'missing frame {f}')
    if lin.shape[:2] != (H, W): lin = cv2.resize(lin, (W, H), interpolation=cv2.INTER_CUBIC)
    g = f + OFFSET
    img = grade(lin * FLASH.get(g, 1.0), g)[..., [2, 1, 0]].copy()
    if '--no-type' not in args: typography(img, g)
    Image.fromarray((np.clip(img, 0, 1) * 255 + 0.5).astype(np.uint8)).save(os.path.join(OUT, f'p{g:04d}.png'), compress_level=1)

os.makedirs(OUT, exist_ok=True)
if arg('--list'): frames = [int(x) for x in arg('--list').split(',')]
else:
    a, b = (int(x) for x in arg('--frames', '1-90').split('-')); frames = range(a, b + 1)
for f in frames:
    process(f); print('post', f, flush=True)
