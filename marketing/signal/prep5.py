"""Textures for "THE SIGNAL", cut from the real captures only (capture_signal.js).

  post-venv/bin/python prep5.py SCREENS_DIR ASSETS_DIR COVERS_DIR

Writes into ASSETS_DIR (plus a copy of every capture):
  scout-queue.png            SCOUT's New Candidates queue, ultrawide 4200x1800
  scout-queue-approve.png    the same, with Juno's real card in its Approve-hover state placed where
                             the app draws it (template matching, not guessed)
  scout-dash-after.png       the Discovery dashboard after the approval: "1 approved"
  scout-rate-{a,b,c}.png     the artist page scrolled to the rating panel: all at 5 / first four set
                             by hand / all eight set (real captures of the sliders)
  scout-rated.png            the artist page after saving: 86.0 and the score breakdown
  scout-panel.png            Juno's evaluated SCOUT profile (header + breakdown) for the glass tile
  next-card.png, slots.json  Juno's real "Featured · Scouts' pick" card on NEXT Discover, and where it sits
  panel-{portfolio,leaders,feed}.png   NEXT screens for the three community panels
  juno-tile.png              the demo artist's identity tile: her abstract cover + a waveform (ad graphic)
  juno.json                  the record for the Founding Believer card (../commercial/make_card.py)
"""
import json, os, shutil, sys
import cv2, numpy as np
from PIL import Image, ImageDraw, ImageFont

SCR, A, COV = sys.argv[1:4]
os.makedirs(A, exist_ok=True)
for f in os.listdir(SCR): shutil.copy(os.path.join(SCR, f), os.path.join(A, f))
P = lambda n: os.path.join(A, n)
HERE = os.path.dirname(os.path.abspath(__file__))
FONTS = os.path.join(HERE, '..', 'dual', 'fonts')

def locate(page, tpl, rows=200, need=0.99):
    r = cv2.matchTemplate(page, tpl[:min(tpl.shape[0], rows)], cv2.TM_CCOEFF_NORMED)
    _, score, _, loc = cv2.minMaxLoc(r)
    assert score > need, f'template not found ({score:.3f})'
    return loc

# ---- SCOUT
# SCOUT pages are captured full-length; each screen is a 21:9 window of the page (as if scrolled)
UW = 1800
qf = cv2.imread(P('s02-queue.png'))
cx, cy = locate(qf, cv2.imread(P('s02b-juno-candidate.png')))
hov = cv2.imread(P('s02c-juno-approve-hover.png'))
top = max(0, min(cy + hov.shape[0] + 80 - UW, qf.shape[0] - UW))
hh, ww = min(hov.shape[0], qf.shape[0] - cy), min(hov.shape[1], qf.shape[1] - cx)   # fractional device scale: sizes can differ by a pixel
qfa = qf.copy(); qfa[cy:cy + hh, cx:cx + ww] = hov[:hh, :ww]
def win(img, t): out = img[t:t + UW]; return np.vstack([out, np.repeat(out[-1:], UW - out.shape[0], 0)]) if out.shape[0] < UW else out
q, qa = win(qf, top), win(qfa, top); cy -= top
cv2.imwrite(P('scout-queue.png'), q)
cv2.imwrite(P('scout-queue-before.png'), win(cv2.imread(P('s03c-queue-after.png')), top))     # the queue before her submission arrives
cv2.imwrite(P('scout-queue-approve.png'), qa)
json.dump({'juno_row': {'x': cx, 'y': cy, 'w': hov.shape[1], 'h': hov.shape[0], 'W': q.shape[1], 'H': q.shape[0]}}, open(P('scout-slots.json'), 'w'))
d = cv2.imread(P('s03d-dashboard-after.png')); cv2.imwrite(P('scout-dash-after.png'), win(d, 0))
rated = win(cv2.imread(P('s04c-rated-page.png')), 0); cv2.imwrite(P('scout-rated.png'), rated)
hdr, brk = cv2.imread(P('s04-rated-header.png')), cv2.imread(P('s04b-breakdown.png'))
hx, hy = locate(rated, hdr)
bg = tuple(int(c) for c in rated[hy - 20, 40])
nav_h = hy - 24                                                   # the app's own top bar, as on the page
for k in 'abc':
    g = cv2.imread(P(f's05{k}-rating-' + {'a': 'start', 'b': 'group1', 'c': 'group2'}[k] + '.png'))
    can = np.full((rated.shape[0] if rated.shape[0] < 1800 else 1800, rated.shape[1], 3), bg, np.uint8)
    can[:nav_h] = rated[:nav_h]
    y0 = hy + 110; h = min(g.shape[0], 1800 - y0)
    h = min(h, can.shape[0] - y0); can[y0:y0 + h, hx:hx + g.shape[1]] = g[:h]
    cv2.imwrite(P(f'scout-rate-{k}.png'), can)
    if k == 'a': json.dump({'grid': {'x': hx, 'y': y0, 'w': g.shape[1], 'h': h, 'W': can.shape[1], 'H': can.shape[0]}}, open(P('rate-slots.json'), 'w'))
