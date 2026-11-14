"""NEXT × SCOUT — "THE SIGNAL": ACT II on NEXT, 0:22–0:40 (global frames 660–1200; frame 660 is
scout5's last frame: same phone pose, same camera).

  frames    time   picture (every screen is a capture of the real app; taps land on the real controls)
  660–745   22.0   Discover: Juno featured; tap search → "jun"; tap Filters (scores, prices, genres)
  745–790          tap her card → her profile: Scout Score 86, NEXT Price, Watch, the preview control
  784–840          tap the preview control: a 3D waveform rises out of the phone (original demo audio)
  842              Watch → Watching
  866–900          the price panel: NEXT Price, how it is set
  902–990   30.0   the trade panel: Balance $10,000.00 of virtual Credits; $250; Review; Confirm;
                   "Bought 6.5138 shares at $38.38"
  990–1115         the price line grows out of the phone into a glass chart in 3D: the real price history,
                   one lit node per trade (every trade moved the price)
  1115–1200        back on the phone: price $42.38; the Sell tab, $50, Review, Confirm, "Sold"

  blender-venv/bin/python next5.py -- --assets DIR [--hook wide] [--preview|--gpu] [--frames a-b|--list ...] [--out DIR]
"""
import json, math, os, random, sys
HERE = os.path.dirname(os.path.abspath(__file__))
for p in (HERE, os.path.join(HERE, '..', 'dual'), os.path.join(HERE, '..', 'commercial2'), os.path.join(HERE, '..', 'commercial')):
    if p not in sys.path: sys.path.insert(0, p)
from scout3d import *
from phone2 import build_phone2
from world5 import build_floor, haze, L_, group, screen_bsdf, build_architecture, FLOOR_Z, BEHIND
from mathutils import Vector, Matrix

random.seed(660)
START, END = 660, 1200
sc = init(END, samples=96, gpu_samples=128)
sc.frame_start = START
sc.cycles.transparent_max_bounces = 16
from world5 import compact_frames; compact_frames(sc)

WIDE = arg('--hook') == 'wide'
if WIDE: sc.render.resolution_x, sc.render.resolution_y = 1920, 1080
S = lambda n: os.path.join(ASSETS, n)
TAPS = json.load(open(S('taps.json')))
TAPS['search'] = {'u': 0.5, 'v': 0.355}; TAPS['filters'] = {'u': 0.1, 'v': 0.52}; TAPS['card_in_filters'] = {'u': 0.5, 'v': 0.93}  # read off the captures
T_SEARCH, T_FILT, T_CARD, T_PLAY, T_WATCH, T_PRICE = 690, 718, 744, 784, 842, 866
T_TRADE, T_AMT, T_REV, T_CONF, T_CHART, T_BACK = 902, 940, 962, 984, 992, 1116
T_SELL, T_SREV, T_SCONF = 1140, 1160, 1178

PH2 = Vector((7.2, 30.2, 1.15))
fl, floor_glow, floor_mix = build_floor(52)
haze('HazeN2', (PH2.x + 1.5, PH2.y + 9, 0.8), EMBER, [(1, 0.3)], size=30, radius=6.0)
build_architecture(FLOOR_Z, 14.0, 46.0, (-4.6, -7.6), (10.8, 13.8), 48.0, [(1, 1.6)], extra=BEHIND)
states = [(S('n02-discover-grid.png'), 1, 'cut'), (S('n02s-search.png'), T_SEARCH + 2, 'up'), (S('n02f-filters.png'), T_FILT + 2, 'fade'),
          (S('n03-artist.png'), T_CARD + 4, 'push'), (S('n03w-watching.png'), T_WATCH + 2, 'fade'), (S('n03b-artist-score.png'), T_PRICE, 'up'),
          (S('n04a-trade-empty.png'), T_TRADE, 'up'), (S('n04-back-amount.png'), T_AMT + 2, 'fade'), (S('n05-confirm.png'), T_REV + 2, 'fade'),
          (S('n06-backed.png'), T_CONF + 3, 'fade'), (S('n07-artist-chart.png'), T_BACK + 4, 'fade'), (S('n11a-sell-amount.png'), T_SELL + 2, 'fade'),
          (S('n11b-sell-confirm.png'), T_SREV + 2, 'fade'), (S('n11c-sold.png'), T_SCONF + 3, 'fade')]
