"""Floating panels for the trailer's market scene, cropped from the real NEXT
screens captured for Ad #2 (demo artist Juno Marrow, demo player): trade history
(06-backed: "Recent activity · Bought · $250.00") and the portfolio summary
(07-portfolio). The artist-info panel is Ad #2's panel-juno.png as is.

  post-venv/bin/python make_panels3.py ASSETS_DIR     (writes panel-history.png, panel-portfolio.png there)
"""
import os, sys
from PIL import Image, ImageDraw
A = sys.argv[1]
def rounded(im, r):
    m = Image.new('L', im.size, 0); ImageDraw.Draw(m).rounded_rectangle((0, 0, im.width - 1, im.height - 1), r, fill=255)
    im = im.convert('RGBA'); im.putalpha(m); return im
rounded(Image.open(os.path.join(A, '06-backed.png')).crop((82, 597, 1478, 1113)), 70).save(os.path.join(A, 'panel-history.png'))
rounded(Image.open(os.path.join(A, '07-portfolio.png')).crop((82, 1150, 1478, 2560)), 70).save(os.path.join(A, 'panel-portfolio.png'))
print('ok')
