"""THE MOVE: the opening, 0–3 s (frames 1–90). A huge virtual portfolio-gain counter climbs to +$1,432
in front of a giant orange market chart that rises out of a glossy black-and-chrome market floor.

Both the chart and the counter come from the illustrative trade that capture_move.js ran through
NEXT's real engine on demo data (journey.json):
  - the chart is Kito Vale's recorded price, trade by trade: $22.03 at listing, then $22.53 after the
    pick, rising to $29.82;
  - the counter is the position's realistic exit value at each point of that line, minus the $4,500
    cost. It uses the engine's own sell maths (quoteSell: price impact, average-price fill), the same
    figure the app shows as "Unrealized P&L". It starts at +$0 after the pick and lands on +$1,432 at
    the exit price ($29.82), where the real sale realized exactly +$1,432.00.
The disclosure (illustrative, virtual Credits, no cash value) is composited in post at full resolution.

  blender-venv/bin/python move_hook.py -- --journey J.json --assets DIR [--preview] [--frames a-b|--list a,b] [--out DIR] [--hook a|c]
  (--hook c: the chart-erupts camera; hook B is move_hookb.py)
"""
import json, math, os, sys
MHERE = os.path.dirname(os.path.abspath(__file__))
for p in (MHERE, os.path.join(MHERE, '..', 'commercial')):
    if p not in sys.path: sys.path.insert(0, p)
from next3d import *
import bpy

J = json.load(open(arg('--journey', os.path.join(MHERE, 'journey.json'))))
ASSETS = arg('--assets', os.path.join(MHERE, 'assets'))
END = 90
sc = init(END, samples=int(arg('--samples', '40')))
if GPU:                                         # half-float EXR (DWAA) under the f####.hdr name, as world_move.compact
    sc.render.image_settings.file_format = 'OPEN_EXR'; sc.render.image_settings.color_depth = '16'; sc.render.image_settings.exr_codec = 'DWAA'
    sc.render.use_file_extension = False
sc.cycles.max_bounces = 6; sc.cycles.glossy_bounces = 3; sc.cycles.transmission_bounces = 4; sc.cycles.diffuse_bounces = 2
sc.cycles.sample_clamp_indirect = 6.0
sc.render.motion_blur_shutter = 0.4

# ---------------------------------------------------------------- the data (real demo run)
SERIES = J['series'][:-1]                       # listing ... exit (the last point is after the sale)
PICK = J['plan']['pick']; SHARES = J['hero_buy']['shares']
def exit_pnl(p):
    """The engine's sell-all quote (lib/next-market.ts quoteSell) minus cost: the app's realistic Unrealized P&L."""
    notional = round(SHARES * p); post = max(100, round(p * (1 - notional / 1_000_000 * 0.05)))
    fill = max(100, round((p + post) / 2)); return round(SHARES * fill) - PICK
PNL = [exit_pnl(p) for p in SERIES]             # PNL[1] = 0 (just after the pick) ... PNL[-1] = 143200
assert PNL[-1] == 143_200 and PNL[1] == 0, PNL
N = len(SERIES)

# the climb: the chart's head moves from just after the pick to the exit, easing into the lock
LOCK = 46                                       # the counter locks on +$1,432 (beat 4: 1.5 s)
I0 = 1.35                                       # frame 1 starts already moving (index along the series)
def head_index(f):
    t = min(max((f - 1) / (LOCK - 1), 0.0), 1.0)
    e = 1 - (1 - t) ** 2.6                      # fast start, decisive ease into the lock
    return I0 + (N - 1 - I0) * e
def value_at(idx):
    k = min(int(idx), N - 2); fr = idx - k
    return PNL[k] + (PNL[k + 1] - PNL[k]) * fr
def money(cents):
    d = int(round(cents / 100)); return f"+${d:,}" if d >= 0 else f"−${-d:,}"

# ---------------------------------------------------------------- materials
lacquer = principled('BlackLacquer', (0.0025, 0.0024, 0.0026), rough=0.05, coat=1.0)
chrome = principled('Chrome', (0.9, 0.9, 0.92), metallic=1.0, rough=0.07)
dark_chrome = principled('DarkChrome', (0.32, 0.31, 0.31), metallic=1.0, rough=0.14)
brushed = principled('Brushed', (0.55, 0.55, 0.57), metallic=1.0, rough=0.22, aniso=0.6)