phone, pscr = build_phone2('NextPhone', states, screen_glow=1.05)
phone.location = PH2 + Vector((0, 0, 0.03)); phone.rotation_euler = (0, 0, math.radians(-6))
keys(phone, 'rotation_euler', [(START, (0, 0, math.radians(-6))), (720, (0, 0, math.radians(-2))), (T_CHART, (0, 0, 0.0)),
                               (1060, (0, 0, math.radians(-10))), (T_BACK, (0, 0, math.radians(-3))), (END, (0, 0, 0.0))], interp='SINE', easing='EASE_IN_OUT')
for name, f in (('search', T_SEARCH), ('filters', T_FILT), ('card_in_filters', T_CARD), ('play', T_PLAY), ('watch', T_WATCH),
                ('amount', T_AMT), ('review_buy', T_REV), ('confirm_buy', T_CONF), ('sell_tab', T_SELL), ('review_sell', T_SREV), ('confirm_sell', T_SCONF)):
    tap_ripple(pscr, TAPS[name]['u'], TAPS[name]['v'], f)
sc.frame_set(T_PLAY); bpy.context.view_layer.update()
def on_screen(u, v, lift=0.0):
    return pscr.matrix_world @ Vector(((u - 0.5) * SCREEN_W, (0.5 - v) * SCREEN_H, lift))
NRM = (pscr.matrix_world.to_3x3() @ Vector((0, 0, 1))).normalized()

# ---------------------------------------------------------------- LISTEN: a waveform rises out of the preview
NBAR = 56
wv_root = link(bpy.data.objects.new('Waveform', None))
COVER = on_screen(0.5, 0.25)
keys(wv_root, 'location', [(T_PLAY, tuple(COVER + NRM * 0.02)), (T_PLAY + 18, tuple(COVER + NRM * 0.55 + Vector((0, 0, 0.32)))),
                           (836, tuple(COVER + NRM * 0.62 + Vector((0, 0, 0.36)))), (856, tuple(COVER + NRM * 0.02))])
keys(wv_root, 'scale', [(T_PLAY, (0.2, 0.2, 0.2)), (T_PLAY + 18, (1, 1, 1)), (836, (1, 1, 1)), (856, (0.1, 0.1, 0.1))])
wv_root.rotation_euler = (0, 0, math.radians(-6))
wm, we = emissive('WaveBar', (1.0, 0.32, 0.42), 0.0)
key_val(we.inputs['Strength'], [(T_PLAY, 0.0), (T_PLAY + 6, 7.0), (840, 7.0), (856, 0.0)])
BEAT = 16
for i in range(NBAR):
    x = (i - (NBAR - 1) / 2) * 0.018
    bar = rounded_slab(f'WB{i}', 0.009, 1.0, 0.0044, depth=0.003, mat=wm); bar.parent = wv_root
    bar.location = (x, 0, 0); bar.rotation_euler = (math.radians(90), 0, 0)
    env_ = 0.25 + 0.75 * math.exp(-((i - NBAR / 2) / (NBAR * 0.33)) ** 2)
    for f in range(T_PLAY, 858, 2):
        beat = math.exp(-((f - 8) % BEAT) / 5.0)                     # the music's own beat grid
        h = 0.02 + env_ * (0.05 + 0.13 * beat) * (0.55 + 0.45 * abs(math.sin(i * 0.9 + f * 0.31)))
        bar.scale = (1, h, 1); bar.keyframe_insert('scale', frame=f)
    visible(bar, [(T_PLAY, 857)])
visible(wv_root, [(T_PLAY, 857)])

# ---------------------------------------------------------------- the market: the real price history grows out of the phone
series = json.load(open(S('series.json')))['Juno Marrow']
CH0 = on_screen(0.62, 0.30, 0.03)                                  # where the price sits on the trade screen
n = len(series); lo, hi = min(series), max(series)
pts = []
for i, v in enumerate(series):
    t = i / (n - 1)
    pts.append(CH0 + Vector((0.35 + 1.5 * t, 0.5 + 0.7 * t, 0.15 + (v - lo) / (hi - lo) * 2.3 + 0.35 * t)))
