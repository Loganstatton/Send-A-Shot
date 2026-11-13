"""SCOUT × NEXT — "BEFORE THE BREAKOUT": THE CONNECTION (preview of 10–18 s; local 1–240 = global 301–540).

One continuous camera move:
  1–40     the SCOUT monitor shows Juno Marrow's artist page as the scout left it: rated 86.0
           (real capture); the evaluated profile glows
  40–72    that exact profile lifts off the screen as a thick glass panel; cyan data trails start
  72–136   the camera follows it through the dark; the light shifts from SCOUT cyan to NEXT orange;
           at 112–136 the panel turns edge-on and its back is Juno's real NEXT card
  136–196  a NEXT phone (Ad #2's hero phone) comes up out of the orange dark; the card shrinks into
           the "Featured · Scouts' pick" slot of the real Discover screen and becomes part of it
  196–240  the camera settles on the phone

  blender-venv/bin/python transition.py -- --assets DIR [--hook wide] [--preview|--gpu] [--frames a-b|--list ...] [--out DIR]
"""
import json, math, os, random, sys
HERE = os.path.dirname(os.path.abspath(__file__))
for p in (HERE, os.path.join(HERE, '..', 'commercial2'), os.path.join(HERE, '..', 'commercial')):
    if p not in sys.path: sys.path.insert(0, p)
from scout3d import *
from phone2 import build_phone2
from mathutils import Vector, Matrix

random.seed(301)
END = 240
sc = init(END, samples=64)
WIDE = arg('--hook') == 'wide'
if WIDE: sc.render.resolution_x, sc.render.resolution_y = 1920, 1080
sc.cycles.transparent_max_bounces = 16
S = lambda n: os.path.join(ASSETS, n)
SLOT = json.load(open(S('slots.json')))['featured_card']
LIFT, FLY, FLIP0, FLIP1, NEAR, LAND = 40, 72, 112, 136, 172, 196
MID = (FLIP0 + FLIP1) // 2

# ---------------------------------------------------------------- the SCOUT workstation
MW = 4.0; MH = MW * 9 / 16; MZ = 1.35
mon, mscr = build_monitor('Monitor', [(S('scout-profile-screen.png'), 1, 'cut')], width=MW, glow=1.2)
mon.location = (0, 0, MZ)
for nm, img, x, y, yaw in (('MonL', 's02-queue.png', -4.6, 1.2, 24), ('MonB', 's01-roster.png', -2.2, 5.0, 8)):
    m2, _ = build_monitor(nm, [(S(img), 1, 'cut')], width=3.4, glow=0.75)
    m2.location = (x, y, MZ - 0.15); m2.rotation_euler = (0, 0, math.radians(yaw))
DESK_Z = MZ - (MH * 0.9 + 0.03) - 0.45 * 0 - 0.705 + 0.0
desk = rounded_slab('Desk', 13.0, 3.2, 0.12, depth=0.06, bevel=0.02, mat=brushed('DeskMetal', (0.035, 0.037, 0.042), scale=(6.0, 900.0, 6.0)))
desk.location = (0, -0.2, MZ - MH * 0.9 - 0.03 - 0.47)
edge_m, edge_e = emissive('DeskEdge', CYAN, 2.2)                     # a thin cyan light line along the desk front edge
bpy.ops.mesh.primitive_cube_add(size=1, location=(0, -1.81, desk.location.z + 0.02)); de = bpy.context.active_object
de.scale = (13.0, 0.012, 0.012); de.data.materials.append(edge_m)

# the floor: dark, with a fine lattice whose light is SCOUT cyan here and NEXT orange over there
FLOOR_Z = desk.location.z - 0.9
bpy.ops.mesh.primitive_plane_add(size=80, location=(0, 10, FLOOR_Z)); fl = bpy.context.active_object
fm = principled('Floor', (0.006, 0.006, 0.007), rough=0.14, coat=0.5); nt = fm.node_tree; fb = nt.nodes['Principled BSDF']
tc = nt.nodes.new('ShaderNodeTexCoord'); sep = nt.nodes.new('ShaderNodeSeparateXYZ'); nt.links.new(tc.outputs['Object'], sep.inputs[0])
def node_math(op, a, b=None):
    x = nt.nodes.new('ShaderNodeMath'); x.operation = op
    for i, v in enumerate((a, b)):
        if v is None: continue
        if isinstance(v, (int, float)): x.inputs[i].default_value = v
        else: nt.links.new(v, x.inputs[i])
    return x.outputs[0]
