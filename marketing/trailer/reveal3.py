"""NEXT reveal trailer — Scenes 3b–4, 13–25 s (global frames 391–750; local 1–360 here).

  local    global   time
  1        391      13.0 s   THE IMPACT: out of black, rim light slams onto a photoreal black phone
  1–100    391–490           the camera orbits from the phone's edge to its front (~65°)
  30       420      14.0 s   the screen wakes: the real NEXT Discover screen (bell)
  100–130  490–520           push into the screen; Juno Marrow's real artist page slides up
  130–245  520–635  17–21 s  DISCOVER → BACK: tap Trade, $250 of virtual Credits, Review, Confirm,
                             "Bought 5.6779 shares at $44.03" (taps on the 120 BPM beats)
  245–300  635–690           market lines grow out of the phone into a 3D chart; floating panels:
                             trade history, portfolio, artist info (all real NEXT UI, demo data)
  300–360  690–750           TRADE: the camera arcs out through the chart; fades to dark at 25 s

Imports the Ad #2 phone (../commercial2/phone2.py) and the Ad #1 toolkit; changes neither.

  blender-venv/bin/python reveal3.py -- --assets DIR [--preview|--gpu] [--frames a-b|--list ...] [--out DIR]
"""
import json, math, os, random, sys
HERE = os.path.dirname(os.path.abspath(__file__))
for p in (HERE, os.path.join(HERE, '..', 'commercial2'), os.path.join(HERE, '..', 'commercial')):
    if p not in sys.path: sys.path.insert(0, p)
from phone2 import *
from mathutils import Vector

random.seed(391)
END = 360
sc = init(END, samples=64)
WIDE = arg('--hook') == 'wide'                  # 16:9 version: same shots, 1920x1080 (vertical field of view kept)
if WIDE: sc.render.resolution_x, sc.render.resolution_y = 1920, 1080
S = lambda name: os.path.join(ASSETS, name)
Z = lambda v: (0.5 - v) * SCREEN_H
def SP(u, v): return ((u - 0.5) * SCREEN_W, (0.5 - v) * SCREEN_H)
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

# ---------------------------------------------------------------- the phone (screen off until 14.0 s)
WAKE, ARTIST, FORM, CONFIRM, BOUGHT = 30, 118, 172, 202, 232
states = [(S('01-discover.png'), 1, 'cut'), (S('03-artist.png'), ARTIST, 'up'), (S('04-back-amount.png'), FORM, 'up'),
          (S('05-confirm.png'), CONFIRM, 'cut'), (S('06-backed.png'), BOUGHT, 'fade')]
phone, scr = build_phone2('Phone', states, screen_glow=1.05)
smat = scr.data.materials[0]; sb = next(n for n in smat.node_tree.nodes if n.type == 'BSDF_PRINCIPLED')
keyed(sb.inputs['Emission Strength'], [(1, 0.0), (WAKE - 1, 0.0), (WAKE + 3, 1.6), (WAKE + 14, 1.05)])
float_ = link(bpy.data.objects.new('Float', None)); phone.parent = float_
keys(float_, 'location', [(1, (0, 0, 0.0)), (100, (0, 0, 0.04)), (240, (0, 0, 0.0)), (END, (0, 0, 0.03))])
keys(float_, 'rotation_euler', [(1, (math.radians(2), 0, math.radians(12))), (100, (0, 0, math.radians(2))), (240, (0, 0, 0)),
                                (END, (math.radians(1), 0, math.radians(-8)))])
ripple(scr, *SP(0.84, 0.957), ARTIST + 48)       # Trade (artist page, bottom bar)
ripple(scr, *SP(0.5, 0.527), FORM + 14)           # the $250 amount
ripple(scr, *SP(0.5, 0.792), CONFIRM - 3)          # Review purchase
ripple(scr, *SP(0.38, 0.743), BOUGHT - 3)          # Confirm purchase