cu = bpy.data.curves.new('PriceLine', 'CURVE'); cu.dimensions = '3D'; sp_ = cu.splines.new('POLY'); sp_.points.add(n - 1)
for i, p in enumerate(pts): sp_.points[i].co = (*p, 1)
cu.bevel_depth = 0.012; cu.bevel_resolution = 4
line = link(bpy.data.objects.new('PriceLine', cu))
lm = principled('PriceLineM', (0.9, 0.42, 0.2), metallic=1.0, rough=0.2, emission=EMBER_HOT, estr=0.0)
lb = lm.node_tree.nodes['Principled BSDF']; key_val(lb.inputs['Emission Strength'], [(T_CHART, 0.0), (T_CHART + 4, 9.0), (1100, 6.0), (T_BACK + 8, 0.0)])
line.data.materials.append(lm)
cu.bevel_factor_end = 0.0; cu.keyframe_insert('bevel_factor_end', frame=T_CHART)
cu.bevel_factor_end = 1.0; cu.keyframe_insert('bevel_factor_end', frame=1068)
set_interp(cu, 'SINE', 'EASE_IN_OUT')
visible(line, [(T_CHART, T_BACK + 8)])
# a smoked-glass sheet under the line (the area of the chart), and a glass base rail
glass = principled('ChartGlass', (0.95, 0.72, 0.62), rough=0.06, transmission=1.0, ior=1.45, coat=0.5, emission=EMBER, estr=0.4)
base_z = CH0.z + 0.02
for i, p in enumerate(pts):                                 # one glass rod per trade, from the base up to its price
    on = T_CHART + 4 + int(i / (n - 1) * (1068 - T_CHART - 4))
    h = p.z - base_z - 0.04
    rod = rounded_slab(f'Rod{i}', 0.03, 1.0, 0.014, depth=0.015, bevel=0.004, mat=glass)
    rod.rotation_euler = (math.radians(90), 0, 0); rod.location = (p.x, p.y, base_z)
    for v in rod.data.splines[0].points: v.co.y += 0.5                     # grow from the base
    keys(rod, 'scale', [(on, (1, 0.0, 1)), (on + 10, (1, h, 1))], interp='SINE', easing='EASE_OUT')   # local y is height (stood up)
    visible(rod, [(on, T_BACK + 8)])
node_m, node_e = emissive('TradeNode', (1.0, 0.82, 0.62), 0.0)
for i, p in enumerate(pts):
    on = T_CHART + 4 + int(i / (n - 1) * (1068 - T_CHART - 4))
    bpy.ops.mesh.primitive_uv_sphere_add(radius=0.034, segments=16, ring_count=8, location=p); nd = bpy.context.active_object
    m_, e_ = emissive(f'TradeNode{i}', (1.0, 0.8, 0.6), 0.0); nd.data.materials.append(m_)
    key_val(e_.inputs['Strength'], [(on - 1, 0.0), (on, 40.0), (on + 6, 9.0), (T_BACK + 4, 6.0), (T_BACK + 10, 0.0)])
    keys(nd, 'scale', [(on - 1, (0, 0, 0)), (on + 3, (1.4, 1.4, 1.4)), (on + 8, (1, 1, 1))])
    visible(nd, [(on - 1, T_BACK + 10)])
sparks = particles('ChartSparks', [tuple(pts[min(n - 1, int(random.random() * n))] + Vector([random.gauss(0, 0.05) for _ in range(3)])) for _ in range(500)],
                   [tuple(pts[min(n - 1, int(random.random() * n))] + Vector((random.gauss(0, 0.4), random.gauss(0, 0.4), random.uniform(0.1, 1.0)))) for _ in range(500)],
                   [(random.gauss(0, 0.2), random.gauss(0, 0.2), random.uniform(0.0, 0.4)) for _ in range(500)],
                   [T_CHART + random.uniform(0, 70) for _ in range(500)], T_CHART, settle=30.0, base=0.0, fly=0.008, noise_amp=0.3,
                   appear=T_CHART, vanish=(1090, T_BACK), glow=0.6)

