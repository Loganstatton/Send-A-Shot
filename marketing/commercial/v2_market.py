"""v2 shots 3–4 (8.4–13.8 s, global frames 253–414): THE PRICE MOVES, then
the PORTFOLIO and the LEADERBOARD. 162 frames, one hard cut on the beat:
  A  1–72    Juno Marrow's in-app price history after Maya's buy, drawn as a
             big glowing chart rising from the "you bought" point (captions
             pinned in post via projections.json)
  B  73–162  the phone: portfolio (+16.1%), then Top Traders with #1 lit up

  blender-venv/bin/python v2_market.py -- --assets DIR [--preview|--gpu] [--frames ...] [--out DIR] [--export-proj FILE]
"""
import json, math, os, random, sys
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from next3d import *
from mathutils import Vector

random.seed(33)
sc = init(162)
S = lambda name: os.path.join(ASSETS, name)
J = json.load(open(S('juno.json')))
series = json.load(open(S('series.json')))
Z = lambda v: (0.5 - v) * SCREEN_H

# ================================================================ A: the chart
X0, X1, BASE, HGT = -0.72, 0.72, -0.78, 1.45
vals = smooth_series(J['history'], 90)
line, pts = chart_line('JunoLine', vals, X0, X1, BASE, HGT, radius=0.016, strength=9.0, color=EMBER_HOT)
cu = line.data
R0, R1 = 4, 54                                # the line draws on between these frames
def reveal(f):
    x = min(max((f - R0) / (R1 - R0), 0.0), 1.0); return x * x * (3 - 2 * x)
def along(t):
    k = t * (len(pts) - 1); i = min(int(k), len(pts) - 2); a = k - i
    return pts[i] * (1 - a) + pts[i + 1] * a
head_m, head_e = emissive('Head', EMBER_HOT, 14.0)
bpy.ops.mesh.primitive_uv_sphere_add(radius=0.03, segments=32, ring_count=16); head = bpy.context.active_object; head.data.materials.append(head_m)
hl = bpy.data.lights.new('HeadLight', 'POINT'); hl.energy = 6; hl.color = EMBER_HOT; hl.shadow_soft_size = 0.05
hlo = link(bpy.data.objects.new('HeadLight', hl)); hlo.parent = head
for f in range(1, 73):
    t = reveal(f)
    cu.bevel_factor_end = max(t, 0.002); cu.keyframe_insert('bevel_factor_end', frame=f)
    head.location = along(t); head.keyframe_insert('location', frame=f)
set_interp(cu, 'LINEAR'); set_interp(head, 'LINEAR')
visible(head, [(R0, 72)])

# glow under the curve, revealed with the line
bm = bmesh.new(); prev = None
for p in pts:
    a, b = bm.verts.new((p.x, 0.02, BASE)), bm.verts.new((p.x, 0.02, p.z))
    if prev: bm.faces.new((prev[0], a, b, prev[1]))
    prev = (a, b)
me = bpy.data.meshes.new('Fill'); bm.to_mesh(me); bm.free()
fill = link(bpy.data.objects.new('Fill', me))
fm = bpy.data.materials.new('FillM'); fm.use_nodes = True; fn = fm.node_tree; fn.nodes.clear()
ftc = fn.nodes.new('ShaderNodeTexCoord'); fsx = fn.nodes.new('ShaderNodeSeparateXYZ'); fn.links.new(ftc.outputs['Object'], fsx.inputs[0])
def FM(op, a, b):
    n = fn.nodes.new('ShaderNodeMath'); n.operation = op
    for i, v in enumerate((a, b)):
        if isinstance(v, (int, float)): n.inputs[i].default_value = v
        else: fn.links.new(v, n.inputs[i])
    return n
thr = FM('LESS_THAN', fsx.outputs['X'], 0.0)
for f in range(1, 73):
    thr.inputs[1].default_value = along(reveal(f)).x if reveal(f) > 0 else X0 - 1
    thr.inputs[1].keyframe_insert('default_value', frame=f)
hgt = FM('POWER', FM('MAXIMUM', FM('DIVIDE', FM('SUBTRACT', fsx.outputs['Z'], BASE).outputs[0], HGT + 0.15).outputs[0], 0.0).outputs[0], 2.2)
stren = FM('MULTIPLY', FM('MULTIPLY', hgt.outputs[0], thr.outputs[0]).outputs[0], 0.55)
fe = fn.nodes.new('ShaderNodeEmission'); fe.inputs['Color'].default_value = (*EMBER, 1); fn.links.new(stren.outputs[0], fe.inputs['Strength'])
ftr = fn.nodes.new('ShaderNodeBsdfTransparent'); fad = fn.nodes.new('ShaderNodeAddShader'); fo = fn.nodes.new('ShaderNodeOutputMaterial')
fn.links.new(ftr.outputs[0], fad.inputs[0]); fn.links.new(fe.outputs[0], fad.inputs[1]); fn.links.new(fad.outputs[0], fo.inputs['Surface'])
fill.data.materials.append(fm)

# "you bought here": a marker + a level line at the buy price
buy_m, buy_e = emissive('BuyDot', PAPER, 0.0)
bpy.ops.mesh.primitive_uv_sphere_add(radius=0.028, segments=32, ring_count=16, location=pts[0]); buy = bpy.context.active_object; buy.data.materials.append(buy_m)
for f, v in ((2, 0.0), (6, 14.0), (14, 6.0)):
    buy_e.inputs['Strength'].default_value = v; buy_e.inputs['Strength'].keyframe_insert('default_value', frame=f)