def line(coord, period=1.2, width=0.012):
    f = node_math('FRACT', node_math('DIVIDE', coord, period))
    d = node_math('MINIMUM', f, node_math('SUBTRACT', 1.0, f))
    return node_math('LESS_THAN', d, width / period)
grid = node_math('MAXIMUM', line(sep.outputs['X']), line(sep.outputs['Y']))
fade = node_math('POWER', node_math('MAXIMUM', node_math('SUBTRACT', 1.0, node_math('DIVIDE', node_math('ABSOLUTE', node_math('SUBTRACT', sep.outputs['Y'], 2.0)), 16.0)), 0.0), 2.0)
mixc = nt.nodes.new('ShaderNodeMix'); mixc.data_type = 'RGBA'
mixc.inputs['A'].default_value = (*CYAN, 1); mixc.inputs['B'].default_value = (*EMBER_HOT, 1)
nt.links.new(node_math('MINIMUM', node_math('MAXIMUM', node_math('DIVIDE', node_math('SUBTRACT', sep.outputs['X'], 1.2), 3.4), 0.0), 1.0), mixc.inputs['Factor'])
nt.links.new(mixc.outputs['Result'], fb.inputs['Emission Color'])
nt.links.new(node_math('MULTIPLY', node_math('MULTIPLY', grid, fade), 0.55), fb.inputs['Emission Strength'])
fl.data.materials.append(fm)

# ---------------------------------------------------------------- the glass panel: SCOUT profile on the front, NEXT card on the back
flight = link(bpy.data.objects.new('Flight', None))
PANEL_W = MW * 2352 / 3200 * 2480 / 2352                               # the profile's width on screen, incl. its margins
pan_v = 0.368                                                          # its centre on the screen (UV, from prep_dual.py)
START = Vector((0, -0.066 - 0.035, MZ + (0.5 - pan_v) * MH))
scout, sface, sh, s_fade, s_glow = glass_panel('ScoutPanel', S('scout-panel.png'), PANEL_W, depth=0.06, glow=1.2, facing='front')
scout.parent = flight
NW = 1.3
nextp, nface, nh, n_fade, n_glow = glass_panel('NextPanel', S('next-card.png'), NW, depth=0.05, glow=1.15, facing='back')
nextp.parent = flight

# the phone, waiting in the orange dark
PH_YAW = math.radians(-12)
phone, pscr = build_phone2('Phone', [(S('n02-discover-grid.png'), 1, 'cut')], screen_glow=1.05)
PH = Vector((5.6, 4.6, 1.15))
keys(phone, 'location', [(NEAR - 40, PH + Vector((0.35, 1.2, -0.9))), (NEAR + 4, PH), (END, PH + Vector((0, 0, 0.03)))], interp='SINE', easing='EASE_OUT')
keys(phone, 'rotation_euler', [(NEAR - 40, (math.radians(-8), 0, PH_YAW + math.radians(28))), (NEAR + 8, (0, 0, PH_YAW)), (END, (0, 0, PH_YAW - math.radians(4)))])
sc.frame_set(LAND); bpy.context.view_layer.update()
slot_local = Vector(((SLOT['u'] - 0.5) * SCREEN_W, (0.5 - SLOT['v']) * SCREEN_H, 0.012))
LANDING = pscr.matrix_world @ slot_local
land_scale = SLOT['w'] * SCREEN_W / NW
land_rot = (0.0, 0.0, math.pi + phone.matrix_world.to_euler().z)

# flight path
P1 = Vector((0.45, -2.5, 2.3)); P2 = Vector((1.7, -0.7, 2.15)); P3 = Vector((2.9, 0.7, 1.95)); P4 = Vector((4.6, 2.6, 1.55))
keys(flight, 'location', [(1, tuple(START)), (LIFT, tuple(START)), (FLY, tuple(P1)), (FLIP0, tuple(P2)), (FLIP1, tuple(P3)), (NEAR, tuple(P4)), (LAND, tuple(LANDING)), (END, tuple(LANDING))])
keys(flight, 'scale', [(LIFT, (1, 1, 1)), (FLY, (0.52, 0.52, 0.52)), (FLIP0, (0.46, 0.46, 0.46)), (NEAR, (0.5, 0.5, 0.5)), (LAND, (land_scale,) * 3)])
keys(flight, 'rotation_euler', [(LIFT, (0, 0, 0)), (FLY, (math.radians(4), 0, math.radians(-10))), (FLIP0, (math.radians(2), 0, math.radians(-14))),
                                (FLIP1, (0, 0, math.pi - math.radians(18))), (NEAR, (0, 0, math.pi - math.radians(16))), (LAND, land_rot)])
