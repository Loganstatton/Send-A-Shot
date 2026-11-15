"""NEXT Ad #2 — scenes 3–5, 4–14 s (global frames 121–420; local 1–300 here).
One continuous camera move, picking up exactly where opening.py ends.

  local   global
  1–90    121–210  3 DISCOVER   Discover slides to Juno Marrow's real featured card;
                                a tap lifts it off the screen into a floating 3D panel;
                                her preview plays (rings off the cover, EQ bars)
  91–150  211–270  4 BACK/TRADE tap the real "Back this artist" → the panel returns into
                                the phone → the real trade form ($250 of virtual Credits)
                                → Review purchase → Confirm purchase → "Bought 5.6779
                                shares"; market lines grow out of the phone into a 3D chart
  150–210 270–330               pull back to the chart, then fly through it
  211–300 331–420  5 TRACK      past floating real artist cards (parallax) to a second
                                phone: the portfolio, then Top Traders with #1 lit

  blender-venv/bin/python body.py -- --assets DIR [--preview|--gpu] [--frames a-b|--list ...] [--out DIR]
"""
import json, math, os, random, sys
HERE = os.path.dirname(os.path.abspath(__file__))
for p in (HERE, os.path.join(HERE, '..', 'commercial')):
    if p not in sys.path: sys.path.insert(0, p)
from phone2 import *
from mathutils import Vector

random.seed(303)
sc = init(300)
S = lambda name: os.path.join(ASSETS, name)
Z = lambda v: (0.5 - v) * SCREEN_H
series = json.load(open(S('series.json')))

def keyed(socket, pairs):
    for f, v in pairs:
        socket.default_value = v; socket.keyframe_insert('default_value', frame=f)
def keyed_energy(ob, pairs):
    for f, v in pairs:
        ob.data.energy = v; ob.data.keyframe_insert('energy', frame=f)
def ripple(parent, x, y, frame, size=0.06):
    m, e = glow_material('tap', PAPER, 0.0)
    r = rounded_mesh('tapring', size, size, size / 2 - 0.0001, mat=m); r.parent = parent; r.location = (x, y, 0.004)
    visible(r, [(frame - 2, frame + 7)])
    for f, s_, st in ((frame - 2, 0.4, 0.0), (frame, 0.8, 0.9), (frame + 7, 1.6, 0.0)):
        r.scale = (s_, s_, s_); r.keyframe_insert('scale', frame=f); e.inputs['Strength'].default_value = st; e.inputs['Strength'].keyframe_insert('default_value', frame=f)
def SP(u, v): return ((u - 0.5) * SCREEN_W, (0.5 - v) * SCREEN_H)

# ---------------------------------------------------------------- phone A (continues from the opening)
states = [(S('01-discover.png'), 1, 'cut'), (S('02-discover-grid.png'), 7, 'up'), (S('04-back-amount.png'), 96, 'up'),
          (S('05-confirm.png'), 124, 'cut'), (S('06-backed.png'), 142, 'fade')]
phone, scr = build_phone2('PhoneA', states, screen_glow=1.05)
float_ = link(bpy.data.objects.new('FloatA', None)); phone.parent = float_
keys(float_, 'location', [(1, (0, 0, 0.09)), (40, (0, 0, 0.05)), (90, (0, 0, 0.0)), (150, (0, 0, 0.0))])
keys(float_, 'rotation_euler', [(1, (math.radians(1), 0, math.radians(2))), (24, (0, 0, math.radians(-4))), (90, (0, 0, math.radians(-6))),
                                (100, (0, 0, 0)), (150, (0, 0, math.radians(3)))])
ripple(scr, *SP(0.5, 0.2), 14)                  # select Juno's card
ripple(scr, *SP(0.5, 0.527), 108)              # the $250 amount
ripple(scr, *SP(0.5, 0.792), 121)              # Review purchase
ripple(scr, *SP(0.38, 0.743), 139)             # Confirm purchase

# ---------------------------------------------------------------- the floating artist panel (Juno's real card)
pimg = load_image(S('panel-juno.png'))
PWD = 0.898 * SCREEN_W; PHT = PWD * pimg.size[1] / pimg.size[0]
pedge, pface, _ = image_card('JunoPanel', S('panel-juno.png'), PWD, r=0.04, glow=1.05)
pholder = link(bpy.data.objects.new('PanelHolder', None)); pedge.parent = pholder
pedge.rotation_euler = (math.radians(90), 0, 0)
sc.frame_set(14); bpy.context.view_layer.update()
on_screen = scr.matrix_world @ Vector((0, (0.5 - 0.305) * SCREEN_H, 0.012))
keys(pholder, 'location', [(15, tuple(on_screen)), (34, (0.62, -1.05, 0.34)), (88, (0.6, -1.12, 0.36)), (91, (0.6, -1.12, 0.36)),
                           (99, tuple(on_screen))])
