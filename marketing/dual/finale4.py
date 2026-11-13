"""SCOUT × NEXT — "BEFORE THE BREAKOUT": THE FOUNDING BELIEVER + ONE VISION (28–40 s, global 841–1200; local 1–360).

  local    global   time
  1–30     841–870  28.0  the market has gone dark; a small orange light; the Backer #1 card (Ad #1 v2.1
                          design, this journey's record) turns out of edge-on
  31       871      29.0  the card catches the light (spot, rims, a few sparks off its edges)
  31–165                  the camera circles it; a glint runs across the foil; it settles front-on
  165–215  1005–1055      pull back: the card recedes into the middle of a huge dark studio and
                          becomes a single point of light
  195–262                 the SCOUT workstation (left, cyan) and the NEXT phone (right, orange) light
                          up and turn toward the viewer
  238–271                 a beam of light runs from each product to the centre; they meet
  271      1111     37.0  SCOUT × NEXT (the products' real wordmarks), the final impact; hold to 40 s

Imports Ad #2's card2.py and phone2.py and the shared set builders read-only.

  blender-venv/bin/python finale4.py -- --assets DIR [--hook wide] [--preview|--gpu] [--frames a-b|--list ...] [--out DIR]
"""
import math, os, random, sys
HERE = os.path.dirname(os.path.abspath(__file__))
for p in (HERE, os.path.join(HERE, '..', 'commercial2'), os.path.join(HERE, '..', 'commercial')):
    if p not in sys.path: sys.path.insert(0, p)
from scout3d import *
from card2 import build_card
from phone2 import build_phone2
from mathutils import Vector

random.seed(841)
END = 360
sc = init(END, samples=64)
WIDE = arg('--hook') == 'wide'
if WIDE: sc.render.resolution_x, sc.render.resolution_y = 1920, 1080
S = lambda n: os.path.join(ASSETS, n)
HIT, BACK, POINT, LIT, BEAM, LOGO = 31, 165, 215, 195, 238, 271
C = Vector((0, 15.0, 1.4))                                   # the centre of the studio, where the light meets

# ---------------------------------------------------------------- the card (the approved v2.1 design)
root, tilt, face, CW, CH = build_card(S('card-hero.png'), [(1, 0.0), (20, 0.0), (HIT - 1, 0.35), (HIT, 1.3), (HIT + 12, 1.0), (BACK + 20, 1.0), (POINT, 2.5)], END)
keys(root, 'location', [(1, (0.25, 0.9, 0.05)), (HIT - 1, (0.05, 0.15, 0.02)), (110, (0, 0, 0.02)), (BACK, (0, 0, 0.0)), (POINT, tuple(C))])
keys(root, 'rotation_euler', [(1, (math.radians(4), 0, math.radians(80))), (HIT - 1, (math.radians(3), 0, math.radians(22))),
                              (110, (math.radians(1.5), 0, math.radians(4))), (BACK, (math.radians(1), 0, math.radians(-1))), (POINT, (0, 0, 0))])
keys(root, 'scale', [(BACK, (1, 1, 1)), (POINT - 4, (0.35, 0.35, 0.35)), (POINT, (0.0, 0.0, 0.0))])
for fc in iter_fcurves(root.animation_data.action):
    for kp in fc.keyframe_points:
        if round(kp.co.x) == 1: kp.interpolation = 'SINE'; kp.easing = 'EASE_OUT'
        if round(kp.co.x) == BACK: kp.interpolation = 'EXPO'; kp.easing = 'EASE_IN'
