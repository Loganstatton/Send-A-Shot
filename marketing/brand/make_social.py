"""Social profile pictures for NEXT (Facebook/Instagram etc.: square upload, shown as a circle).
Same wordmark as the site header: NEXT in Bricolage Grotesque ExtraBold (-0.01em) + the ember dot with glow.

  python make_social.py   (Pillow + numpy; fonts from ../commercial/extract_fonts.py)
"""
import os
import numpy as np
from PIL import Image, ImageDraw, ImageFilter, ImageFont

HERE = os.path.dirname(os.path.abspath(__file__))
FONT = os.path.join(HERE, '..', 'commercial', 'fonts', 'BricolageGrotesque-ExtraBold.ttf')
EMBER, INK, PAPER = (253, 104, 68), (16, 9, 8), (243, 242, 237)
S = 2048

def background():
    yy, xx = np.mgrid[0:S, 0:S].astype(np.float32)
    r = np.hypot(xx - S * 0.5, yy - S * 0.42) / (S * 0.75)
    a = np.clip(1 - r, 0, 1) ** 1.6
    c = np.array(INK, np.float32) + a[..., None] * (np.array((44, 20, 15), np.float32))
    return Image.fromarray(c.clip(0, 255).astype(np.uint8)).convert('RGBA')

def wordmark(img, width):
    """Draw NEXT + dot centred, total width ~ `width` px."""
    size = 400
    f = ImageFont.truetype(FONT, size)
    track = -0.01 * size
    def text_w(fn): return sum(fn.getlength(c) for c in 'NEXT') + track * 3
    dot_gap, dot_r = 0.10, 0.125                      # in em: gap before the dot, dot radius
    total = text_w(f) + (dot_gap + 2 * dot_r) * size
    size = int(size * width / total); f = ImageFont.truetype(FONT, size); track = -0.01 * size
    tw = text_w(f); total = tw + (dot_gap + 2 * dot_r) * size
    asc = f.getbbox('NEXT')                            # ink box of the caps
    cap_h = asc[3] - asc[1]
    x0 = (S - total) / 2; y_top = (S - cap_h) / 2 - asc[1]
    d = ImageDraw.Draw(img); x = x0
    for c in 'NEXT':
        d.text((x, y_top), c, font=f, fill=PAPER); x += f.getlength(c) + track
    cx = x0 + tw + (dot_gap + dot_r) * size; cy = (S + cap_h) / 2 - dot_r * size * 1.05   # sits on the baseline, like the site
    r = dot_r * size
    glow = Image.new('RGBA', img.size, (0, 0, 0, 0)); gd = ImageDraw.Draw(glow)
    gd.ellipse((cx - r * 1.7, cy - r * 1.7, cx + r * 1.7, cy + r * 1.7), fill=(*EMBER, 190))
    img.alpha_composite(glow.filter(ImageFilter.GaussianBlur(r * 0.9)))
    ImageDraw.Draw(img).ellipse((cx - r, cy - r, cx + r, cy + r), fill=EMBER)
    return img

out = wordmark(background(), int(S * 0.74)).convert('RGB')
out.save(os.path.join(HERE, 'next-profile-2048.png'))
out.resize((1080, 1080), Image.LANCZOS).save(os.path.join(HERE, 'next-profile-1080.png'))
print('wrote next-profile-2048.png, next-profile-1080.png')
