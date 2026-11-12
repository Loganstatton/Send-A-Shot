"""Extract NEXT's brand fonts (SIL Open Font License) from the app build.

  npm run build   # in the repo root, once
  python extract_fonts.py
Writes static TTFs to ./fonts: Bricolage Grotesque ExtraBold (wordmark and
headlines) and IBM Plex Sans/Mono (UI and numbers), the same files the
live app serves, so the commercial's type matches the product exactly.
"""
import glob, os
from fontTools.ttLib import TTFont
from fontTools.varLib import instancer
from fontTools.ttLib.removeOverlaps import removeOverlaps   # needs skia-pathops

HERE = os.path.dirname(os.path.abspath(__file__))
MEDIA = os.path.join(HERE, '..', '..', '.next', 'static', 'media')
OUT = os.path.join(HERE, 'fonts')
os.makedirs(OUT, exist_ok=True)

def latin(family):
    for f in glob.glob(os.path.join(MEDIA, '*.woff2')):
        t = TTFont(f)
        if family in (t['name'].getDebugName(4) or '') and ord('N') in (t.getBestCmap() or {}):
            return f
    raise SystemExit(f'{family} not found in {MEDIA} (run npm run build first)')

def static(path, weight, out):
    t = TTFont(path)
    if 'fvar' in t:
        t = instancer.instantiateVariableFont(t, {a.axisTag: (weight if a.axisTag == 'wght' else a.defaultValue) for a in t['fvar'].axes})
    # Variable fonts build letters like T from overlapping shapes; Blender's
    # even-odd fill would punch holes where they overlap, so merge them.
    removeOverlaps(t)
    t.flavor = None
    t.save(os.path.join(OUT, out))

static(latin('Bricolage Grotesque'), 800, 'BricolageGrotesque-ExtraBold.ttf')
plex = latin('IBM Plex Sans')
static(plex, 500, 'IBMPlexSans-Medium.ttf')
static(plex, 600, 'IBMPlexSans-SemiBold.ttf')
static(latin('IBM Plex Mono Medium'), 500, 'IBMPlexMono-Medium.ttf')
print('fonts written to', OUT)
