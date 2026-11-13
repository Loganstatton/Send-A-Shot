"""Face of the Founding Believer hero card (1200x1800 PNG) for the ad's payoff
shot. Every fact on it comes from the app's own record for the on-camera
purchase (juno.json written by capture_screens.js): the tier the app gives
discovery rank 1 ("Genesis Founder"), the backer number, the lock date, the
app's card serial format, the buy price and the backer count.

  post-venv/bin/python make_card.py ASSETS_DIR COVER.jpg
"""
import json, math, os, sys
from datetime import datetime
import numpy as np
from PIL import Image, ImageDraw, ImageFilter, ImageFont

HERE = os.path.dirname(os.path.abspath(__file__))
ASSETS, COVER = sys.argv[1], sys.argv[2]
J = json.load(open(os.path.join(ASSETS, 'juno.json')))
W, H = 1200, 1800
F = lambda name, size: ImageFont.truetype(os.path.join(HERE, 'fonts', name), size)
DISPLAY, MONO, SANS, SANS_SB = 'BricolageGrotesque-ExtraBold.ttf', 'IBMPlexMono-Medium.ttf', 'IBMPlexSans-Medium.ttf', 'IBMPlexSans-SemiBold.ttf'
EMBER, PAPER, MUTED, GOLD = (253, 104, 68), (243, 242, 237), (176, 166, 156), (255, 196, 120)

ARTIST, PLAYER = 'Juno Marrow', 'Maya Chen'
rank = J['founding_believer']['rank']
locked = datetime.fromisoformat(J['founding_believer']['at'].replace('Z', '+00:00')).strftime('%b %-d, %Y').upper()
serial = 'FB-' + ''.join(w[0] for w in ARTIST.split())[:3].upper() + '-' + str(rank).zfill(6)
buy = J['buy']['price'] / 100
tier = 'GENESIS FOUNDER' if rank == 1 else 'FOUNDING BELIEVER'

# ---------------------------------------------------------------- background: deep black lacquer + ember glow + guilloche
yy, xx = np.mgrid[0:H, 0:W].astype(np.float32)
r = np.hypot((xx - W * 0.5) / W, (yy - H * 0.28) / H)
base = np.zeros((H, W, 3), np.float32) + np.array([10, 7, 6], np.float32)
base += np.clip(1 - r * 1.9, 0, 1)[..., None] ** 2.2 * np.array([90, 26, 12], np.float32)
# fine engraved guilloche (two interfering wave families), very faint
g = (np.sin((xx * 0.9 + yy * 0.5) * 0.11 + 6 * np.sin(yy * 0.004)) * np.sin((xx * -0.6 + yy * 0.8) * 0.09 + 5 * np.sin(xx * 0.005)))
base += (np.abs(g) < 0.06)[..., None] * np.array([22, 12, 9], np.float32)
img = Image.fromarray(np.clip(base, 0, 255).astype(np.uint8)).convert('RGBA')
d = ImageDraw.Draw(img)

def center(text, font, y, fill, tracking=0.0):
    widths = [font.getlength(c) + font.size * tracking for c in text]
    x = (W - (sum(widths) - font.size * tracking)) / 2
    for c, w in zip(text, widths):
        d.text((x, y), c, font=font, fill=fill); x += w

M = 70
# inner hairline frame
d.rounded_rectangle((M - 26, M - 26, W - M + 26, H - M + 26), 46, outline=(120, 52, 34), width=3)

# header: wordmark + serial
d.text((M, M), 'NEXT', font=F(DISPLAY, 58), fill=PAPER)
nx = M + F(DISPLAY, 58).getlength('NEXT') + 16
d.ellipse((nx, M + 38, nx + 16, M + 54), fill=EMBER)
sf = F(MONO, 34); d.text((W - M - sf.getlength(serial), M + 14), serial, font=sf, fill=MUTED)

# cover art with an ember ring
cs = 560; cx0, cy0 = (W - cs) // 2, 200
cov = Image.open(COVER).convert('RGB').resize((cs, cs), Image.LANCZOS)
mask = Image.new('L', (cs, cs), 0); ImageDraw.Draw(mask).rounded_rectangle((0, 0, cs - 1, cs - 1), 48, fill=255)
glow = Image.new('RGBA', (W, H), (0, 0, 0, 0)); gd = ImageDraw.Draw(glow)
gd.rounded_rectangle((cx0 - 14, cy0 - 14, cx0 + cs + 14, cy0 + cs + 14), 60, outline=(*EMBER, 255), width=10)
img = Image.alpha_composite(img, glow.filter(ImageFilter.GaussianBlur(22)))
img.paste(cov, (cx0, cy0), mask)
d = ImageDraw.Draw(img)
d.rounded_rectangle((cx0 - 6, cy0 - 6, cx0 + cs + 6, cy0 + cs + 6), 54, outline=EMBER, width=5)

# tier pill
pf = F(MONO, 34); pt = tier
pw = pf.getlength(pt) + 116; px = (W - pw) / 2; py = 812
d.rounded_rectangle((px, py, px + pw, py + 70), 35, fill=(38, 18, 12), outline=GOLD, width=3)
dx, dy = px + 50, py + 35      # a small diamond marker
d.polygon([(dx, dy - 13), (dx + 13, dy), (dx, dy + 13), (dx - 13, dy)], fill=GOLD)
d.text((px + 81, py + 13), pt, font=pf, fill=GOLD)

# artist + feature name
center(ARTIST.upper(), F(DISPLAY, 112), 916, PAPER, 0.01)
center('FOUNDING BELIEVER', F(MONO, 40), 1062, EMBER, 0.28)

# the number: BACKER #1
d.line((M + 40, 1150, W - M - 40, 1150), fill=(90, 40, 28), width=2)
center('BACKER', F(MONO, 44), 1186, MUTED, 0.5)
num = Image.new('RGBA', (W, 300), (0, 0, 0, 0)); nd = ImageDraw.Draw(num)
nf = F(DISPLAY, 250); t = f'#{rank}'
nd.text(((W - nf.getlength(t)) / 2, -10), t, font=nf, fill=(255, 255, 255, 255))
na = np.array(num).astype(np.float32)
grad = np.linspace(0, 1, 300, dtype=np.float32)[:, None]
na[..., 0] = 255; na[..., 1] = 214 - 120 * grad; na[..., 2] = 150 - 110 * grad     # gold → ember
img.alpha_composite(Image.fromarray(np.clip(na, 0, 255).astype(np.uint8)), (0, 1238))
d = ImageDraw.Draw(img)

# who, when, proof
center(f'{PLAYER.upper()}  ·  LOCKED {locked}', F(MONO, 34), 1530, PAPER, 0.06)
center(f'Backed at ${buy:.2f}  ·  First of {J["backers"]} backers', F(SANS, 36), 1588, MUTED)
lk = F(SANS_SB, 34); lt = 'PERMANENT RECORD — stays on your profile, even if you sell'
center(lt, lk if lk.getlength(lt) < W - 2 * M else F(SANS_SB, 30), 1660, (236, 150, 120))

out = os.path.join(ASSETS, 'card-hero.png')
img.convert('RGB').save(out)
print('wrote', out, serial, locked)
