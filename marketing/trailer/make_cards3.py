"""Card textures for the trailer's world of artists (Scene 2).

Takes the real NEXT Discover cards captured for Ad #2 (card-2..8.png: the app's own
layout with demo artists) and makes colour variants of each by rotating the hue of
the cover art only. Names, game values and every UI element stay exactly as captured.

  post-venv/bin/python make_cards3.py AD2_ASSETS OUT_DIR
"""
import os, sys, glob
import numpy as np
from PIL import Image

SRC, OUT = sys.argv[1], sys.argv[2]
os.makedirs(OUT, exist_ok=True)
COVER = 402                  # cover art = the top 402 px of a 764 px wide card
SHIFTS = (0, 70, 150, 225)   # hue rotations in degrees (0 = the original)
n = 0
for path in sorted(glob.glob(os.path.join(SRC, 'card-[2-8].png'))):
    im = Image.open(path).convert('RGBA')
    for deg in SHIFTS:
        out = im.copy()
        if deg:
            top = out.crop((0, 0, im.width, COVER))
            hsv = np.array(top.convert('RGB').convert('HSV')).astype(np.int16)
            hsv[..., 0] = (hsv[..., 0] + int(deg / 360 * 255)) % 256
            rgb = Image.fromarray(hsv.astype(np.uint8), 'HSV').convert('RGB')
            out.paste(Image.merge('RGBA', (*rgb.split(), top.split()[3])), (0, 0))
        out.save(os.path.join(OUT, f'c{n:02d}.png')); n += 1
print('wrote', n, 'cards')