keys(pholder, 'rotation_euler', [(15, (0, 0, math.radians(-4))), (34, (math.radians(2), 0, math.radians(-14))), (88, (math.radians(1), 0, math.radians(-10))),
                                 (99, (0, 0, math.radians(-6)))])
keys(pholder, 'scale', [(15, (1, 1, 1)), (34, (1.18, 1.18, 1.18)), (91, (1.18, 1.18, 1.18)), (99, (0.98, 0.98, 0.98))])
for fc in iter_fcurves(pholder.animation_data.action):
    for kp in fc.keyframe_points:
        if round(kp.co.x) == 15: kp.interpolation = 'BACK'; kp.easing = 'EASE_OUT'
        if round(kp.co.x) == 91: kp.interpolation = 'EXPO'; kp.easing = 'EASE_IN'
for ob in (pedge, pface): visible(ob, [(15, 99)])
pglow_m, pglow_e = glow_material('PanelGlow', EMBER, 0.0)
pg = rounded_mesh('PanelGlowRim', PWD + 0.03, PHT + 0.03, 0.055, mat=pglow_m); pg.parent = pedge; pg.location.z = -0.004
keyed(pglow_e.inputs['Strength'], [(15, 0.0), (30, 2.5), (60, 1.6), (88, 2.2), (99, 0.0)]); visible(pg, [(15, 99)])
# "Back this artist" on the panel (crop coordinates of the real button)
ripple(pface, (0.263 - 0.5) * PWD, (0.5 - 0.903) * PHT, 91, 0.07)
# the preview: rings off the cover + an EQ under the card
cover = Vector((0, (0.5 - 0.22) * PHT, 0.006))
for k, f0 in enumerate((38, 52, 66, 80)):
    bpy.ops.mesh.primitive_torus_add(major_radius=0.13, minor_radius=0.004, major_segments=96, minor_segments=8)
    ring = bpy.context.active_object; rm, re_ = glow_material(f'PRing{k}', EMBER_HOT, 0.0); ring.data.materials.append(rm)
    ring.parent = pface; ring.location = cover; visible(ring, [(f0 - 1, f0 + 20)])
    for f, s_, st in ((f0 - 1, 0.4, 0.0), (f0, 0.5, 4.5), (f0 + 20, 1.8, 0.0)):
        ring.scale = (s_, s_, s_); ring.keyframe_insert('scale', frame=f); re_.inputs['Strength'].default_value = st; re_.inputs['Strength'].keyframe_insert('default_value', frame=f)
eq_m, eq_e = emissive('EQ', EMBER_HOT, 0.0)
keyed(eq_e.inputs['Strength'], [(34, 0.0), (38, 5.0), (86, 5.0), (90, 0.0)])
for i in range(18):
    bar = rounded_slab(f'EQ{i}', 0.022, 0.12, 0.01, mat=eq_m); bar.parent = pedge
    bar.location = ((i - 8.5) * 0.034, -PHT / 2 - 0.1, 0.0)
    for f in range(36, 92, 3):
        env = 0.25 + 0.75 * abs(math.sin(f * 0.21 + i * 0.7)) * (0.6 + 0.4 * random.random())
        bar.scale = (1, env if 38 <= f <= 86 else 0.05, 1); bar.keyframe_insert('scale', frame=f)
    visible(bar, [(36, 92)])