glow_m, glow_e = emissive('Ember', EMBER_HOT, 0.0)
bpy.ops.mesh.primitive_uv_sphere_add(radius=0.028, segments=24, ring_count=12, location=(-0.12, -0.25, 0.18)); ember = bpy.context.active_object
ember.data.materials.append(glow_m); key_val(glow_e.inputs['Strength'], [(1, 0.0), (12, 30.0), (HIT - 2, 80.0), (HIT, 0.0)])
keys(ember, 'scale', [(1, (0.2, 0.2, 0.2)), (20, (1, 1, 1))]); keys(ember, 'location', [(1, (-0.12, -0.25, 0.18)), (HIT - 1, (0.02, 0.05, 0.06))], interp='SINE', easing='EASE_IN_OUT')
visible(ember, [(1, HIT)])
el = bpy.data.lights.new('EmberLight', 'POINT'); el.color = EMBER_HOT; el.shadow_soft_size = 0.05
emb_l = link(bpy.data.objects.new('EmberLight', el)); emb_l.location = (0.05, 0.6, 0.05)
key_energy(emb_l, [(1, 0.0), (20, 6.0), (HIT - 1, 18.0), (HIT, 2.0), (BACK, 2.0), (BACK + 10, 0.0)])
def edge_points(n, frame):
    sc.frame_set(frame); bpy.context.view_layer.update(); mw = face.matrix_world; out = []
    for _ in range(n):
        u, s_ = random.random(), random.choice((-1, 1))
        p = Vector(((u - 0.5) * CW, s_ * CH / 2, 0)) if random.random() < 0.45 else Vector((s_ * CW / 2, (u - 0.5) * CH, 0))
        out.append(mw @ p)
    return out
ed = edge_points(500, HIT); c0 = face.matrix_world.translation.copy()
particles('HitSparks', ed, [p + (p - c0).normalized() * random.uniform(0.3, 1.0) for p in ed], [Vector((0, 0, 0.06))] * len(ed),
          [HIT + random.uniform(0, 5) for _ in ed], HIT, settle=16, base=0.0013, fly=0.0026, noise_amp=0.15, appear=HIT, vanish=(HIT + 18, HIT + 36), glow=0.4)
# the point of light the card becomes
pt_m, pt_e = emissive('CardPoint', (1.0, 0.85, 0.7), 0.0)
bpy.ops.mesh.primitive_uv_sphere_add(radius=0.06, segments=24, ring_count=12, location=tuple(C)); pt = bpy.context.active_object; pt.data.materials.append(pt_m)
key_val(pt_e.inputs['Strength'], [(POINT - 6, 0.0), (POINT, 60.0), (POINT + 10, 14.0), (BEAM, 6.0), (LOGO - 3, 40.0), (LOGO, 200.0), (LOGO + 8, 0.0)])

# ---------------------------------------------------------------- the studio: SCOUT left, NEXT right
STUDIO_Z = -1.05
bpy.ops.mesh.primitive_plane_add(size=120, location=(0, 20, STUDIO_Z)); fl = bpy.context.active_object
fl.data.materials.append(principled('StudioFloor', (0.005, 0.005, 0.0055), rough=0.08, coat=0.6))
MON_W = 3.4
mon, mscr = build_monitor('Workstation', [(S('s01-roster.png'), 1, 'cut')], width=MON_W, glow=0.0)
MON = C + Vector((-1.35, 1.9, 0.85))
mon.location = MON
keys(mon, 'rotation_euler', [(LIT - 10, (0, 0, math.radians(50))), (262, (0, 0, math.radians(22))), (END, (0, 0, math.radians(19)))], interp='SINE', easing='EASE_IN_OUT')
msb = next(n for n in mscr.data.materials[0].node_tree.nodes if n.type == 'BSDF_PRINCIPLED')
key_val(msb.inputs['Emission Strength'], [(LIT, 0.0), (LIT + 18, 1.1)])
plinth = rounded_slab('Plinth', 2.4, 1.4, 0.1, depth=0.1, bevel=0.02, mat=brushed('PlinthMetal', (0.03, 0.032, 0.036))); plinth.location = (MON.x, MON.y + 0.1, STUDIO_Z + 0.1)
phone, pscr = build_phone2('StudioPhone', [(S('n02-discover-grid.png'), 1, 'cut')], screen_glow=0.0)
PHN = C + Vector((1.05, -1.4, 0.45)); phone.location = PHN; phone.scale = (1.3, 1.3, 1.3)
keys(phone, 'rotation_euler', [(LIT - 10, (0, 0, math.radians(-50))), (262, (0, 0, math.radians(-18))), (END, (0, 0, math.radians(-15)))], interp='SINE', easing='EASE_IN_OUT')
keys(phone, 'location', [(LIT - 10, tuple(PHN + Vector((0, 0, -0.08)))), (END, tuple(PHN + Vector((0, 0, 0.06))))])
psb = next(n for n in pscr.data.materials[0].node_tree.nodes if n.type == 'BSDF_PRINCIPLED')
key_val(psb.inputs['Emission Strength'], [(LIT, 0.0), (LIT + 18, 1.05)])
# light for each product, in its own colour
def L_(name, loc, tgt, size, color, pairs, size_y=None):
    ob = look_light(name, tuple(loc), tuple(tgt), size, 0.0, color=color, size_y=size_y); key_energy(ob, pairs); return ob