# the morph: while edge-on, the wide SCOUT panel takes the NEXT card's proportions, then they swap
keys(scout, 'scale', [(FLIP0, (1, 1, 1)), (MID, (NW / PANEL_W, 1, nh / sh))], interp='SINE', easing='EASE_IN')
visible(scout, [(LIFT, MID)]); visible(nextp, [(MID + 1, LAND + 1)])
for ob in list(scout.children_recursive): visible(ob, [(LIFT, MID)])
for ob in list(nextp.children_recursive): visible(ob, [(MID + 1, LAND + 1)])
key_val(s_glow, [(LIFT, 1.2), (LIFT + 6, 2.2), (FLY, 1.25)])
key_val(n_fade, [(LAND - 6, 1.0), (LAND + 1, 0.0)])                   # it becomes the card on the screen
# the evaluated profile glows on the monitor before it lifts (the "approved" beat)
gm, ge = emissive('ApproveGlow', CYAN_HOT, 0.0)
oc = bpy.data.curves.new('ApproveRim', 'CURVE'); oc.dimensions = '3D'; osp = oc.splines.new('POLY')
rp = rounded_rect_points(PANEL_W - 0.05, sh - 0.05, 0.04, 8); osp.points.add(len(rp) - 1)
for i, (x, y) in enumerate(rp): osp.points[i].co = (x, y, 0, 1)
osp.use_cyclic_u = True; oc.bevel_depth = 0.006
gr = link(bpy.data.objects.new('ApproveRim', oc)); gr.data.materials.append(gm)
gr.location = START + Vector((0, 0.02, 0)); gr.rotation_euler = (math.radians(90), 0, 0)
key_val(ge.inputs['Strength'], [(6, 0.0), (20, 9.0), (LIFT, 5.0), (LIFT + 10, 0.0)])
msb = next(n for n in mscr.data.materials[0].node_tree.nodes if n.type == 'BSDF_PRINCIPLED')
key_val(msb.inputs['Emission Strength'], [(LIFT, 1.2), (FLY, 0.5)])     # the screen dims as the profile leaves it

# data trails along the flight, cyan → orange; plus a light that rides with the panel
path = [START + Vector((0, -0.05, 0)), P1, P2, P3, P4, LANDING + Vector((0, -0.05, 0))]
for i, (cnt, spr, spd) in enumerate(((700, 0.10, 0.16), (380, 0.28, 0.11))):
    tr, te = flow_trail(f'Trail{i}', path, count=cnt, spread=spr, speed=spd, radius=0.0032 if i == 0 else 0.0022)
    key_color(te.inputs['Color'], [(FLY, CYAN_HOT), (FLIP0 - 10, CYAN_HOT), (FLIP1 + 10, EMBER_HOT)])
    key_val(te.inputs['Strength'], [(LIFT, 0.0), (LIFT + 18, 6.0 if i == 0 else 3.5), (NEAR, 5.0), (LAND + 6, 0.0)])
rl = bpy.data.lights.new('RideLight', 'POINT'); rl.shadow_soft_size = 0.4
ride = link(bpy.data.objects.new('RideLight', rl)); ride.parent = flight; ride.location = (0, -0.9, 0.3); ride.visible_glossy = False
key_light_color(ride, [(FLY, CYAN), (FLIP0 - 10, CYAN), (FLIP1 + 10, (1.0, 0.45, 0.2))])
key_energy(ride, [(LIFT, 0.0), (FLY, 22.0), (NEAR, 18.0), (LAND, 4.0)])

# ---------------------------------------------------------------- light
def area_l(name, loc, tgt, size, energy, color, size_y=None):
    return look_light(name, loc, tgt, size, energy, color=color, size_y=size_y)