# ---------------------------------------------------------------- the market grows out of the phone
names = list(series)
for k in range(6):
    side = 1 if k % 2 == 0 else -1
    vals = smooth_series(series[names[k % len(names)]], 70)
    depth = (-0.15, 0.55, 1.3)[k // 2]
    x0, x1 = (0.46, 4.4) if side > 0 else (-0.46, -4.4)
    col = (EMBER_HOT, (1.0, 0.55, 0.25), (1.0, 0.78, 0.55))[k // 2]
    chart_line(f'Market{k}', vals if side > 0 else vals[::-1], x0, x1, -0.95 + 0.25 * (k // 2), 1.6 + 0.3 * (k % 3), depth_y=depth,
               radius=0.011, strength=7.0 - 1.6 * (k // 2), color=col, reveal=(BOUGHT + 10 + 4 * k, BOUGHT + 52 + 4 * k))
for i in range(30):                              # market columns rising off the floor around the phone
    a = random.uniform(0, 2 * math.pi); r = random.uniform(1.8, 3.8); h = random.uniform(0.3, 1.6)
    col_m, col_e = emissive(f'Col{i}', EMBER, 0.0); keyed(col_e.inputs['Strength'], [(BOUGHT + 12, 0.0), (BOUGHT + 30, 1.2), (END, 1.0)])
    bpy.ops.mesh.primitive_cube_add(size=1, location=(r * math.cos(a), 1.2 + r * math.sin(a), -1.25)); c_ = bpy.context.active_object
    c_.data.materials.append(col_m)
    keys(c_, 'scale', [(BOUGHT + 12 + i % 10, (0.05, 0.05, 0.001)), (BOUGHT + 40 + i % 10, (0.05, 0.05, h))], interp='BACK', easing='EASE_OUT')
    visible(c_, [(BOUGHT + 12, END)])
FLOOR = floor(-1.25, grid=0.22)

# floating panels: trade history, portfolio, artist info (real UI crops, demo data)
PANELS = [('panel-history.png', 0.74, (-0.36, -0.95, 1.02), -14, BOUGHT + 26),
          ('panel-portfolio.png', 0.6, (0.62, -0.75, -0.15), 16, BOUGHT + 38),
          ('panel-juno.png', 0.58, (-0.44, -0.55, -0.86), -18, BOUGHT + 50)]
for i, (img, w, pos, yaw, f0) in enumerate(PANELS):
    pe, pf, ph = image_card(f'Panel{i}', S(img), w, r=0.04, glow=1.0)
    holder = link(bpy.data.objects.new(f'PanelHold{i}', None)); pe.parent = holder
    pe.rotation_euler = (math.radians(90), 0, 0)
    sc.frame_set(f0); bpy.context.view_layer.update()
    start = scr.matrix_world @ Vector((0, 0, 0.02))
    keys(holder, 'location', [(f0, tuple(start)), (f0 + 22, pos), (END, (pos[0], pos[1], pos[2] + 0.06))])
    keys(holder, 'rotation_euler', [(f0, (0, 0, 0)), (f0 + 22, (0, 0, math.radians(yaw))), (END, (0, 0, math.radians(yaw * 0.8)))])
    keys(holder, 'scale', [(f0, (0.2, 0.2, 0.2)), (f0 + 22, (1, 1, 1))])
    for fc in iter_fcurves(holder.animation_data.action):
        for kp in fc.keyframe_points:
            if round(kp.co.x) == f0: kp.interpolation = 'BACK'; kp.easing = 'EASE_OUT'
    for ob in (pe, pf): visible(ob, [(f0, END)])
    gm, ge = glow_material(f'PanelGlow{i}', EMBER, 0.0)
    g = rounded_mesh(f'PanelRim{i}', w + 0.03, ph + 0.03, 0.055, mat=gm); g.parent = pe; g.location.z = -0.004
    keyed(ge.inputs['Strength'], [(f0, 0.0), (f0 + 10, 2.4), (f0 + 40, 1.2)]); visible(g, [(f0, END)])

# ---------------------------------------------------------------- set & light
def keep_off_floor(floor_ob, light_names):
    """Light linking: these lights still light the hero, but not the glossy floor (no light-shaped streaks in it)."""
    coll = bpy.data.collections.new('FloorOnly'); coll.objects.link(floor_ob)
    for nm in light_names:
        ob = bpy.data.objects[nm]; ob.light_linking.receiver_collection = coll
        for co in coll.collection_objects: co.light_linking.link_state = 'EXCLUDE'      # the floor is its only member
bpy.ops.mesh.primitive_plane_add(size=80, location=(0, 30, 0.5), rotation=(math.radians(90), 0, 0)); bd = bpy.context.active_object
bm_ = bpy.data.materials.new('Backdrop'); bm_.use_nodes = True; bn = bm_.node_tree; bn.nodes.clear()
btc = bn.nodes.new('ShaderNodeTexCoord'); bgr = bn.nodes.new('ShaderNodeTexGradient'); bgr.gradient_type = 'SPHERICAL'
bmp = bn.nodes.new('ShaderNodeMapping'); bmp.inputs['Scale'].default_value = (0.05, 0.05, 0.05)
bpw = bn.nodes.new('ShaderNodeMath'); bpw.operation = 'POWER'; bpw.inputs[1].default_value = 3.0
bmu = bn.nodes.new('ShaderNodeMath'); bmu.operation = 'MULTIPLY'; keyed(bmu.inputs[1], [(1, 0.0), (8, 0.0), (60, 0.07), (BOUGHT, 0.08), (BOUGHT + 30, 0.13)])
bem = bn.nodes.new('ShaderNodeEmission'); bem.inputs['Color'].default_value = (*EMBER, 1); bo = bn.nodes.new('ShaderNodeOutputMaterial')
bn.links.new(btc.outputs['Object'], bmp.inputs['Vector']); bn.links.new(bmp.outputs['Vector'], bgr.inputs['Vector'])
bn.links.new(bgr.outputs['Fac'], bpw.inputs[0]); bn.links.new(bpw.outputs[0], bmu.inputs[0]); bn.links.new(bmu.outputs[0], bem.inputs['Strength'])
bn.links.new(bem.outputs[0], bo.inputs['Surface']); bd.data.materials.append(bm_)
# the impact: two long orange rims slam on, then settle; key and fill come up as the screen wakes
rimL = look_light('RimL', (-2.0, 1.6, 0.6), (0, 0, 0), 0.18, 0.0, color=EMBER, size_y=3.4)
rimR = look_light('RimR', (2.0, 1.4, 0.2), (0, 0, 0), 0.18, 0.0, color=(1.0, 0.62, 0.36), size_y=3.4)
for l in (rimL, rimR): keyed_energy(l, [(1, 520.0), (4, 260.0), (40, 170.0), (BOUGHT, 150.0), (END, 120.0)])
key = look_light('Key', (-2.2, -3.0, 3.2), (0, 0, 0), 2.0, 0.0, color=(0.92, 0.94, 1.0))
keyed_energy(key, [(1, 0.0), (WAKE, 0.0), (WAKE + 20, 120.0)])
top = look_light('Top', (0.2, 0.3, 3.4), (0, 0, 0), 1.2, 0.0, color=(1.0, 0.86, 0.72)); keyed_energy(top, [(1, 90.0), (6, 35.0), (END, 30.0)])
glass = look_light('GlassStrip', (-2.6, -2.4, 1.0), (0, 0, 0), 0.9, 0.0, size_y=4.0)       # a reflection travels across the glass
keyed_energy(glass, [(40, 0.0), (52, 5.0), (92, 5.0), (104, 0.0)])
keys(glass, 'location', [(40, (-2.6, -2.4, 1.0)), (104, (2.6, -2.4, 0.2))], interp='SINE', easing='EASE_IN_OUT')
dust = [Vector((random.uniform(-1.9, 1.9), random.uniform(-1.4, 3), random.uniform(-1.2, 1.8))) for _ in range(700)]
particles('Dust', dust, [d_ + Vector((random.uniform(-0.1, 0.1), 0, random.uniform(0.1, 0.4))) for d_ in dust],
          [Vector((0, 0, 0))] * len(dust), [END] * len(dust), 1, settle=5, base=0.0016, fly=0.0, noise_amp=0.12, appear=8, glow=0.2)
for ob in bpy.data.objects:
    if ob.type == 'LIGHT': ob.visible_camera = False
keep_off_floor(FLOOR, ('RimL', 'RimR', 'GlassStrip', 'Top'))

# ---------------------------------------------------------------- camera (f-numbers scaled for the ~11x set)
def orbit(deg, r, h): a = math.radians(deg); return (r * math.sin(a), -r * math.cos(a), h)
cam = Camera(lens=50, fstop=0.5)
cam.key(1, orbit(-68, 3.6, 0.35), (0, 0, 0.1), (0, 0, 0.1))
cam.key(50, orbit(-40, 3.4, 0.3), (0, 0, 0.08), (0, 0, 0.08))
cam.key(100, orbit(-8, 3.2, 0.25), (0, 0, 0.1), (0, 0, 0.1))
cam.key(ARTIST + 6, (0.15, -2.45, Z(0.42) + 0.06), (0, 0, Z(0.42)), (0, 0, Z(0.42)), 0.45)          # into the screen: the artist
cam.key(ARTIST + 44, (0.08, -2.25, Z(0.78) + 0.04), (0, 0, Z(0.8)), (0, 0, Z(0.8)))                 # down to Trade
cam.key(FORM + 8, (-0.04, -2.3, Z(0.58) + 0.04), (0, 0, Z(0.58)), (0, 0, Z(0.58)))                  # the form
cam.key(BOUGHT, (0.03, -2.35, Z(0.72) + 0.03), (0, 0, Z(0.72)), (0, 0, Z(0.72)))
cam.key(BOUGHT + 18, (0.05, -2.6, Z(0.66) + 0.04), (0, 0, Z(0.66)), (0, 0, Z(0.66)))               # "Bought" holds
cam.key(BOUGHT + 64, orbit(8, 8.2, 0.7), (0.0, 0.0, 0.1), (0, -0.6, 0.0), 1.1)                      # pull back: the chart + panels
cam.key(END, orbit(34, 7.0, 0.35), (0.0, 0.3, 0.05), (0, -0.4, 0.0), 1.2)                              # arc out through the market
cam.smooth()
for f, (dx, dz) in ((2, (0.02, -0.014)), (4, (-0.012, 0.009)), (6, (0.006, -0.004))):                # the impact
    sc.frame_set(f); cam.target.location = cam.target.location + Vector((dx, 0, dz)); cam.target.keyframe_insert('location', frame=f)
cam.bind(1)
render(os.path.join(HERE, 'frames_reveal'))
