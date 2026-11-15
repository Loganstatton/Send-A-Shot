"""SCOUT × NEXT — "BEFORE THE BREAKOUT": NOW IT'S YOUR TURN (18–28 s, global 541–840; local 1–300).
Picks up exactly where transition.py ends: same set, same phone pose, same camera.

  local  global  time
  1      541     18.0   the phone, Discover, Juno featured (NOW, IT'S YOUR TURN. from 17.0)
  37     577     19.2   tap her card → her profile: NEXT Score 86, price; scroll to price
  73     613     20.4   $250 of virtual Credits
  100    640     21.3   Review purchase → confirm
  124    664     22.1   Confirm purchase → 133 "Bought 6.5138 shares at $38.38"
  133–200                market lines grow out of the phone into 3D; columns rise from the floor;
                         panels pop out: trade history, portfolio, leaderboard (23.5 / 23.9 / 24.3 s)
  200–300                back into the phone: portfolio, then the leaderboard (COMPETE.)

  blender-venv/bin/python next4.py -- --assets DIR [--hook wide] [--preview|--gpu] [--frames a-b|--list ...] [--out DIR]
"""
import json, math, os, random, sys
HERE = os.path.dirname(os.path.abspath(__file__))
for p in (HERE, os.path.join(HERE, '..', 'commercial2'), os.path.join(HERE, '..', 'commercial')):
    if p not in sys.path: sys.path.insert(0, p)
from scout3d import *
from set4 import build_set, build_haze, MW, MH, MZ
from phone2 import build_phone2
from mathutils import Vector, Matrix

random.seed(541)
END = 300
sc = init(END, samples=64)
WIDE = arg('--hook') == 'wide'
if WIDE: sc.render.resolution_x, sc.render.resolution_y = 1920, 1080
S = lambda n: os.path.join(ASSETS, n)
Z = lambda v: (0.5 - v) * SCREEN_H
def SP(u, v): return ((u - 0.5) * SCREEN_W, (0.5 - v) * SCREEN_H)
OPEN, SCROLL, FORM, CONFIRM, BOUGHT, PORT, LEAD = 40, 56, 70, 102, 133, 214, 252
TAP_CARD, TAP_AMT, TAP_REVIEW, TAP_CONFIRM = 37, 73, 100, 124

# ---------------------------------------------------------------- the same world as transition.py, as it ends
SET = build_set(S, [(S('scout-profile-screen.png'), 1, 'cut')])
msb = next(n for n in SET['mscr'].data.materials[0].node_tree.nodes if n.type == 'BSDF_PRINCIPLED'); msb.inputs['Emission Strength'].default_value = 0.5
HAZE = build_haze(); HAZE['HazeS'].default_value = 0.015; HAZE['HazeN'].default_value = 0.24
PH_YAW = math.radians(-12)
PH = Vector((5.6, 4.6, 1.15)) + Vector((0, 0, 0.03))
rig = link(bpy.data.objects.new('Rig', None)); rig.location = PH; rig.rotation_euler = (0, 0, PH_YAW)
states = [(S('n02-discover-grid.png'), 1, 'cut'), (S('n03-artist.png'), OPEN, 'up'), (S('n03b-artist-score.png'), SCROLL, 'up'),
          (S('n04-back-amount.png'), FORM, 'up'), (S('n05-confirm.png'), CONFIRM, 'cut'), (S('n06-backed.png'), BOUGHT, 'fade'),
          (S('n08-portfolio.png'), PORT, 'push'), (S('n09-leaderboard.png'), LEAD, 'push')]
phone, scr = build_phone2('Phone', states, screen_glow=1.05)
float_ = link(bpy.data.objects.new('Float', None)); float_.parent = rig; phone.parent = float_
keys(float_, 'rotation_euler', [(1, (0, 0, math.radians(-4))), (40, (0, 0, 0)), (BOUGHT, (0, 0, math.radians(2))), (200, (0, 0, math.radians(-6))), (END, (0, 0, 0))])
keys(float_, 'location', [(1, (0, 0, 0)), (BOUGHT, (0, 0, 0.03)), (END, (0, 0, 0.0))])
def ripple(parent, x, y, frame, size=0.06):
    m, e = glow_material('tap', PAPER, 0.0)
    r = rounded_mesh('tapring', size, size, size / 2 - 0.0001, mat=m); r.parent = parent; r.location = (x, y, 0.004)
    visible(r, [(frame - 2, frame + 7)])
    for f, s_, st in ((frame - 2, 0.4, 0.0), (frame, 0.8, 0.9), (frame + 7, 1.6, 0.0)):
        r.scale = (s_, s_, s_); r.keyframe_insert('scale', frame=f); e.inputs['Strength'].default_value = st; e.inputs['Strength'].keyframe_insert('default_value', frame=f)
ripple(scr, *SP(0.5, 0.36), TAP_CARD)          # Juno's featured card
ripple(scr, *SP(0.5, 0.527), TAP_AMT)          # $250
ripple(scr, *SP(0.5, 0.792), TAP_REVIEW)       # Review purchase
ripple(scr, *SP(0.38, 0.743), TAP_CONFIRM)     # Confirm purchase

