"""Build NEXT's logo files from the site's own wordmark.

The live header draws the brand as "NEXT" in Bricolage Grotesque ExtraBold
(tracking -0.01em) followed by a small ember (#FD6844) dot with a soft glow
(components/next/NextHeader.tsx). This turns that into vector logos with the
glyphs converted to outlines, so they render identically everywhere without
the font.

  python make_logo.py   (needs fontTools; fonts from ../commercial/extract_fonts.py)
"""
import os
from fontTools.ttLib import TTFont
from fontTools.pens.svgPathPen import SVGPathPen
from fontTools.pens.boundsPen import BoundsPen
from fontTools.pens.transformPen import TransformPen

HERE = os.path.dirname(os.path.abspath(__file__))
FONT = os.path.join(HERE, '..', 'commercial', 'fonts', 'BricolageGrotesque-ExtraBold.ttf')
EMBER, INK, PAPER = '#FD6844', '#100908', '#F3F2ED'

font = TTFont(FONT)
gs = font.getGlyphSet()
cmap = font.getBestCmap()
upm = font['head'].unitsPerEm

def word_path(text, tracking=-0.01):
    """SVG path data for text, baseline at y=0, y pointing down, in font units."""
    pen = SVGPathPen(gs)
    x = 0
    for ch in text:
        g = cmap[ord(ch)]
        tp = TransformPen(pen, (1, 0, 0, -1, x, 0))
        gs[g].draw(tp)
        x += gs[g].width + tracking * upm
    x -= tracking * upm
    bp = BoundsPen(gs)
    xx = 0
    for ch in text:
        g = cmap[ord(ch)]
        gs[g].draw(TransformPen(bp, (1, 0, 0, -1, xx, 0)))
        xx += gs[g].width + tracking * upm
    return pen.getCommands(), bp.bounds, x

d, (x0, y0, x1, y1), adv = word_path('NEXT')
cap_h = y1 - y0                       # cap height (glyphs sit above the baseline)
# Dot: the header uses a 6px dot next to 22px type, vertically centred.
dot_r = cap_h * 0.15
gap = cap_h * 0.17
dot_cx = x1 + gap + dot_r
dot_cy = (y0 + y1) / 2
pad = cap_h * 0.32
vb = (x0 - pad, y0 - pad, (dot_cx + dot_r + pad) - (x0 - pad), (y1 + pad) - (y0 - pad))
glow = f'''<filter id="g" x="-200%" y="-200%" width="500%" height="500%"><feGaussianBlur stdDeviation="{dot_r * 0.9:.1f}"/></filter>'''

def logo(fg, bg=None, glow_on=True):
    rect = f'<rect x="{vb[0]:.1f}" y="{vb[1]:.1f}" width="{vb[2]:.1f}" height="{vb[3]:.1f}" fill="{bg}"/>' if bg else ''
    halo = f'<circle cx="{dot_cx:.1f}" cy="{dot_cy:.1f}" r="{dot_r * 1.6:.1f}" fill="{EMBER}" opacity="0.75" filter="url(#g)"/>' if glow_on else ''
    return (f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="{vb[0]:.1f} {vb[1]:.1f} {vb[2]:.1f} {vb[3]:.1f}" role="img" aria-label="NEXT">'
            f'<title>NEXT</title><defs>{glow}</defs>{rect}<path d="{d}" fill="{fg}"/>{halo}'
            f'<circle cx="{dot_cx:.1f}" cy="{dot_cy:.1f}" r="{dot_r:.1f}" fill="{EMBER}"/></svg>')

# App icon: the "N" with the ember dot, on the brand's near-black, rounded.
nd, (nx0, ny0, nx1, ny1), _ = word_path('N')
S = 1024
scale = (S * 0.50) / (ny1 - ny0)
nw = (nx1 - nx0) * scale
ir = (ny1 - ny0) * scale * 0.16
igap = (ny1 - ny0) * scale * 0.12
total = nw + igap + 2 * ir
tx = (S - total) / 2 - nx0 * scale
ty = (S - (ny1 - ny0) * scale) / 2 - ny0 * scale
icx = (S - total) / 2 + nw + igap + ir
icy = S / 2 + (ny1 - ny0) * scale * 0.5 - ir      # dot sits on the baseline, like a full stop
def icon(radius=S * 0.22):
    return (f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {S} {S}" role="img" aria-label="NEXT">'
            f'<title>NEXT</title><defs><filter id="g" x="-200%" y="-200%" width="500%" height="500%"><feGaussianBlur stdDeviation="{ir * 0.9:.1f}"/></filter>'
            f'<radialGradient id="bg" cx="50%" cy="38%" r="75%"><stop offset="0" stop-color="#1d1311"/><stop offset="1" stop-color="{INK}"/></radialGradient></defs>'
            f'<rect width="{S}" height="{S}" rx="{radius:.0f}" fill="url(#bg)"/>'
            f'<path d="{nd}" fill="{PAPER}" transform="translate({tx:.1f} {ty:.1f}) scale({scale:.4f})"/>'
            f'<circle cx="{icx:.1f}" cy="{icy:.1f}" r="{ir * 1.7:.1f}" fill="{EMBER}" opacity="0.7" filter="url(#g)"/>'
            f'<circle cx="{icx:.1f}" cy="{icy:.1f}" r="{ir:.1f}" fill="{EMBER}"/></svg>')

out = {
    'next-logo.svg': logo(PAPER),                         # light wordmark, transparent (for dark backgrounds)
    'next-logo-on-dark.svg': logo(PAPER, INK),            # with the brand background
    'next-logo-dark.svg': logo(INK, glow_on=False),       # dark wordmark for light backgrounds
    'next-icon.svg': icon(),                              # app icon / avatar
}
for name, svg in out.items():
    with open(os.path.join(HERE, name), 'w') as f:
        f.write(svg)
print('wrote', ', '.join(out))