L_('ScoutKey2', MON + Vector((-2.4, -3.2, 3.2)), MON, 2.6, (0.75, 0.9, 1.0), [(LIT, 0.0), (LIT + 20, 220.0)])
L_('ScoutRim2', MON + Vector((-1.4, 2.4, 1.6)), MON, 0.25, CYAN, [(LIT, 0.0), (LIT + 20, 520.0)], size_y=4.0)
L_('NextKey2', PHN + Vector((1.6, -3.0, 2.4)), PHN, 1.8, (1.0, 0.92, 0.84), [(LIT, 0.0), (LIT + 20, 120.0)])
L_('NextRim2', PHN + Vector((1.5, 1.8, 0.8)), PHN, 0.25, EMBER, [(LIT, 0.0), (LIT + 20, 520.0)], size_y=4.0)
for nm, loc, col in (('PoolS', MON, CYAN), ('PoolN', PHN, EMBER)):           # coloured pools on the floor
    sp_d = bpy.data.lights.new(nm, 'SPOT'); sp_d.spot_size = math.radians(38); sp_d.spot_blend = 0.6; sp_d.color = col
    spo = link(bpy.data.objects.new(nm, sp_d)); spo.location = (loc.x, loc.y, 5.5); spo.rotation_euler = (0, 0, 0)
    key_energy(spo, [(LIT, 0.0), (LIT + 24, 900.0)])
# the scale of the room: two tall light panels far behind, cyan on SCOUT's side, orange on NEXT's
for nm, x, col in (('WallS', -7.5, CYAN), ('WallN', 7.5, EMBER)):
    bpy.ops.mesh.primitive_cube_add(size=1, location=(x, C.y + 12.0, STUDIO_Z + 5.0)); w_ = bpy.context.active_object
    w_.scale = (0.12, 0.12, 10.0); wm, we = emissive(nm, col, 0.0); w_.data.materials.append(wm)
    key_val(we.inputs['Strength'], [(LIT, 0.0), (LIT + 30, 2.5)])
# the beams: from each product to the centre
def beam(name, a, b, color):
    cu = bpy.data.curves.new(name, 'CURVE'); cu.dimensions = '3D'; spn = cu.splines.new('POLY'); spn.points.add(1)
    spn.points[0].co = (*a, 1); spn.points[1].co = (*b, 1); cu.bevel_depth = 0.012; cu.bevel_resolution = 4
    ob = link(bpy.data.objects.new(name, cu)); m, e = emissive(name + 'M', color, 0.0); ob.data.materials.append(m)
    cu.bevel_factor_end = 0.0; cu.keyframe_insert('bevel_factor_end', frame=BEAM)
    cu.bevel_factor_end = 1.0; cu.keyframe_insert('bevel_factor_end', frame=LOGO - 2)
    set_interp(cu, 'SINE', 'EASE_IN')
    key_val(e.inputs['Strength'], [(BEAM, 0.0), (BEAM + 4, 14.0), (LOGO, 22.0), (LOGO + 12, 0.0)])
    return ob
beam('BeamS', MON + Vector((0.9, -0.2, -0.6)), C, CYAN_HOT)
beam('BeamN', PHN + Vector((-0.6, -0.1, -0.5)), C, EMBER_HOT)