# ---------------------------------------------------------------- light
L_('NKey2', PH2 + Vector((-1.4, -3.0, 2.2)), PH2, 2.0, (1.0, 0.92, 0.85), [(START, 70.0)])
L_('NRimL2', PH2 + Vector((-1.6, 1.4, 0.6)), PH2, 0.2, EMBER, [(START, 240.0)], size_y=3.0)
L_('NRimR2', PH2 + Vector((1.6, 1.2, -0.2)), PH2, 0.2, (1.0, 0.62, 0.36), [(START, 200.0)], size_y=3.0)
L_('NTop', PH2 + Vector((0.3, -1.0, 3.8)), PH2, 2.0, (1.0, 0.93, 0.86), [(START, 0.0), (700, 25.0)])
L_('ChartKey', CH0 + Vector((2.0, -3.0, 3.5)), CH0 + Vector((2.3, 0.5, 1.0)), 3.0, (1.0, 0.78, 0.6), [(T_CHART, 0.0), (1010, 90.0), (T_BACK, 90.0), (T_BACK + 12, 0.0)])
for ob in bpy.data.objects:
    if ob.type == 'LIGHT': ob.visible_camera = False
fg = bpy.data.collections.new('FloorOnly'); fg.objects.link(fl)
for nm in ('NKey2', 'NRimL2', 'NRimR2', 'NTop'):
    bpy.data.objects[nm].light_linking.receiver_collection = fg
    for co in fg.collection_objects: co.light_linking.link_state = 'EXCLUDE'

# ---------------------------------------------------------------- camera
cam = Camera(lens=35, fstop=2.8)
SC = PH2 + Vector((0, -0.05, 0.0))
def at_screen(u, v, d, dx=0.0, dz=0.0):
    p = on_screen(u, v); return tuple(p + NRM * d + Vector((dx, 0, dz))), tuple(p + Vector((0, 0, dz)))
cam.key(START, tuple(PH2 + Vector((-0.1, -2.6, 0.1))), tuple(SC), tuple(SC), 2.8, 35)
c, t = at_screen(0.5, 0.45, 2.30, 0, 0.1); cam.key(T_SEARCH - 4, c, t, t)
c, t = at_screen(0.5, 0.5, 2.05, 0, 0.1); cam.key(T_CARD, c, t, t)
c, t = at_screen(0.5, 0.42, 2.00, 0, 0.1); cam.key(T_PLAY - 4, c, t, t)
cam.key(812, tuple(COVER + NRM * 2.4 + Vector((0.55, 0, 0.55))), tuple(COVER + NRM * 0.5 + Vector((0, 0, 0.3))), tuple(COVER + NRM * 0.55 + Vector((0, 0, 0.32))), 2.8)
c, t = at_screen(0.5, 0.62, 1.90, 0, 0.1); cam.key(T_WATCH, c, t, t, 2.8)
c, t = at_screen(0.5, 0.45, 1.90, 0, 0.1); cam.key(T_PRICE + 8, c, t, t)
c, t = at_screen(0.5, 0.38, 1.90, 0, 0.1); cam.key(T_TRADE + 10, c, t, t)
c, t = at_screen(0.5, 0.55, 1.90, 0, 0.1); cam.key(T_AMT, c, t, t)
c, t = at_screen(0.5, 0.6, 1.90, 0, 0.1); cam.key(T_CONF + 4, c, t, t)
mid = pts[n // 2]
CHM = (pts[0] + pts[-1]) / 2
cam.key(1030, tuple(CH0 + Vector((-0.2, -4.6, 0.9))), tuple(CHM + Vector((-0.35, 0, -0.1))), tuple(CHM), 5.6, 32)
cam.key(1085, tuple(CHM + Vector((1.6, -4.0, 0.5))), tuple(CHM + Vector((0.0, 0, 0.25))), tuple(CHM), 5.6, 32)
cam.key(T_BACK - 6, tuple(PH2 + Vector((0.5, -2.5, 0.3))), tuple(SC + Vector((0, 0, 0.05))), tuple(SC), 2.8, 35)
c, t = at_screen(0.5, 0.35, 1.90, 0, 0.1); cam.key(T_BACK + 10, c, t, t)
c, t = at_screen(0.5, 0.55, 1.90, 0, 0.1); cam.key(T_SELL + 6, c, t, t)
c, t = at_screen(0.5, 0.55, 1.90, 0, 0.1); cam.key(END, c, t, t)
cam.smooth()
if arg('--save'): bpy.ops.file.pack_all()
render(os.path.join(HERE, 'frames', 'next5'))
