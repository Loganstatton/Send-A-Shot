"""Facebook cover for NEXT (1640x924: phones show all of it, desktop shows the middle
1640x624 band, and the profile picture overlaps the bottom-left — key content stays clear).

Left: the campaign line + one-line pitch + COMING SOON. Right: the rendered Backer #1 card
from Ad #2 (a graded frame, passed in). Behind: a glowing rising line drawn from the demo
artist's in-app price history (juno.json), with a faint price grid.

  python make_banner.py CARD_FRAME.png JUNO_JSON OUT.png
"""
import json, os, sys
import numpy as np
from PIL import Image, ImageChops, ImageDraw, ImageFilter, ImageFont

HERE = os.path.dirname(os.path.abspath(__file__))
FONTS = os.path.join(HERE, '..', 'commercial', 'fonts')
DISP, SANS, SANS_SB = (os.path.join(FONTS, f) for f in ('BricolageGrotesque-ExtraBold.ttf', 'IBMPlexSans-Medium.ttf', 'IBMPlexSans-SemiBold.ttf'))
EMBER, INK, PAPER, MUTED = (253, 104, 68), (16, 9, 8), (243, 242, 237), (190, 182, 172)
W, H = 1640, 924
BAND = ((H - 624) // 2, (H + 624) // 2)                    # the desktop-visible band (150..774)
card_path, juno_path, out_path = sys.argv[1:4]

# background: ink with a warm glow behind the card
yy, xx = np.mgrid[0:H, 0:W].astype(np.float32)
glow = np.clip(1 - np.hypot((xx - W * 0.76) / (W * 0.42), (yy - H * 0.5) / (H * 0.7)), 0, 1) ** 1.8
bg = np.array(INK, np.float32) + glow[..., None] * np.array((70, 26, 14), np.float32)
img = Image.fromarray(bg.clip(0, 255).astype(np.uint8)).convert('RGBA')
d = ImageDraw.Draw(img)
for k in range(6):                                         # faint price grid
    y = BAND[0] + 40 + k * 105
    d.line((0, y, W, y), fill=(60, 30, 22, 255), width=1)

# the rising line: Juno Marrow's in-app history (Maya's buy at $44.03 → $51.10 after 14 more backers)
hist = json.load(open(juno_path))['history']
vals = np.interp(np.linspace(0, len(hist) - 1, 240), np.arange(len(hist)), hist)
x = np.linspace(-20, W * 0.92, len(vals))
lo, hi = vals.min(), vals.max()
y = BAND[1] - 70 - (vals - lo) / (hi - lo) * 430
pts = list(zip(x, y))
fill = Image.new('RGBA', img.size, (0, 0, 0, 0)); fd = ImageDraw.Draw(fill)
fd.polygon(pts + [(x[-1], BAND[1] + 200), (x[0], BAND[1] + 200)], fill=(*EMBER, 34))
fill = fill.filter(ImageFilter.GaussianBlur(6))
fa = np.asarray(fill).copy(); ramp = np.clip((x[-1] - np.arange(W)) / 260, 0, 1)          # fade out before the line ends
fa[..., 3] = (fa[..., 3] * ramp[None, :]).astype(np.uint8)
img.alpha_composite(Image.fromarray(fa))
line = Image.new('RGBA', img.size, (0, 0, 0, 0)); ld = ImageDraw.Draw(line)
ld.line(pts, fill=(*EMBER, 255), width=5, joint='curve')
img.alpha_composite(line.filter(ImageFilter.GaussianBlur(14))); img.alpha_composite(line.filter(ImageFilter.GaussianBlur(4)))
ld2 = ImageDraw.Draw(img); ld2.line(pts, fill=(255, 196, 160, 255), width=3, joint='curve')
hx, hy = pts[-1]; ld2.ellipse((hx - 9, hy - 9, hx + 9, hy + 9), fill=(255, 220, 200, 255))

# the Backer #1 card (rendered frame), feathered into the background
card = Image.open(card_path).convert('RGB').crop((40, 240, 1040, 1700))   # card + its rim light
ch = 600; cw = int(card.width * ch / card.height)
card = card.resize((cw, ch), Image.LANCZOS)
cy_, cx_ = np.mgrid[0:ch, 0:cw]
m = np.clip(1.15 - np.maximum(np.abs(cx_ - cw / 2) / (cw / 2), np.abs(cy_ - ch / 2) / (ch / 2)) ** 3 * 1.15, 0, 1) ** 1.5
ox, oy = int(W * 0.765 - cw / 2), (H - ch) // 2
base = img.convert('RGB'); region = base.crop((ox, oy, ox + cw, oy + ch))
sc = ch / 1460                                            # the card body inside the crop (measured on the frame)
cm = Image.new('L', (cw, ch), 0)
ImageDraw.Draw(cm).rounded_rectangle((44 * sc, 54 * sc, 956 * sc, 1402 * sc), int(46 * sc), fill=255)
halo = cm.filter(ImageFilter.GaussianBlur(22))             # the rim light, following the card's outline
lit = ImageChops.lighter(region, card)                    # the card's light adds; its black surround never darkens the cover
blend = Image.composite(lit, region, halo)
blend.paste(card.convert('RGB'), (0, 0), cm.filter(ImageFilter.GaussianBlur(2)))   # the card itself stays solid
base.paste(blend, (ox, oy)); img = base.convert('RGBA')

# type (left, inside the desktop band, above the profile-picture corner)
def text(xy, s, font, fill, track=0.0):
    x0, y0 = xy
    for c in s:
        ImageDraw.Draw(img).text((x0, y0), c, font=font, fill=fill); x0 += font.getlength(c) + font.size * track
    return x0
X = 120
big = ImageFont.truetype(DISP, 118)
shadow = Image.new('RGBA', img.size, (0, 0, 0, 0)); sd = ImageDraw.Draw(shadow)
sd.rectangle((X - 40, BAND[0] + 10, X + 760, BAND[0] + 470), fill=(0, 0, 0, 120))
img.alpha_composite(shadow.filter(ImageFilter.GaussianBlur(60)))
text((X, BAND[0] + 22), 'FIND THEM', big, PAPER, 0.005)
text((X, BAND[0] + 22 + 118), 'FIRST.', big, EMBER, 0.005)
sub = ImageFont.truetype(SANS, 31)
for i, ln in enumerate(('Discover tomorrow’s artists. Back them with', 'virtual Credits. Prove you were early.')):
    text((X + 4, BAND[0] + 296 + i * 42), ln, sub, MUTED)
pf = ImageFont.truetype(SANS_SB, 34); label = 'COMING SOON'
pw = pf.getlength(label) + 64; py = BAND[0] + 396
ImageDraw.Draw(img).rounded_rectangle((X, py, X + pw, py + 62), 31, fill=EMBER)
text((X + 32, py + 9), label, pf, INK)
small = ImageFont.truetype(SANS, 20)
text((X + pw + 22, py + 20), 'Virtual Credits · no cash value · demo artist shown', small, (130, 122, 114))

img.convert('RGB').save(out_path)
print('wrote', out_path, img.size)
