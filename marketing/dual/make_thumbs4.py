"""Thumbnails for SCOUT × NEXT — "BEFORE THE BREAKOUT", from the finished, graded frames.

  post-venv/bin/python make_thumbs4.py OUT_DIR      (reads OUT_DIR/frames_v, frames_w)

  SCOUT-NEXT-thumb-reveal[-16x9].png      both products and SCOUT × NEXT (global frame 1120), with the campaign title
  SCOUT-NEXT-thumb-connection[-16x9].png  the glass panel turning from SCOUT cyan to NEXT orange (frame 418)
"""
import os, sys
import numpy as np
from PIL import Image, ImageDraw, ImageFont, ImageFilter

OUT = sys.argv[1]
HERE = os.path.dirname(os.path.abspath(__file__))
INTER_B = os.path.join(HERE, 'fonts', 'Inter-700.ttf'); INTER_M = os.path.join(HERE, 'fonts', 'Inter-500.ttf')

def tracked(draw, cx, y, text, font, fill, tracking):
    ws = [font.getlength(c) + font.size * tracking for c in text]; x = cx - (sum(ws) - font.size * tracking) / 2
    for c, w in zip(text, ws): draw.text((x, y), c, font=font, fill=fill); x += w

for fmt, sfx in (('v', ''), ('w', '-16x9')):
    for name, frame, top in (('reveal', 1120, False), ('connection', 418, True)):
        im = Image.open(os.path.join(OUT, f'frames_{fmt}', f'p{frame:04d}.png')).convert('RGB')
        W, H = im.size
        # a soft dark band where the title sits
        band = np.zeros((H, W), np.float32); y0 = int(H * (0.04 if top else 0.74)); y1 = int(H * (0.2 if top else 0.97))
        band[y0:y1] = 1.0; band = np.array(Image.fromarray((band * 255).astype(np.uint8)).filter(ImageFilter.GaussianBlur(H * 0.04))) / 255.0
        arr = np.asarray(im).astype(np.float32) * (1 - 0.6 * band[..., None])
        im = Image.fromarray(arr.clip(0, 255).astype(np.uint8)); d = ImageDraw.Draw(im)
        s = W / 1080 if fmt == 'v' else H / 1080 * 0.9
        f1 = ImageFont.truetype(INTER_B, int(74 * s)); f2 = ImageFont.truetype(INTER_M, int(25 * s))
        ty = H * (0.075 if top else 0.82)
        tracked(d, W / 2, ty, 'BEFORE THE BREAKOUT', f1, (243, 242, 237), 0.12)
        tracked(d, W / 2, ty + 100 * s, 'SCOUT DISCOVERS THE TALENT. NEXT LETS THE WORLD BACK IT.', f2, (214, 226, 236), 0.14)
        im.save(os.path.join(OUT, f'SCOUT-NEXT-thumb-{name}{sfx}.png'))
        print('thumb', name, fmt)