lvl_m, lvl_e = emissive('Level', PAPER, 0.0)
lc = bpy.data.curves.new('Level', 'CURVE'); lc.dimensions = '3D'; sp = lc.splines.new('POLY'); sp.points.add(1)
sp.points[0].co = (X0, 0.05, pts[0].z, 1); sp.points[1].co = (X1 + 0.05, 0.05, pts[0].z, 1); lc.bevel_depth = 0.0035
lvl = link(bpy.data.objects.new('Level', lc)); lvl.data.materials.append(lvl_m)
for f, v in ((2, 0.0), (10, 1.6)):
    lvl_e.inputs['Strength'].default_value = v; lvl_e.inputs['Strength'].keyframe_insert('default_value', frame=f)
# faint price grid behind
for k in range(6):
    gc = bpy.data.curves.new(f'Grid{k}', 'CURVE'); gc.dimensions = '3D'; gs = gc.splines.new('POLY'); gs.points.add(1)
    z = BASE + 0.15 + HGT * k / 5
    gs.points[0].co = (X0 - 0.4, 0.35, z, 1); gs.points[1].co = (X1 + 0.4, 0.35, z, 1); gc.bevel_depth = 0.002
    link(bpy.data.objects.new(f'Grid{k}', gc)).data.materials.append(emissive(f'GridM{k}', (0.5, 0.25, 0.18), 0.22)[0])
floor(-1.0, grid=0.35)
dust = [Vector((random.uniform(-2, 2), random.uniform(-1.0, 3), random.uniform(-1.0, 1.6))) for _ in range(500)]
particles('Dust', dust, [d + Vector((0, 0, 0.08)) for d in dust], [Vector((0, 0, 0))] * len(dust), [1.0] * len(dust), 1,
          settle=80, base=0.0022, fly=0.0, noise_amp=0.0, appear=1, vanish=(70, 73), glow=0.35)
camA = Camera(lens=28, fstop=3.2)
camA.key(1, (-0.38, -4.35, -0.3), (-0.12, 0, 0.0), (0, 0, 0))
camA.key(72, (0.32, -3.85, 0.28), (0.12, 0, 0.18), (0, 0, 0))
camA.smooth(); camA.bind(1)
look_light('A_Key', (0, -3, 3), (0, 0.5, 0), 6, 80)

# ================================================================ B: phone — portfolio, then Top Traders
BX = 50
phone, scr = build_phone('PhoneB', [(S('07-portfolio.png'), 1, 'cut'), (S('08b-leaderboard-rows.png'), 109, 'push')], back_logo=False, screen_glow=1.08)
phone.location = (BX, 0, 0)
keys(phone, 'rotation_euler', [(73, (math.radians(3), 0, math.radians(-9))), (162, (math.radians(1), 0, math.radians(6)))], interp='LINEAR')
# #1 row lights up (row box measured on the capture: u .054–.946, v .382–.468)
ow, oh = 0.892 * SCREEN_W, 0.086 * SCREEN_H
oc = bpy.data.curves.new('RowGlow', 'CURVE'); oc.dimensions = '3D'; osp = oc.splines.new('POLY')
rp = rounded_rect_points(ow, oh, 0.03, 8); osp.points.add(len(rp) - 1)
for i, (x, y) in enumerate(rp): osp.points[i].co = (x, y, 0, 1)
osp.use_cyclic_u = True; oc.bevel_depth = 0.0032
row_m, row_e = emissive('RowGlowM', EMBER_HOT, 0.0)
row = link(bpy.data.objects.new('RowGlow', oc)); row.data.materials.append(row_m)
row.parent = scr; row.location = screen_point(scr, 0.5, 0.425, 0.004)
visible(row, [(114, 162)])
for f, v in ((114, 0.0), (119, 9.0), (128, 3.5), (145, 5.0), (162, 3.5)):
    row_e.inputs['Strength'].default_value = v; row_e.inputs['Strength'].keyframe_insert('default_value', frame=f)
names = list(series)[:3]
for k, nm in enumerate(names):   # out-of-focus chart glow behind the phone
    chart_line(f'BLine{k}', smooth_series(series[nm], 60), BX - 3.5, BX + 3.5, -1.6 + 0.6 * k, 2.4, depth_y=3.5 + k, radius=0.03, strength=4.0,
               color=(EMBER_HOT, (1.0, 0.55, 0.25), (1.0, 0.8, 0.62))[k])
camB = Camera(lens=50, fstop=4.0)
camB.key(73, (BX + 0.22, -3.2, Z(0.52) + 0.08), (BX, 0, Z(0.52)))
camB.key(106, (BX - 0.04, -2.7, Z(0.58) + 0.03), (BX, 0, Z(0.58)))
camB.key(109, (BX + 0.06, -2.95, Z(0.52) + 0.05), (BX, 0, Z(0.52)))
camB.key(162, (BX - 0.08, -2.35, Z(0.45) + 0.02), (BX, 0, Z(0.45)))
camB.smooth(); camB.bind(73)
rigB = link(bpy.data.objects.new('RigB', None)); rigB.location = (BX, 0, 0)
for nm, loc, sz, szy, e in (('B_StripL', (BX - 2.6, -2.2, 1.6), 0.12, 5.0, 150), ('B_StripR', (BX + 2.8, -1.4, 0.6), 0.12, 5.0, 110)):
    look_light(nm, loc, (BX, 0, 0), sz, e, size_y=szy).parent = rigB
look_light('B_Rim', (BX + 0.4, 3.0, 1.4), (BX, 0, 0), 3.0, 380, color=EMBER)

if arg('--export-proj'):
    export_projection(arg('--export-proj'), {'buy': (camA.cam, buy), 'head': (camA.cam, head)}, range(1, 73), offset=252)
    sys.exit(0)
render(os.path.join(HERE, 'frames_v2_market'))