# ---------------------------------------------------------------- the floor: black lacquer with chrome seams
bpy.ops.mesh.primitive_plane_add(size=160, location=(0, 20, 0)); fl = bpy.context.active_object
m = principled('Floor', (0.003, 0.0028, 0.003), rough=0.045, coat=1.0)
nt = m.node_tree; b = nt.nodes['Principled BSDF']
tc = nt.nodes.new('ShaderNodeTexCoord'); mp = nt.nodes.new('ShaderNodeMapping'); mp.inputs['Scale'].default_value = (1 / 3.2, 1 / 3.2, 1)
nt.links.new(tc.outputs['Object'], mp.inputs['Vector'])
br = nt.nodes.new('ShaderNodeTexBrick'); br.offset = 0.0
br.inputs['Mortar Size'].default_value = 0.006; br.inputs['Mortar Smooth'].default_value = 0.2
br.inputs['Brick Width'].default_value = 1.0; br.inputs['Row Height'].default_value = 1.0
for k_, c_ in (('Color1', (0, 0, 0, 1)), ('Color2', (0, 0, 0, 1)), ('Mortar', (1, 1, 1, 1))): br.inputs[k_].default_value = c_
nt.links.new(mp.outputs['Vector'], br.inputs['Vector'])
mx = nt.nodes.new('ShaderNodeMix'); mx.data_type = 'RGBA'
nt.links.new(br.outputs['Fac'], mx.inputs['Factor'])
sock(mx.inputs, 'A', 'RGBA').default_value = (0.003, 0.0028, 0.003, 1); sock(mx.inputs, 'B', 'RGBA').default_value = (0.16, 0.16, 0.17, 1)
nt.links.new(sock(mx.outputs, 'Result', 'RGBA'), b.inputs['Base Color']); nt.links.new(br.outputs['Fac'], b.inputs['Metallic'])
rr = nt.nodes.new('ShaderNodeMapRange'); rr.inputs['To Min'].default_value = 0.045; rr.inputs['To Max'].default_value = 0.4
nt.links.new(br.outputs['Fac'], rr.inputs['Value']); nt.links.new(rr.outputs[0], b.inputs['Roughness'])
fl.data.materials.append(m)

# ---------------------------------------------------------------- the chart: Kito Vale's real price path, huge
CX0, CX1, CY, CZ0, CH = -3.25, 3.35, 6.5, 0.35, 6.7
lo, hi = min(SERIES), max(SERIES)
def chart_pt(idx):
    k = min(int(idx), N - 2); fr = idx - k
    v = SERIES[k] + (SERIES[k + 1] - SERIES[k]) * fr
    return Vector((CX0 + (CX1 - CX0) * idx / (N - 1), CY, CZ0 + 0.25 + (v - lo) / (hi - lo) * CH))
pts = [chart_pt(i) for i in range(N)]
cu = bpy.data.curves.new('PriceLine', 'CURVE'); cu.dimensions = '3D'
sp = cu.splines.new('POLY'); sp.points.add(N - 1)
for i, p in enumerate(pts): sp.points[i].co = (*p, 1)
cu.bevel_depth = 0.045; cu.bevel_resolution = 4; cu.bevel_factor_mapping_end = 'SPLINE'
line = link(bpy.data.objects.new('PriceLine', cu)); line_m, line_e = emissive('PriceLineM', EMBER_HOT, 38.0); cu.materials.append(line_m)
# the glass area under the line: an orange gradient, fading to the floor
me = bpy.data.meshes.new('ChartArea'); verts, faces = [], []
for i, p in enumerate(pts):
    verts += [(p.x, p.y + 0.02, p.z), (p.x, p.y + 0.02, CZ0)]
    if i: faces.append((2 * i - 2, 2 * i, 2 * i + 1, 2 * i - 1))
