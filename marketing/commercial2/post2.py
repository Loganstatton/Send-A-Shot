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
    while max(sum(font.getlength(c) + size * tracking for c in ln) for ln in lines) > max_w and size > 30:
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
def typography(img, f):
    # SCENE 1 (frames 2–57): the hook, readable from the second frame, sound off
    if 1 <= f <= 57:
        o = fade(f, 53, 5); st = slam(f, 0, 4)
        if HOOK == 'a':
            lay = layer_text(['I FOUND', 'THEM FIRST.'], 168, lambda li, ci: EMBER if (li == 1 and ci >= 5) else WHITE)
        elif HOOK == 'b':
            lay = layer_text(['WAIT… YOU CAN', 'TRADE MUSIC', 'ARTISTS?'], 128, lambda li, ci: EMBER if li == 1 else WHITE)
        else:
            lay = layer_text(['CAN YOU FIND', 'THE NEXT BIG', 'ARTIST?'], 132, lambda li, ci: EMBER if li == 1 else WHITE)
        place(img, lay, 420, scale=st['scale'] * (1 + 0.08 * (1 - o)), alpha=st['alpha'] * o, blur=st['blur'] + (1 - o) * 8, glow=st['glow'])
    # SCENE 2 (frames 61–118): PROVE IT.
    if 61 <= f <= 118:
        st = slam(f, 60, 4); st['alpha'] *= fade(f, 114, 5)
        place(img, layer_text(['PROVE IT.'], 230, lambda li, ci: EMBER if ci >= 6 else WHITE), 300, **st)

def scrim(f):
    if 1 <= f <= 57: return 0.55 * fade(f, 53, 5)
    if 61 <= f <= 118: return 0.45 * smooth((f - 60) / 4) * fade(f, 114, 5)
    return 0.0

OFFSET = int(arg('--offset', '0'))
def process(f):
    lin = cv2.imread(os.path.join(IN, f'f{f:04d}.hdr'), cv2.IMREAD_UNCHANGED)
    if lin is None: raise SystemExit(f'missing frame {f}')
    lin = lin[..., :3].astype(np.float32)
    if lin.shape[1] != W: lin = cv2.resize(lin, (W, H), interpolation=cv2.INTER_CUBIC)
    g = f + OFFSET
    lin *= {60: 1.25, 61: 1.9, 62: 1.35, 63: 1.1}.get(g, 1.0)          # the drop: a flash on the beat
    img = grade(lin, g)[..., [2, 1, 0]].copy()
    k = scrim(g)
    if k > 0: img *= 1 - k * SCRIM_TOP
    if '--no-type' not in args: typography(img, g)
    Image.fromarray((np.clip(img, 0, 1) * 255 + 0.5).astype(np.uint8)).save(os.path.join(OUT, f'p{g:04d}.png'), compress_level=1)

os.makedirs(OUT, exist_ok=True)
if arg('--list'): frames = [int(x) for x in arg('--list').split(',')]
else:
    a, b = (int(x) for x in arg('--frames', '1-120').split('-')); frames = range(a, b + 1)
for f in frames:
    process(f); print('post', f, flush=True)