# ---------------------------------------------------------------- the market grows out of the phone (in the rig's frame)
series = json.load(open(S('series.json')))
names = [n for n in ('Juno Marrow', 'Velvet Static', 'Sol Kaito', 'Mira Solace') if len(series.get(n, [])) >= 4]
mkt = link(bpy.data.objects.new('Market', None)); mkt.parent = rig
for k in range(6):
    side = 1 if k % 2 == 0 else -1
    vals = smooth_series(series[names[k % len(names)]], 70)
    depth = (-0.15, 0.55, 1.3)[k // 2]
    x0, x1 = (0.46, 4.4) if side > 0 else (-0.46, -4.4)
    col = (EMBER_HOT, (1.0, 0.55, 0.25), (1.0, 0.78, 0.55))[k // 2]
    ob, _ = chart_line(f'Market{k}', vals if side > 0 else vals[::-1], x0, x1, -0.95 + 0.25 * (k // 2), 1.6 + 0.3 * (k % 3), depth_y=depth,
                       radius=0.011, strength=7.0 - 1.6 * (k // 2), color=col, reveal=(BOUGHT + 8 + 4 * k, BOUGHT + 50 + 4 * k))
    ob.parent = mkt
    m_ = ob.data.materials[0]; e_ = next(n for n in m_.node_tree.nodes if n.type == 'EMISSION')
    key_val(e_.inputs['Strength'], [(LEAD + 20, 7.0 - 1.6 * (k // 2)), (END, 0.0)])          # 4 → 5: the charts fade away
FZ = SET['FLOOR_Z'] - PH.z
for i in range(30):                                   # columns rising off the floor around the phone
    a = random.uniform(0, 2 * math.pi); r = random.uniform(1.8, 4.0); h = random.uniform(0.6, 2.4)
    col_m, col_e = emissive(f'Col{i}', EMBER, 0.0); key_val(col_e.inputs['Strength'], [(BOUGHT + 12, 0.0), (BOUGHT + 30, 1.1), (LEAD + 20, 1.0), (END, 0.0)])
    bpy.ops.mesh.primitive_cube_add(size=1, location=(r * math.cos(a), 1.2 + r * math.sin(a), FZ)); c_ = bpy.context.active_object
    c_.data.materials.append(col_m); c_.parent = mkt
    keys(c_, 'scale', [(BOUGHT + 12 + i % 10, (0.05, 0.05, 0.001)), (BOUGHT + 40 + i % 10, (0.05, 0.05, h))], interp='BACK', easing='EASE_OUT')
    visible(c_, [(BOUGHT + 12, END)])
PANELS = [('panel-history.png', 0.74, (-0.36, -0.95, 1.02), -14, 166),
          ('panel-portfolio.png', 0.6, (0.62, -0.75, -0.15), 16, 178),
          ('panel-leaders.png', 0.58, (-0.5, -0.55, -0.9), -18, 190)]
for i, (img, w, pos, yaw, f0) in enumerate(PANELS):
    pe, pf, ph = image_card(f'Panel{i}', S(img), w, r=0.04, glow=1.0)
    holder = link(bpy.data.objects.new(f'PanelHold{i}', None)); holder.parent = rig; pe.parent = holder
    pe.rotation_euler = (math.radians(90), 0, 0)
    keys(holder, 'location', [(f0, (0, -0.06, 0.1)), (f0 + 22, pos), (LEAD - 4, (pos[0], pos[1], pos[2] + 0.06)), (LEAD + 14, (pos[0] * 2.6, pos[1] - 0.2, pos[2] * 1.6))])
    keys(holder, 'rotation_euler', [(f0, (0, 0, 0)), (f0 + 22, (0, 0, math.radians(yaw))), (LEAD + 14, (0, 0, math.radians(yaw * 1.6)))])
    keys(holder, 'scale', [(f0, (0.2, 0.2, 0.2)), (f0 + 22, (1, 1, 1))])
    for fc in iter_fcurves(holder.animation_data.action):
        for kp in fc.keyframe_points:
            if round(kp.co.x) == f0: kp.interpolation = 'BACK'; kp.easing = 'EASE_OUT'
    for ob in (pe, pf): visible(ob, [(f0, LEAD + 14)])
    gm, ge = glow_material(f'PanelGlow{i}', EMBER, 0.0)
    g = rounded_mesh(f'PanelRim{i}', w + 0.03, ph + 0.03, 0.055, mat=gm); g.parent = pe; g.location.z = -0.004
    key_val(ge.inputs['Strength'], [(f0, 0.0), (f0 + 10, 2.4), (f0 + 40, 1.2)]); visible(g, [(f0, LEAD + 14)])

# ---------------------------------------------------------------- light: NEXT orange (as the transition left it), then the market
def L_(name, loc, tgt, size, energy, color, size_y=None):
    ob = look_light(name, tuple(rig.matrix_world @ Vector(loc)) if False else loc, tgt, size, energy, color=color, size_y=size_y); return ob
bpy.context.view_layer.update()
W_ = lambda v: tuple(rig.matrix_world @ Vector(v))
P0 = Vector((5.6, 4.6, 1.15))                          # exactly the lights transition.py ends with
nrimL = look_light('NextRimL', tuple(P0 + Vector((-1.6, 1.4, 0.6))), tuple(P0), 0.2, 240, color=EMBER, size_y=3.0)
nrimR = look_light('NextRimR', tuple(P0 + Vector((1.6, 1.2, -0.2))), tuple(P0), 0.2, 200, color=(1.0, 0.62, 0.36), size_y=3.0)
nkey = look_light('NextKey', tuple(P0 + Vector((-1.4, -3.0, 2.4))), tuple(P0), 2.0, 70, color=(1.0, 0.93, 0.86))
for nm, loc, size, e, col, sy in (('ScoutKey', (-3.2, -3.4, 4.6), 3.0, 260 * 0.35, (0.78, 0.9, 1.0), None), ('ScoutRim', (2.6, 2.2, 3.4), 1.2, 340 * 0.35, CYAN, 4.0),
                                  ('ScoutFill', (3.8, -3.0, 1.0), 2.0, 40 * 0.35, (0.6, 0.8, 1.0), None)):
    sl_ = look_light(nm, loc, (0, 0, MZ), size, e, color=col, size_y=sy)
    key_energy(sl_, [(1, e), (8, e), (30, 0.0)])                   # only for the cut; their reflections would sit on the phone screen
glass = look_light('GlassStrip', W_((-2.6, -2.4, 1.0)), W_((0, 0, 0)), 0.9, 0.0, size_y=4.0)
key_energy(glass, [(40, 0.0), (52, 2.0), (90, 2.0), (100, 0.0)])
keys(glass, 'location', [(40, W_((-2.6, -2.4, 1.0))), (100, W_((2.6, -2.4, 0.2)))], interp='SINE', easing='EASE_IN_OUT')
for l, e in ((nrimL, 240), (nrimR, 200)): key_energy(l, [(1, e), (LEAD + 20, e), (END, e * 0.25)])
key_energy(nkey, [(1, 70.0), (8, 70.0), (30, 0.0)])          # matches transition.py at the cut, then gives way: its reflection sat on the screen
top = look_light('NextTop', W_((0.2, -1.2, 4.2)), W_((0, 0, 0)), 2.2, 0.0, color=(1.0, 0.93, 0.86))   # from above: lights the metal, never mirrors into the glass
key_energy(top, [(1, 0.0), (8, 0.0), (30, 110.0), (LEAD + 20, 110.0), (END, 40.0)])
for ob in bpy.data.objects:
    if ob.type == 'LIGHT': ob.visible_camera = False

# ---------------------------------------------------------------- camera: starts on transition.py's last frame
sc.frame_set(1); bpy.context.view_layer.update()
scr_c = scr.matrix_world.translation.copy()
start = scr_c + (Vector((0.15, -3.0, 0.15)) @ Matrix.Rotation(-PH_YAW, 3, 'Z'))
cam = Camera(lens=35, fstop=3.0)
cam.key(1, tuple(start), tuple(scr_c), tuple(scr_c), 3.0)
def orbit(deg, r, h): a = math.radians(deg); return (r * math.sin(a), -r * math.cos(a), h)
def ck(f, loc_local, tgt_local, fstop=None):
    cam.key(f, W_(loc_local), W_(tgt_local), W_(tgt_local), fstop)
ck(OPEN + 4, (0.12, -2.45, Z(0.4) + 0.05), (0, 0, Z(0.4)), 4.0)                       # her profile: Score 86, price
ck(SCROLL + 10, (0.05, -2.35, Z(0.45) + 0.04), (0, 0, Z(0.45)))
ck(TAP_AMT, (-0.04, -2.3, Z(0.56) + 0.04), (0, 0, Z(0.56)))                           # $250 of Credits
ck(TAP_REVIEW + 2, (0.0, -2.3, Z(0.7) + 0.03), (0, 0, Z(0.7)))
ck(BOUGHT, (0.04, -2.35, Z(0.7) + 0.03), (0, 0, Z(0.7)))
ck(BOUGHT + 16, (0.06, -2.6, Z(0.66) + 0.04), (0, 0, Z(0.66)))                       # "Bought" holds
ck(196, orbit(8, 8.0, 0.75), (0.0, 0.0, 0.1), 5.0)                                    # the market around the phone
ck(PORT + 6, (0.1, -2.7, Z(0.4) + 0.06), (0, 0, Z(0.4)), 4.0)                          # portfolio
ck(LEAD + 6, (0.05, -2.75, Z(0.55) + 0.05), (0, 0, Z(0.55)))                           # leaderboard
ck(END, (0.12, -3.6, Z(0.5) + 0.2), (0, 0, Z(0.5)))
cam.smooth(); cam.bind(1)
if arg('--save'): bpy.ops.file.pack_all()             # editable .blend: images packed inside, opens anywhere
render(os.path.join(HERE, 'frames_next'))