# ---------------------------------------------------------------- SCOUT × NEXT (the products' own wordmarks, in 3D)
LOGO_Z = C.z + 2.55
word_m = principled('WordPaper', PAPER, rough=0.3, coat=0.6, emission=PAPER, estr=0.0)
wb = word_m.node_tree.nodes['Principled BSDF']; key_val(wb.inputs['Emission Strength'], [(LOGO, 0.0), (LOGO + 10, 0.9)])
scout_t = text_obj('SCOUT', FONT_INTER_B, 0.4, word_m, extrude=0.035, bevel=0.004, align='LEFT')
next_t = text_obj('NEXT', FONT_DISPLAY, 0.425, word_m, extrude=0.035, bevel=0.004, align='LEFT')
x_m, x_e = emissive('Times', (0.9, 0.86, 0.8), 0.0); key_val(x_e.inputs['Strength'], [(LOGO, 0.0), (LOGO + 10, 1.2)])
times = text_obj('×', FONT_INTER_M, 0.32, x_m, extrude=0.01, align='LEFT')
for t_ in (scout_t, next_t, times): t_.rotation_euler = (math.radians(90), 0, 0)
bpy.context.view_layer.update()
sq = 0.08; gap = 0.12
sw, xw, nw = scout_t.dimensions.x, times.dimensions.x, next_t.dimensions.x
dot_r = 0.036; total = sq + 0.12 + sw + gap + xw + gap + nw + 0.08 + 2 * dot_r
x = -total / 2
sq_m, sq_e = emissive('ScoutSquare', CYAN_HOT, 0.0); key_val(sq_e.inputs['Strength'], [(LOGO, 0.0), (LOGO + 4, 30.0), (LOGO + 16, 9.0)])
bpy.ops.mesh.primitive_cube_add(size=1, location=(x + sq / 2, C.y, LOGO_Z + 0.0)); sqo = bpy.context.active_object
sqo.scale = (sq, 0.04, sq); sqo.data.materials.append(sq_m)
x += sq + 0.1; scout_t.location = (x, C.y, LOGO_Z - 0.18)
x += sw + gap; times.location = (x, C.y, LOGO_Z - 0.13)
x += xw + gap; next_t.location = (x, C.y, LOGO_Z - 0.18)
x += nw + 0.08
dot_m, dot_e = emissive('NextDot', EMBER, 0.0); key_val(dot_e.inputs['Strength'], [(LOGO, 0.0), (LOGO + 4, 30.0), (LOGO + 16, 10.0)])
bpy.ops.mesh.primitive_uv_sphere_add(radius=dot_r, segments=32, ring_count=16, location=(x + dot_r, C.y, LOGO_Z - 0.165)); dot = bpy.context.active_object
dot.data.materials.append(dot_m); bpy.ops.object.shade_smooth()
for ob in (scout_t, next_t, times, sqo, dot):
    visible(ob, [(LOGO - 1, END)])
logo_grp = [scout_t, next_t, times, sqo, dot]
for ob in logo_grp:
    base = ob.location.copy()
    keys(ob, 'location', [(LOGO - 1, tuple(base + Vector((0, 0.6, 0)))), (LOGO + 14, tuple(base))], interp='EXPO', easing='EASE_OUT')
key = look_light('LogoKey', (0.4, C.y - 6.0, LOGO_Z + 2.5), (0, C.y, LOGO_Z), 3.0, 0.0); key_energy(key, [(LOGO, 0.0), (LOGO + 14, 160.0)])
sweep = look_light('LogoSweep', (-4.0, C.y - 3.0, LOGO_Z + 1.0), (0, C.y, LOGO_Z), 0.12, 0.0, size_y=6)
key_energy(sweep, [(LOGO + 18, 0.0), (LOGO + 24, 300.0), (LOGO + 70, 300.0), (LOGO + 76, 0.0)])
keys(sweep, 'location', [(LOGO + 20, (-4.0, C.y - 3.0, LOGO_Z + 1.0)), (LOGO + 74, (4.0, C.y - 3.0, LOGO_Z + 1.0))], interp='SINE', easing='EASE_IN_OUT')

# ---------------------------------------------------------------- card lighting (as in the reveal trailer, retimed)
spot_d = bpy.data.lights.new('Spot', 'SPOT'); spot_d.spot_size = math.radians(30); spot_d.spot_blend = 0.4; spot_d.shadow_soft_size = 0.12
spot = link(bpy.data.objects.new('Spot', spot_d)); spot.location = (0.2, 0.15, 3.7)
spot.rotation_euler = (Vector((0, 0, 0)) - spot.location).to_track_quat('-Z', 'Y').to_euler()
key_energy(spot, [(1, 0.0), (HIT - 1, 0.0), (HIT, 1250.0), (HIT + 14, 640.0), (BACK, 640.0), (BACK + 20, 0.0)])
rimL = look_light('RimL', (-1.9, 0.9, 0.6), (0, 0, 0), 0.15, 0.0, color=EMBER, size_y=3.0)
rimR = look_light('RimR', (1.9, 0.9, -0.2), (0, 0, 0), 0.15, 0.0, color=(1.0, 0.75, 0.55), size_y=3.0)
for l in (rimL, rimR): key_energy(l, [(1, 0.0), (HIT - 1, 12.0), (HIT, 230.0), (HIT + 14, 140.0), (BACK, 140.0), (BACK + 20, 0.0)])
for nm, loc, e_ in (('SoftL', (-1.7, -2.3, 0.7), 12.0), ('SoftR', (1.8, -1.9, -0.2), 10.0)):
    sb = look_light(nm, loc, (0, 0, 0), 0.8, 0.0, color=(1.0, 0.93, 0.86), size_y=3.2)
    key_energy(sb, [(HIT - 1, 0.0), (HIT, e_), (BACK, e_), (BACK + 15, 0.0)])