pad = 64
pw = max(hdr.shape[1], brk.shape[1]) + 2 * pad; ph = hdr.shape[0] + 40 + brk.shape[0] + 2 * pad
panel = np.full((ph, pw, 3), bg, np.uint8)
panel[pad:pad + hdr.shape[0], pad:pad + hdr.shape[1]] = hdr
panel[pad + hdr.shape[0] + 40:pad + hdr.shape[0] + 40 + brk.shape[0], pad:pad + brk.shape[1]] = brk
cv2.imwrite(P('scout-panel.png'), panel)
json.dump({'x': hx - pad, 'y': hy - pad, 'w': pw, 'h': ph, 'W': rated.shape[1], 'H': rated.shape[0],
           'badge_y': hy + hdr.shape[0] // 2, 'badge_x': hx + int(hdr.shape[1] * 0.85)}, open(P('panel-slot.json'), 'w'))

# ---- NEXT
def rounded(im, r):
    m_ = Image.new('L', im.size, 0); ImageDraw.Draw(m_).rounded_rectangle((0, 0, im.width - 1, im.height - 1), r, fill=255)
    im = im.convert('RGBA'); im.putalpha(m_); return im
grid = Image.open(P('n02-discover-grid.png')).convert('RGB')
x0, y0, x1, y1 = 83, 99, 1479, 2304                                # the featured card's bounds on this layout (390 px wide at 4x)
card = rounded(grid.crop((x0, y0, x1, y1)), 92); card.save(P('next-card.png'))
json.dump({'featured_card': {'u': (x0 + x1) / 2 / grid.width, 'v': (y0 + y1) / 2 / grid.height,
                             'w': (x1 - x0) / grid.width, 'h': (y1 - y0) / grid.height}}, open(P('slots.json'), 'w'), indent=2)
for name, src in (('portfolio', 'n08-portfolio.png'), ('leaders', 'n09-leaderboard.png'), ('feed', 'n12-feed.png')):
    rounded(Image.open(P(src)).convert('RGB').crop((0, 0, 1560, 2900)), 90).save(P(f'panel-{name}.png'))

# ---- the identity tile (an ad graphic, not app UI): cover + waveform + name
W_, H_ = 1200, 1560
tile = Image.new('RGB', (W_, H_), (14, 10, 10)); dr = ImageDraw.Draw(tile)
cov = Image.open(os.path.join(COV, 'cover5.jpg')).convert('RGB').resize((1080, 1080))
tile.paste(rounded(cov, 48), (60, 60), rounded(cov, 48))
rng = np.random.default_rng(5)
n = 64; xs = np.linspace(110, W_ - 110, n)
env = 0.25 + 0.75 * np.abs(np.sin(np.linspace(0, 3.1, n) * 2.3)) * np.exp(-((np.linspace(-1, 1, n)) ** 2) * 0.8)
for x, e in zip(xs, env * (0.7 + 0.3 * rng.random(n))):
    h = 8 + e * 110
    dr.rounded_rectangle((x - 5, 1240 - h / 2, x + 5, 1240 + h / 2), 5, fill=(253, 104, 68))
fb, fm = ImageFont.truetype(os.path.join(FONTS, 'Inter-700.ttf'), 74), ImageFont.truetype(os.path.join(FONTS, 'Inter-500.ttf'), 40)
dr.text((W_ / 2, 1390), 'JUNO MARROW', font=fb, fill=(243, 242, 237), anchor='mm')
dr.text((W_ / 2, 1468), 'R&B  ·  DEMO ARTIST', font=fm, fill=(176, 166, 156), anchor='mm')
rounded(tile, 60).save(P('juno-tile.png'))

# ---- the Founding Believer record, for make_card.py
J = json.load(open(P('journey.json')))
json.dump({'founding_believer': J['founding_believer'], 'buy': J['maya_buy'], 'backers': 12}, open(P('juno.json'), 'w'))
print('ok', q.shape, panel.shape, card.size, 'juno row', cx, cy)