me.from_pydata(verts, [], faces); me.update()
area_ob = link(bpy.data.objects.new('ChartArea', me))
am = bpy.data.materials.new('ChartAreaM'); am.use_nodes = True; an = am.node_tree; an.nodes.clear()
tcA = an.nodes.new('ShaderNodeTexCoord'); sepA = an.nodes.new('ShaderNodeSeparateXYZ'); an.links.new(tcA.outputs['Object'], sepA.inputs[0])
# vertical fade (object z), and the reveal: nothing to the right of the chart's head (object x vs a keyed threshold)
fz = an.nodes.new('ShaderNodeMapRange'); fz.inputs['From Min'].default_value = CZ0; fz.inputs['From Max'].default_value = CZ0 + CH + 0.3
fz.inputs['To Min'].default_value = 0.0; fz.inputs['To Max'].default_value = 1.0; an.links.new(sepA.outputs['Z'], fz.inputs['Value'])
pw = an.nodes.new('ShaderNodeMath'); pw.operation = 'POWER'; pw.inputs[1].default_value = 1.6; an.links.new(fz.outputs[0], pw.inputs[0])
rv = an.nodes.new('ShaderNodeMath'); rv.operation = 'LESS_THAN'; an.links.new(sepA.outputs['X'], rv.inputs[0])
REVEAL_X = rv.inputs[1]
mul = an.nodes.new('ShaderNodeMath'); mul.operation = 'MULTIPLY'; an.links.new(pw.outputs[0], mul.inputs[0]); an.links.new(rv.outputs[0], mul.inputs[1])
eA = an.nodes.new('ShaderNodeEmission'); eA.inputs['Color'].default_value = (*EMBER, 1)
gA = an.nodes.new('ShaderNodeMath'); gA.operation = 'MULTIPLY'; gA.inputs[1].default_value = 0.9
# fine holographic scan-bands across the glass (object-space, so they stay locked to the chart)
wvA = an.nodes.new('ShaderNodeTexWave'); wvA.wave_type = 'BANDS'; wvA.bands_direction = 'Z'; wvA.inputs['Scale'].default_value = 7.0
wvA.inputs['Distortion'].default_value = 0.0; an.links.new(tcA.outputs['Object'], wvA.inputs['Vector'])
bandA = an.nodes.new('ShaderNodeMapRange'); bandA.inputs['To Min'].default_value = 0.62; bandA.inputs['To Max'].default_value = 1.0
an.links.new(wvA.outputs['Fac'], bandA.inputs['Value'])
mulB = an.nodes.new('ShaderNodeMath'); mulB.operation = 'MULTIPLY'; an.links.new(mul.outputs[0], mulB.inputs[0]); an.links.new(bandA.outputs[0], mulB.inputs[1])
an.links.new(mulB.outputs[0], gA.inputs[0]); an.links.new(gA.outputs[0], eA.inputs['Strength'])
trA = an.nodes.new('ShaderNodeBsdfTransparent'); addA = an.nodes.new('ShaderNodeAddShader'); oA = an.nodes.new('ShaderNodeOutputMaterial')
an.links.new(trA.outputs[0], addA.inputs[0]); an.links.new(eA.outputs[0], addA.inputs[1]); an.links.new(addA.outputs[0], oA.inputs['Surface'])
area_ob.data.materials.append(am); area_ob.visible_shadow = False
# price grid behind the line: faint horizontal levels and one vertical rule per trading day
grid_m, grid_e = emissive('ChartGrid', (1.0, 0.55, 0.32), 0.22)
for k in range(5):
    z = CZ0 + 0.25 + CH * k / 4
    bpy.ops.mesh.primitive_cube_add(size=1, location=(0, CY + 0.6, z)); g = bpy.context.active_object
    g.scale = (CX1 - CX0 + 0.8, 0.0035, 0.0035); g.data.materials.append(grid_m); g.visible_shadow = False
DAYS = sorted({t['at'][:10] for t in J['trades'] if not (t['hero'] and t['type'] == 'sell')})
for d in range(len(DAYS) + 1):
    x = CX0 + (CX1 - CX0) * d / len(DAYS)
    bpy.ops.mesh.primitive_cube_add(size=1, location=(x, CY + 0.6, CZ0 + CH / 2 + 0.3)); g = bpy.context.active_object
    g.scale = (0.0035, 0.0035, CH + 0.6); g.data.materials.append(grid_m); g.visible_shadow = False