sw_l = look_light('Sweep', (-2.6, -2.0, 0.9), (0, 0, 0), 0.45, 0.0, size_y=2.6)
key_energy(sw_l, [(70, 0.0), (80, 3.4), (130, 3.4), (140, 0.0)])
keys(sw_l, 'location', [(70, (-2.6, -2.0, 0.9)), (140, (2.6, -2.0, 0.9))], interp='SINE', easing='EASE_IN_OUT')
sw_l.rotation_euler.rotate_axis('Z', math.radians(35))
for ob in bpy.data.objects:
    if ob.type == 'LIGHT': ob.visible_camera = False
coll = bpy.data.collections.new('FloorOnly'); coll.objects.link(fl)       # the rims light the products, not the glossy floor
for nm in ('RimL', 'RimR', 'SoftL', 'SoftR', 'Sweep', 'ScoutRim2', 'NextRim2', 'LogoSweep'):
    bpy.data.objects[nm].light_linking.receiver_collection = coll
for co in coll.collection_objects: co.light_linking.link_state = 'EXCLUDE'
# each product takes only its own colour: SCOUT's lights skip the phone, NEXT's lights skip the workstation
def group(name, roots):
    g = bpy.data.collections.new(name)
    for r in roots:
        for ob in [r] + list(r.children_recursive):
            if ob.type in ('MESH', 'CURVE'): g.objects.link(ob)
    return g
scout_g, next_g = group('ScoutObjs', [mon, plinth]), group('NextObjs', [phone])
for nm, g in (('ScoutKey2', next_g), ('PoolS', next_g), ('NextKey2', scout_g), ('NextRim2', scout_g), ('PoolN', scout_g)):
    bpy.data.objects[nm].light_linking.receiver_collection = g
    for co in g.collection_objects: co.light_linking.link_state = 'EXCLUDE'

# ---------------------------------------------------------------- camera
def orbit(deg, r, h): a = math.radians(deg); return (r * math.sin(a), -r * math.cos(a), h)
cam = Camera(lens=50, fstop=0.4)
cam.key(1, (0.3, -4.9, 0.12), (0.05, 0.4, 0.02), (0.25, 0.9, 0.05))
cam.key(HIT - 1, orbit(-14, 4.6, 0.1), (0.03, 0.1, 0.02), (0.05, 0.15, 0.02))
cam.key(90, orbit(22, 4.5, 0.12), (0, 0, 0.02), (0, 0, 0.02))
cam.key(140, orbit(6, 4.35, 0.07), (0, 0, 0.02), (0, 0, 0.02))
cam.key(BACK, orbit(0, 4.2, 0.05), (0, 0, 0.02), (0, 0, 0.02), 0.4, 50)
cam.key(POINT, (0.0, C.y - 12.5, 1.9), tuple(C), tuple(C), 6.0, 35)
cam.key(LOGO, (0.0, C.y - 10.8, 2.35), (0, C.y, C.z + 1.1), (0, C.y, C.z + 0.6), 8.0)
cam.key(END, (0.0, C.y - 10.1, 2.4), (0, C.y, C.z + 1.15), (0, C.y, C.z + 0.6))
cam.smooth()
for f, (dx, dz) in ((HIT + 1, (0.012, -0.009)), (HIT + 3, (-0.008, 0.006)), (LOGO + 1, (0.03, -0.02)), (LOGO + 3, (-0.02, 0.012))):
    sc.frame_set(f); cam.target.location = cam.target.location + Vector((dx, 0, dz)); cam.target.keyframe_insert('location', frame=f)
cam.bind(1)
if arg('--save'): bpy.ops.file.pack_all()             # editable .blend: images packed inside, opens anywhere
render(os.path.join(HERE, 'frames_finale'))