# ---------------------------------------------------------------- the market grows out of the phone
lines = []
names = list(series)
for k in range(6):
    side = 1 if k % 2 == 0 else -1
    vals = smooth_series(series[names[k % len(names)]], 70)
    if side < 0: vals = vals[::-1]
    depth = (-0.15, 0.55, 1.3)[k // 2]
    x0, x1 = (0.46, 4.4) if side > 0 else (-0.46, -4.4)
    col = (EMBER_HOT, (1.0, 0.55, 0.25), (1.0, 0.78, 0.55))[k // 2]
    ob, pts = chart_line(f'Market{k}', vals if side > 0 else vals[::-1][::-1], x0, x1, -0.95 + 0.25 * (k // 2), 1.6 + 0.3 * (k % 3), depth_y=depth,
                         radius=0.011, strength=9.0 - 2 * (k // 2), color=col, reveal=(142 + 3 * k, 176 + 3 * k))
    lines.append(ob)
for i in range(26):                              # market columns rising off the floor around the phone
    a = random.uniform(0, 2 * math.pi); r = random.uniform(1.8, 3.6)
    h = random.uniform(0.3, 1.6)
    col_m, col_e = emissive(f'Col{i}', EMBER, 0.0); keyed(col_e.inputs['Strength'], [(144, 0.0), (160, 1.4), (300, 1.2)])
    bpy.ops.mesh.primitive_cube_add(size=1, location=(r * math.cos(a), 1.2 + r * math.sin(a), -1.25)); c_ = bpy.context.active_object
    c_.data.materials.append(col_m)
    keys(c_, 'scale', [(144 + i % 8, (0.05, 0.05, 0.001)), (168 + i % 8, (0.05, 0.05, h))], interp='BACK', easing='EASE_OUT')
    c_.location.z = -1.25; visible(c_, [(144, 300)])
floor(-1.25, grid=0.22)

# ---------------------------------------------------------------- TRACK: floating real artist cards, then phone B
card_pos = [(-0.62, 7.0, 0.35), (0.7, 8.6, -0.3), (-0.55, 10.4, -0.45), (0.66, 12.0, 0.4), (-0.7, 13.8, 0.05), (0.58, 15.4, -0.5),
            (-0.5, 17.0, 0.5), (0.72, 18.6, 0.1)]
for i, pos in enumerate(card_pos):
    p_ = S(f'card-{i + 1}.png')
    if not os.path.exists(p_): continue
    e_, f_, h_ = image_card(f'MCard{i}', p_, 0.62, glow=1.0)
    e_.location = pos; e_.rotation_euler = (math.radians(90), math.radians(random.uniform(-6, 6)), math.radians((-1 if pos[0] > 0 else 1) * random.uniform(10, 20)))
    keys(e_, 'location', [(150, pos), (300, (pos[0], pos[1], pos[2] + random.uniform(-0.15, 0.15)))], interp='LINEAR')
BY = 24.0
phoneB, scrB = build_phone2('PhoneB', [(S('07-portfolio.png'), 1, 'cut'), (S('08b-leaderboard-rows.png'), 271, 'push')], screen_glow=1.05)
phoneB.location = (0, BY, 0)
keys(phoneB, 'rotation_euler', [(240, (math.radians(2), 0, math.radians(-8))), (300, (math.radians(1), 0, math.radians(4)))], interp='LINEAR')
ow, oh = 0.892 * SCREEN_W, 0.086 * SCREEN_H
oc = bpy.data.curves.new('RowGlow', 'CURVE'); oc.dimensions = '3D'; osp = oc.splines.new('POLY')
rp = rounded_rect_points(ow, oh, 0.03, 8); osp.points.add(len(rp) - 1)
for i, (x, y) in enumerate(rp): osp.points[i].co = (x, y, 0, 1)
osp.use_cyclic_u = True; oc.bevel_depth = 0.003
row_m, row_e = emissive('RowGlowM', EMBER_HOT, 0.0)
row = link(bpy.data.objects.new('RowGlow', oc)); row.data.materials.append(row_m)
row.parent = scrB; row.location = (0, (0.5 - 0.425) * SCREEN_H, 0.004)
keyed(row_e.inputs['Strength'], [(276, 0.0), (281, 9.0), (290, 3.5), (300, 4.5)]); visible(row, [(276, 300)])

# ---------------------------------------------------------------- set & light
bpy.ops.mesh.primitive_plane_add(size=80, location=(0, 42, 0.5), rotation=(math.radians(90), 0, 0)); bd = bpy.context.active_object
bm_ = bpy.data.materials.new('Backdrop'); bm_.use_nodes = True; bn = bm_.node_tree; bn.nodes.clear()
btc = bn.nodes.new('ShaderNodeTexCoord'); bgr = bn.nodes.new('ShaderNodeTexGradient'); bgr.gradient_type = 'SPHERICAL'
bmp = bn.nodes.new('ShaderNodeMapping'); bmp.inputs['Scale'].default_value = (0.05, 0.05, 0.05)
bpw = bn.nodes.new('ShaderNodeMath'); bpw.operation = 'POWER'; bpw.inputs[1].default_value = 3.0
bmu = bn.nodes.new('ShaderNodeMath'); bmu.operation = 'MULTIPLY'; keyed(bmu.inputs[1], [(1, 0.06), (36, 0.12), (88, 0.12), (100, 0.06), (150, 0.1)])
bem = bn.nodes.new('ShaderNodeEmission'); bem.inputs['Color'].default_value = (*EMBER, 1); bo = bn.nodes.new('ShaderNodeOutputMaterial')
bn.links.new(btc.outputs['Object'], bmp.inputs['Vector']); bn.links.new(bmp.outputs['Vector'], bgr.inputs['Vector'])
bn.links.new(bgr.outputs['Fac'], bpw.inputs[0]); bn.links.new(bpw.outputs[0], bmu.inputs[0]); bn.links.new(bmu.outputs[0], bem.inputs['Strength'])
bn.links.new(bem.outputs[0], bo.inputs['Surface']); bd.data.materials.append(bm_)
key = look_light('Key', (-2.2, -3.0, 3.2), (0, 0, 0), 2.0, 150, color=(0.92, 0.94, 1.0))
rim = look_light('Rim', (0.6, 3.0, 1.4), (0, 0, 0), 2.5, 420, color=EMBER)
keyed_energy(rim, [(1, 420), (34, 420), (40, 700), (86, 700), (96, 420)])        # the room reacts to the preview
glass = look_light('GlassStrip', (-2.6, -2.4, 1.0), (0, 0, 0), 0.9, 4.0, size_y=4.0); glass.visible_camera = False
keys(glass, 'location', [(96, (-2.6, -2.4, 1.0)), (140, (2.6, -2.4, 0.2))], interp='SINE', easing='EASE_IN_OUT')
keyB = look_light('KeyB', (-2.2, BY - 3.0, 3.2), (0, BY, 0), 3.0, 80, color=(0.92, 0.94, 1.0))
rimB = look_light('RimB', (0.6, BY + 3.0, 1.4), (0, BY, 0), 2.5, 420, color=EMBER)
for i, pos in enumerate(card_pos[::2]):
    look_light(f'CardLight{i}', (pos[0] * 0.3, pos[1] - 2.5, 2.2), pos, 2.5, 60, color=(1.0, 0.85, 0.7))
dust = [Vector((random.uniform(-3, 3), random.uniform(-2, 19.5), random.uniform(-1.4, 1.8))) for _ in range(900)]
particles('Dust', dust, [d_ + Vector((random.uniform(-0.1, 0.1), 0, random.uniform(0.1, 0.4))) for d_ in dust],
          [Vector((0, 0, 0))] * len(dust), [300] * len(dust), 1, settle=5, base=0.0018, fly=0.0, noise_amp=0.12, appear=1, glow=0.22)

# ---------------------------------------------------------------- camera (one move; f-numbers scaled for the ~11x set)
cam = Camera(lens=50, fstop=0.45)
cam.key(1, (0.7, -4.5, 0.36), (0.0, 0, 0.24), (0, 0, 0.1))
cam.key(12, (0.25, -4.25, 0.3), (0.0, 0, 0.2), (0, 0, 0.1))
cam.key(34, (0.95, -4.4, 0.42), (0.45, -0.6, 0.3), (0.62, -1.05, 0.34), 0.35)
cam.key(88, (0.85, -3.75, 0.42), (0.48, -0.85, 0.33), (0.6, -1.12, 0.36))
cam.key(100, (0.12, -3.25, Z(0.6) + 0.05), (0, 0, Z(0.6)), (0, 0, Z(0.6)), 0.5)
cam.key(112, (0.05, -2.6, Z(0.63) + 0.03), (0, 0, Z(0.63)), (0, 0, Z(0.63)))
cam.key(140, (-0.04, -2.55, Z(0.64) + 0.02), (0, 0, Z(0.64)), (0, 0, Z(0.64)))
cam.key(150, (0.08, -2.85, Z(0.64) + 0.04), (0, 0, Z(0.64)), (0, 0, Z(0.64)))
cam.key(176, (0.6, -6.6, 0.55), (0.2, 0, 0.1), (0, 0, 0.0), 0.8, 50)                 # pull back: the chart around the phone
cam.key(204, (1.2, -0.6, 0.25), (0.5, 8.0, 0.05), (0.8, 3, 0.1), 0.8, 32)           # into the chart
cam.key(222, (0.05, 5.2, 0.05), (0.1, 14.0, 0.05), (0.7, 8.6, -0.3), 2.2, 28)
cam.key(236, (0.0, 9.4, 0.0), (0.0, 18.0, 0.0), (0.66, 12.0, 0.4), 2.2, 28)
cam.key(248, (0.1, 15.2, 0.1), (0, BY, Z(0.5)), (0, BY, 0), 1.2, 36)              # between the cards
cam.key(258, (0.12, 20.6, Z(0.5) + 0.08), (0, BY, Z(0.5)), (0, BY, Z(0.5)), 0.5, 50)
cam.key(271, (0.02, 21.2, Z(0.47) + 0.04), (0, BY, Z(0.47)), (0, BY, Z(0.47)))
cam.key(300, (-0.08, 21.7, Z(0.44) + 0.02), (0, BY, Z(0.44)), (0, BY, Z(0.44)))
cam.smooth(); cam.bind(1)
for ob in bpy.data.objects:                      # the camera flies through the set: lights light, never show
    if ob.type == 'LIGHT': ob.visible_camera = False
render(os.path.join(HERE, 'frames_body'))
