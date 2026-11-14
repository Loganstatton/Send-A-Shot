"""Cinematic thumbnails for "THE SIGNAL", from the finished, graded frames.

  post-venv/bin/python make_thumbs5.py OUT_DIR      (reads untitled grades: OUT_DIR/thumbsrc_{v,w}/p####.png)

  THE-SIGNAL-thumb-card[-16x9].png       the Backer #1 card in its light (frame 1530), campaign title
  THE-SIGNAL-thumb-waveform[-16x9].png   the chart become a waveform (frame 46): THIS ISN'T A STOCK. IT'S AN ARTIST.
"""
import os, sys
import numpy as np
from PIL import Image, ImageDraw, ImageFont, ImageFilter

OUT = sys.argv[1]
HERE = os.path.dirname(os.path.abspath(__file__))
F = lambda n, s: ImageFont.truetype(os.path.join(HERE, '..', 'dual', 'fonts', n), s)
DISP = os.path.join(HERE, '..', 'commercial', 'fonts', 'BricolageGrotesque-ExtraBold.ttf')
def tracked(d, cx, y, text, font, fill, tr):
    ws = [font.getlength(c) + font.size * tr for c in text]; x = cx - (sum(ws) - font.size * tr) / 2
    for c, w in zip(text, ws): d.text((x, y), c, font=font, fill=fill); x += w
for fmt, sfx in (('v', ''), ('w', '-16x9')):
    for name, frame, lines in (('card', 1530, ('THE SIGNAL', 'BACK AN ARTIST FIRST. IT\'S ON THE RECORD.')),
                               ('waveform', 46, ('THIS ISN\'T A STOCK.', 'IT\'S AN ARTIST.'))):
        p = os.path.join(OUT, f'thumbsrc_{fmt}', f'p{frame:04d}.png')
        if not os.path.exists(p): continue
        im = Image.open(p).convert('RGB'); W, H = im.size
        if name == 'card':                                         # make room for the title above the card
            k = 0.78 if fmt == 'v' else 0.66; sm = im.resize((int(W * k), int(H * k)), Image.LANCZOS)
            bg = Image.new('RGB', (W, H), im.getpixel((5, 5))); bg.paste(sm, ((W - sm.width) // 2, H - sm.height - int(H * (0.02 if fmt == 'v' else 0.0)))); im = bg
        # clear the frame's own title area, then a soft dark band for ours
        band = np.zeros((H, W), np.float32); y0, y1 = int(H * (0.05 if fmt == 'v' else 0.04)), int(H * (0.3 if fmt == 'v' else 0.34))
        band[y0:y1] = 1.0; band = np.array(Image.fromarray((band * 255).astype(np.uint8)).filter(ImageFilter.GaussianBlur(H * 0.03))) / 255.0
        arr = np.asarray(im).astype(np.float32) * (1 - 0.75 * band[..., None]); im = Image.fromarray(arr.clip(0, 255).astype(np.uint8)); d = ImageDraw.Draw(im)
        s = W / 1080 if fmt == 'v' else H / 1080 * 0.95
        if name == 'card':
            f1 = ImageFont.truetype(DISP, int(150 * s)); f2 = F('Inter-500.ttf', int(30 * s))
            tracked(d, W / 2, H * 0.1, lines[0], f1, (243, 242, 237), 0.02)
            tracked(d, W / 2, H * 0.1 + 190 * s, lines[1], f2, (255, 200, 176), 0.12)
        else:
            f1 = F('Inter-700.ttf', int(92 * s))
            tracked(d, W / 2, H * 0.1, lines[0], f1, (243, 238, 228), 0.06)
            tracked(d, W / 2, H * 0.1 + 120 * s, lines[1], f1, (255, 226, 204), 0.06)
        # the products' marks, small, at the foot of the title block
        fs, fn = F('Inter-700.ttf', int(40 * s)), ImageFont.truetype(DISP, int(43 * s))
        cy = H * (0.26 if fmt == 'v' else 0.37); tw = fs.getlength('SCOUT') + fn.getlength('NEXT') + 90 * s; x = W / 2 - tw / 2
        d.rounded_rectangle((x, cy - 6 * s, x + 12 * s, cy + 6 * s), radius=3, fill=(69, 198, 240)); x += 22 * s
        d.text((x, cy), 'SCOUT', font=fs, fill=(243, 246, 250), anchor='lm'); x += fs.getlength('SCOUT') + 18 * s
        d.text((x, cy), '×', font=F('Inter-500.ttf', int(30 * s)), fill=(200, 196, 190), anchor='lm'); x += 34 * s
        d.text((x, cy), 'NEXT', font=fn, fill=(243, 242, 237), anchor='lm'); x += fn.getlength('NEXT') + 6 * s
        d.ellipse((x, cy + 4 * s, x + 9 * s, cy + 13 * s), fill=(253, 104, 68))
        im.save(os.path.join(OUT, f'THE-SIGNAL-thumb-{name}{sfx}.png')); print('thumb', name, fmt)