skey = area_l('ScoutKey', (-3.2, -3.4, 4.6), (0, 0, MZ), 3.0, 260, (0.78, 0.9, 1.0))
srim = area_l('ScoutRim', (2.6, 2.2, 3.4), (0, 0, MZ), 1.2, 340, CYAN, size_y=4.0)
sfill = area_l('ScoutFill', (3.8, -3.0, 1.0), (0, 0, MZ), 2.0, 40, (0.6, 0.8, 1.0))
for l in (skey, srim, sfill): key_energy(l, [(1, l.data.energy), (FLIP0, l.data.energy), (NEAR, l.data.energy * 0.35)])
nrimL = area_l('NextRimL', PH + Vector((-1.6, 1.4, 0.6)), PH, 0.2, 0.0, EMBER, size_y=3.0)
nrimR = area_l('NextRimR', PH + Vector((1.6, 1.2, -0.2)), PH, 0.2, 0.0, (1.0, 0.62, 0.36), size_y=3.0)
nkey = area_l('NextKey', PH + Vector((-1.4, -3.0, 2.4)), PH, 2.0, 0.0, (1.0, 0.93, 0.86))
for l, e in ((nrimL, 240), (nrimR, 200), (nkey, 70)): key_energy(l, [(FLIP0, 0.0), (NEAR, e)])
# an orange haze far behind the phone; a cool one behind the monitor
HAZE = {}
for nm, loc, col, e in (('HazeS', (0, 9, 1.5), CYAN, 0.05), ('HazeN', (7, 16, 1.5), EMBER, 0.05)):
    bpy.ops.mesh.primitive_plane_add(size=40, location=loc, rotation=(math.radians(90), 0, 0)); hz = bpy.context.active_object
    hm = bpy.data.materials.new(nm); hm.use_nodes = True; hn = hm.node_tree; hn.nodes.clear()
    htc = hn.nodes.new('ShaderNodeTexCoord'); hgr = hn.nodes.new('ShaderNodeTexGradient'); hgr.gradient_type = 'SPHERICAL'
    hmp = hn.nodes.new('ShaderNodeMapping'); hmp.inputs['Scale'].default_value = (0.06, 0.06, 0.06)
    hpw = hn.nodes.new('ShaderNodeMath'); hpw.operation = 'POWER'; hpw.inputs[1].default_value = 3.0
    hmu = hn.nodes.new('ShaderNodeMath'); hmu.operation = 'MULTIPLY'; hmu.inputs[1].default_value = e
    hem = hn.nodes.new('ShaderNodeEmission'); hem.inputs['Color'].default_value = (*col, 1); ho = hn.nodes.new('ShaderNodeOutputMaterial')
    hn.links.new(htc.outputs['Object'], hmp.inputs['Vector']); hn.links.new(hmp.outputs['Vector'], hgr.inputs['Vector'])
    hn.links.new(hgr.outputs['Fac'], hpw.inputs[0]); hn.links.new(hpw.outputs[0], hmu.inputs[0]); hn.links.new(hmu.outputs[0], hem.inputs['Strength'])
    hn.links.new(hem.outputs[0], ho.inputs['Surface']); hz.data.materials.append(hm); HAZE[nm] = hmu.inputs[1]
key_val(HAZE['HazeS'], [(FLIP0, 0.05), (NEAR, 0.015)]); key_val(HAZE['HazeN'], [(FLIP0, 0.05), (NEAR, 0.24)])     # the world turns from cyan to orange
for ob in bpy.data.objects:
    if ob.type == 'LIGHT': ob.visible_camera = False

# ---------------------------------------------------------------- camera: one move
cam = Camera(lens=35, fstop=2.8)
def toward(a, b, d): return tuple(Vector(a) + (Vector(b) - Vector(a)).normalized() * d)
cam.key(1, (2.2, -11.0, 2.3), (0, 0, MZ + 0.05), (0, -0.07, MZ))
cam.key(LIFT, (1.0, -8.6, 2.1), tuple(START), tuple(START))
cam.key(FLY, (-0.2, -5.4, 2.15), tuple(P1), tuple(P1))
cam.key(FLIP0, (0.5, -4.4, 2.4), tuple(P2), tuple(P2))
cam.key(FLIP1, (1.6, -3.1, 2.15), tuple(P3), tuple(P3))
cam.key(NEAR, (3.2, -1.3, 1.75), tuple(P4), tuple(P4), 3.0)
cam_land = LANDING + Vector((-math.sin(PH_YAW) * -1, 0, 0))
cam.key(LAND, tuple(LANDING + (Vector((0, -2.9, 0.12)) @ Matrix.Rotation(-PH_YAW, 3, 'Z'))), tuple(LANDING), tuple(LANDING), 2.4)
sc.frame_set(END); bpy.context.view_layer.update()
scr_c = pscr.matrix_world.translation.copy()
cam.key(END, tuple(scr_c + (Vector((0.15, -3.0, 0.15)) @ Matrix.Rotation(-PH_YAW, 3, 'Z'))), tuple(scr_c), tuple(scr_c), 3.0)
cam.smooth(); cam.bind(1)
render(os.path.join(HERE, 'frames_transition'))