# volume: one polished bar per real trade (height = credits traded), rising as the head passes
vol_m = principled('VolumeGlass', (0.02, 0.012, 0.01), rough=0.08, coat=1.0, emission=EMBER, estr=1.1)
vol_dn = principled('VolumeSell', (0.02, 0.01, 0.01), rough=0.08, coat=1.0, emission=(0.9, 0.08, 0.05), estr=0.9)
trades = [t for t in J['trades'] if not (t['hero'] and t['type'] == 'sell')]
vmax = max(t['cents'] for t in trades)
BARS = []
for i, t in enumerate(trades, start=1):
    x = CX0 + (CX1 - CX0) * i / (N - 1)
    h = 0.15 + 1.0 * t['cents'] / vmax
    bar = rounded_slab(f'Vol{i}', 0.17, h, 0.03, depth=0.09, bevel=0.012, mat=vol_m if t['type'] == 'buy' else vol_dn)
    bar.rotation_euler = (math.radians(90), 0, 0); bar.location = (x, CY - 0.8, CZ0)
    bar.data.transform(Matrix.Translation((0, h / 2, 0)))          # grow from the floor
    BARS.append((bar, i))
# the head: a white-hot node riding the line, with its own light
head_m, head_e = emissive('Head', (1.0, 0.75, 0.55), 60.0)
bpy.ops.mesh.primitive_uv_sphere_add(radius=0.1, segments=24, ring_count=12); head = bpy.context.active_object; head.data.materials.append(head_m)
hl = bpy.data.lights.new('HeadLight', 'POINT'); hl.energy = 2600; hl.color = EMBER_HOT; hl.shadow_soft_size = 0.4
head_light = link(bpy.data.objects.new('HeadLight', hl)); head_light.parent = head

# ---------------------------------------------------------------- the counter: polished chrome numerals, lit faces
TEXT_Z, TEXT_Y, EXTR, BEV = 3.45, 0.0, 0.16, 0.018
face_white, _ = emissive('CounterFace', (1.0, 0.94, 0.86), 1.7)
face_ember, _ = emissive('CounterSign', EMBER_HOT, 2.6)
def counter_text(name, mats, extrude, bevel):
    c = bpy.data.curves.new(name, 'FONT'); c.font = bpy.data.fonts.load(FONT_DISPLAY, check_existing=True)
    c.size = 1.0; c.align_x = 'CENTER'; c.align_y = 'CENTER'; c.extrude = extrude; c.bevel_depth = bevel; c.bevel_resolution = 3
    for mm in mats: c.materials.append(mm)
    ob = link(bpy.data.objects.new(name, c)); ob.rotation_euler = (math.radians(90), 0, 0)
    return ob
body = counter_text('CounterBody', [chrome, dark_chrome], EXTR, BEV)
face = counter_text('CounterFace', [face_white, face_ember], 0.0, 0.0)
def set_counter(txt):
    for ob in (body, face):
        ob.data.body = txt
        for i, ch in enumerate(ob.data.body_format): ch.material_index = 1 if txt[i] in '+$−' else 0
# size: the final figure spans 2.95 m (most of the vertical frame's width at the hero distance)
set_counter(money(PNL[-1])); bpy.context.view_layer.update()
w = max(v[0] for v in body.bound_box) - min(v[0] for v in body.bound_box)
S_ = 2.95 / w
for ob in (body, face): ob.scale = (S_, S_, S_)
body.location = (0, TEXT_Y, TEXT_Z); face.location = (0, TEXT_Y - (EXTR + BEV) * S_ - 0.003, TEXT_Z)
body.data.materials[1] = dark_chrome
# ---------------------------------------------------------------- the hall: chrome monoliths and floating holo displays
for side in (-1, 1):
    for j, y in enumerate((4.0, 12.0, 20.0)):
        x = side * (4.3 + 0.35 * j)
        col = rounded_slab(f'Mono{side}{j}', 1.1, 14.0, 0.08, depth=0.55, bevel=0.03, mat=dark_chrome if j % 2 else brushed)
        col.rotation_euler = (math.radians(90), 0, math.radians(90)); col.location = (x, y, 7.0)
        strip_m, _ = emissive(f'MonoStrip{side}{j}', EMBER_HOT, 9.0)
        bpy.ops.mesh.primitive_cube_add(size=1, location=(x - side * 0.56, y, 7.0)); st = bpy.context.active_object
        st.scale = (0.012, 0.05, 13.4); st.data.materials.append(strip_m)
