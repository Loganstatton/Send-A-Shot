"""Textures for the SCOUT -> NEXT transition, cut from the real captures only.

  post-venv/bin/python prep_dual.py ASSETS_DIR

Writes into ASSETS_DIR:
  scout-profile-screen.png  the SCOUT artist page after the scout's rating (3200x1800):
                            the real page capture with the rated header and score
                            breakdown placed exactly where the app draws them
                            (positions found by template matching, not guessed)
  scout-panel.png           Juno's evaluated SCOUT profile (header + breakdown) for the glass panel
  scout-scores-screen.png   the same page scrolled to the rating panel (8 categories, weights, 86.0)
  next-card.png             Juno's real "Featured · Scouts' pick" card from NEXT Discover (rounded, RGBA)
  panel-*.png               trade history, portfolio and leaderboard panels cut from the NEXT captures
  slots.json                where that card sits on the NEXT Discover screen (UV), so the panel lands on it
"""
import json, os, sys
import cv2, numpy as np
from PIL import Image, ImageDraw

A = sys.argv[1]
P = lambda n: os.path.join(A, n)

def locate(page, tpl, rows=200):
    r = cv2.matchTemplate(page, tpl[:min(tpl.shape[0], rows)], cv2.TM_CCOEFF_NORMED)
    _, score, _, loc = cv2.minMaxLoc(r)
    assert score > 0.99, f'template not found ({score:.3f})'
    return loc

page = cv2.imread(P('s03b-approved-page.png'))
hdr_new, brk_new = cv2.imread(P('s04-rated-header.png')), cv2.imread(P('s04b-breakdown.png'))
hx, hy = locate(page, cv2.imread(P('s03-approved-header.png')))
bx, by = locate(page, brk_new)
out = page.copy()
out[hy:hy + hdr_new.shape[0], hx:hx + hdr_new.shape[1]] = hdr_new
h = min(brk_new.shape[0], out.shape[0] - by)
out[by:by + h, bx:bx + brk_new.shape[1]] = brk_new[:h]
cv2.imwrite(P('scout-profile-screen.png'), out)

# the glass panel: header + breakdown on the page background, with margins
bg = tuple(int(c) for c in page[hy - 20, 40])
pad = 64
pw = hdr_new.shape[1] + 2 * pad; ph = hdr_new.shape[0] + 40 + brk_new.shape[0] + 2 * pad
panel = np.full((ph, pw, 3), bg, np.uint8)
panel[pad:pad + hdr_new.shape[0], pad:pad + hdr_new.shape[1]] = hdr_new
panel[pad + hdr_new.shape[0] + 40:pad + hdr_new.shape[0] + 40 + brk_new.shape[0], pad:pad + brk_new.shape[1]] = brk_new
cv2.imwrite(P('scout-panel.png'), panel)

# the same page scrolled to the scout's rating panel (the real panel, on the page's own background)
form = cv2.imread(P('s05-scorecard-form.png'))                     # the whole rating form, captured as one element
cv2.imwrite(P('s05c-score-inputs.png'), form[4150:5370, :])         # its "Breakout Score inputs" block (read off the capture)
scores = cv2.imread(P('s05c-score-inputs.png'))
scr2 = np.full_like(page, bg)
y0 = (scr2.shape[0] - scores.shape[0]) // 2
scr2[y0:y0 + scores.shape[0], hx:hx + scores.shape[1]] = scores
cv2.imwrite(P('scout-scores-screen.png'), scr2)

# floating NEXT panels (same crop regions the reveal trailer used on the same app layout)
def rounded(im, r):
    m_ = Image.new('L', im.size, 0); ImageDraw.Draw(m_).rounded_rectangle((0, 0, im.width - 1, im.height - 1), r, fill=255)
    im = im.convert('RGBA'); im.putalpha(m_); return im
rounded(Image.open(P('n06-backed.png')).crop((82, 597, 1478, 1113)), 70).save(P('panel-history.png'))
rounded(Image.open(P('n08-portfolio.png')).crop((82, 1150, 1478, 2560)), 70).save(P('panel-portfolio.png'))
rounded(Image.open(P('n09b-leaderboard-rows.png')).crop((82, 1082, 1478, 2734)), 70).save(P('panel-leaders.png'))

# Juno's featured card on NEXT Discover (bounds read off the capture)
grid = Image.open(P('n02-discover-grid.png')).convert('RGB')
x0, y0, x1, y1 = 83, 99, 1479, 2304
card = grid.crop((x0, y0, x1, y1)).convert('RGBA')
m = Image.new('L', card.size, 0); ImageDraw.Draw(m).rounded_rectangle((0, 0, card.width - 1, card.height - 1), 92, fill=255)
card.putalpha(m); card.save(P('next-card.png'))
json.dump({'featured_card': {'u': (x0 + x1) / 2 / grid.width, 'v': (y0 + y1) / 2 / grid.height,
                             'w': (x1 - x0) / grid.width, 'h': (y1 - y0) / grid.height}}, open(P('slots.json'), 'w'), indent=2)
print('ok', out.shape, panel.shape, card.size)