# ---------------------------------------------------------------- light
w_ = sc.world.node_tree.nodes['Background']; w_.inputs['Color'].default_value = (0.0012, 0.0008, 0.0007, 1)
look_light('KeyTop', (0, -4.5, 9.0), (0, 0, 3.0), 6.0, 900, (1.0, 0.96, 0.92), size_y=2.0)     # long softbox: the chrome's top highlight
look_light('RimL', (-6.0, 3.0, 4.0), (0, 0, 3.0), 1.2, 1400, EMBER_HOT, size_y=6.0)
look_light('RimR', (6.0, 3.0, 4.0), (0, 0, 3.0), 1.2, 1100, (1.0, 0.55, 0.3), size_y=6.0)
look_light('FloorWash', (0, 5.0, 0.6), (0, -6, 0), 8.0, 140, EMBER, size_y=0.6)
look_light('CoolFill', (3.5, -9.0, 2.0), (0, 0, 3.0), 3.0, 120, (0.75, 0.85, 1.0))
for ob in bpy.data.objects:                           # lights light and reflect, but are never seen as panels
    if ob.type == 'LIGHT': ob.visible_camera = False
bpy.data.objects['FloorWash'].visible_glossy = False      # a wash, not a reflected panel
# (atmosphere is added in post: a depth-free glow haze, far cheaper than a scattering volume)

# ---------------------------------------------------------------- per-frame state (also runs on motion-blur subframes)
def update(scene, *_):
    f = scene.frame_current + scene.frame_subframe
    idx = head_index(f)
    cu.bevel_factor_end = idx / (N - 1)
    REVEAL_X.default_value = chart_pt(idx).x
    head.location = chart_pt(idx)
    set_counter(money(value_at(idx)))
    for bar, i in BARS:
        s = min(max((idx - i + 0.6) / 0.6, 0.0), 1.0); s = s * s * (3 - 2 * s)
        bar.scale = (1, max(s, 0.001), 1); bar.hide_render = s < 0.02
    # the lock: the figure catches the light
    k = max(0.0, 1 - abs(f - LOCK) / 7.0) if f >= LOCK - 1 else 0.0
    face_white.node_tree.nodes['Emission'].inputs['Strength'].default_value = 1.7 + 2.6 * k
    head_e.inputs['Strength'].default_value = 60.0 + 140.0 * k
bpy.app.handlers.frame_change_pre.append(update)

# ---------------------------------------------------------------- camera: low, close and pushing; a kick on the lock
cam = Camera(lens=28, fstop=3.5)
F = (0, 0, TEXT_Z)
if arg('--hook', 'a') == 'c':
    # hook C: the chart erupts. The camera races up the price line behind the counter's plane, then swoops
    # back over it; the counter materializes on the lock (it is hidden while the lens is behind it).
    for f in (1, 10, 20, 30):
        h = chart_pt(head_index(f))
        cam.key(f, (h.x - 0.5, CY - 4.4, max(0.55, h.z - 0.3)), (h.x + 0.7, CY, h.z + 0.2), tuple(h), 4.0, 24)
    cam.key(LOCK - 4, (1.2, -2.6, 5.4), (0.0, 0.0, 3.6), F, 3.5, 26)
    cam.key(LOCK + 4, (0.12, -7.3, 1.85), (0.0, 0.0, 3.2), F, 3.5, 28)
    cam.key(END, (-0.2, -7.0, 1.95), (-0.04, 0.0, 3.24), F)
    for ob in (body, face):
        ob.keyframe_insert('scale', frame=LOCK + 1); sc_ = tuple(ob.scale)
        ob.scale = (0.0001,) * 3; ob.keyframe_insert('scale', frame=LOCK - 4)
        ob.scale = (sc_[0] * 1.06,) * 3; ob.keyframe_insert('scale', frame=LOCK - 1)
        ob.scale = sc_
else:
    cam.key(1, (0.45, -8.7, 1.55), (0.08, 0.0, 3.05), F, 3.5, 28)
    cam.key(LOCK - 2, (0.12, -7.65, 1.75), (0.02, 0.0, 3.15), F)
    cam.key(LOCK + 2, (0.08, -7.5, 1.79), (0.0, 0.0, 3.17), F)
    cam.key(END, (-0.2, -7.1, 1.9), (-0.04, 0.0, 3.22), F)
cam.smooth()
render(os.path.join(MHERE, 'frames', 'hook'))
