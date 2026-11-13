"""NEXT Ad #2 — opening, 0–4 s (frames 1–120 at 30 fps, 120 BPM: beat = 15 frames).

  1–60    SCENE 1 "I FOUND THEM FIRST."  A dark creative studio at night, orange
          practicals; the phone on the desk already shows NEXT. The camera
          pushes in (gentle handheld drift) while the line is spoken.
          (This is the stand-in for a real live-action clip: same framing, same
          timing, so a filmed shot can replace it 1:1.)
  56–66   THE TURN: the camera rushes the phone; the studio goes dark around it
          and the phone lifts into a black void — one continuous move.
  61      "PROVE IT." — bass impact on beat 5 (2.0 s)
  61–120  SCENE 2  The phone floats in darkness; an orange ring of light travels
          around it (and lights its metal as it passes); a soft reflection
          sweeps the glass; the camera arcs to reveal the edge and thickness,
          then settles toward the front for Scene 3.

  blender-venv/bin/python opening.py -- --assets DIR [--preview|--gpu] [--frames a-b|--list ...] [--out DIR]
"""
import math, os, random, sys
HERE = os.path.dirname(os.path.abspath(__file__))
for p in (HERE, os.path.join(HERE, '..', 'commercial')):
    if p not in sys.path: sys.path.insert(0, p)
from phone2 import *
from mathutils import Vector

random.seed(202)
sc = init(120)
S = lambda name: os.path.join(ASSETS, name)
CUT = 61                     # the studio is gone, the void begins (2.0 s)

def keyed(socket, pairs, path='default_value'):
    for f, v in pairs:
        socket.default_value = v; socket.keyframe_insert(path, frame=f)
def keyed_energy(ob, pairs):
    for f, v in pairs:
        ob.data.energy = v; ob.data.keyframe_insert('energy', frame=f)

# ---------------------------------------------------------------- the phone (real NEXT Discover screen)
phone, scr = build_phone2('Phone', [(S('01-discover.png'), 1, 'cut')], screen_glow=1.05)
float_ = link(bpy.data.objects.new('Float', None)); phone.parent = float_
# On the desk stand: leaning back 12°. Lifts off into the void through the turn, then floats.
keys(float_, 'location', [(1, (0, 0, 0)), (54, (0, 0, 0)), (68, (0, 0, 0.08)), (95, (0, 0, 0.11)), (120, (0, 0, 0.09))])
keys(float_, 'rotation_euler', [(1, (math.radians(-12), 0, math.radians(-4))), (54, (math.radians(-12), 0, math.radians(-4))),
                                (70, (math.radians(-2), 0, math.radians(-2))), (120, (math.radians(1), 0, math.radians(2)))])

# ---------------------------------------------------------------- SCENE 1: the studio (all of it fades out through the turn)
studio = []
def S1(ob): studio.append(ob); return ob
def studio_mat(name, base, rough=0.5, metallic=0.0, coat=0.0):
    return principled(name, base, metallic=metallic, rough=rough, coat=coat)
# desk: dark walnut
desk_m = studio_mat('Walnut', (0.045, 0.026, 0.016), rough=0.32, coat=0.4)
nt = desk_m.node_tree; db = nt.nodes['Principled BSDF']
wv = nt.nodes.new('ShaderNodeTexWave'); wv.wave_type = 'BANDS'; wv.inputs['Scale'].default_value = 0.6; wv.inputs['Distortion'].default_value = 6.0
wv.inputs['Detail'].default_value = 4.0
rmp = nt.nodes.new('ShaderNodeValToRGB'); rmp.color_ramp.elements[0].color = (0.03, 0.017, 0.010, 1); rmp.color_ramp.elements[1].color = (0.07, 0.042, 0.026, 1)
nt.links.new(wv.outputs['Fac'], rmp.inputs['Fac']); nt.links.new(rmp.outputs['Color'], db.inputs['Base Color'])
bpy.ops.mesh.primitive_plane_add(size=1, location=(0, 4, -0.92)); desk = S1(bpy.context.active_object); desk.scale = (26, 14, 1); desk.data.materials.append(desk_m)
# wall with acoustic panels
wall_m = studio_mat('Wall', (0.018, 0.016, 0.016), rough=0.85)
wn = wall_m.node_tree; wb = wn.nodes['Principled BSDF']
br = wn.nodes.new('ShaderNodeTexBrick'); br.inputs['Scale'].default_value = 0.35; br.inputs['Mortar Size'].default_value = 0.02
bump = wn.nodes.new('ShaderNodeBump'); bump.inputs['Strength'].default_value = 0.4
wn.links.new(br.outputs['Fac'], bump.inputs['Height']); wn.links.new(bump.outputs['Normal'], wb.inputs['Normal'])
bpy.ops.mesh.primitive_plane_add(size=1, location=(0, 11, 4), rotation=(math.radians(90), 0, 0)); wall = S1(bpy.context.active_object)
wall.scale = (40, 14, 1); wall.data.materials.append(wall_m)
# phone stand (brushed metal)
stand_m = brushed_metal('StandMetal', (0.16, 0.16, 0.17))
base = S1(rounded_slab('StandBase', 0.95, 0.55, 0.08, depth=0.02, bevel=0.01, mat=stand_m)); base.location = (0, 0.12, -0.9)
lip = S1(rounded_slab('StandLip', 0.8, 0.09, 0.02, depth=0.03, bevel=0.008, mat=stand_m)); lip.location = (0, -0.05, -0.86); lip.rotation_euler.x = math.radians(90)
back_s = S1(rounded_slab('StandBack', 0.5, 1.1, 0.05, depth=0.015, bevel=0.008, mat=stand_m)); back_s.location = (0, 0.26, -0.35)
back_s.rotation_euler.x = math.radians(90 - 12)
# props, out of focus behind: studio monitors, records on the shelf, a keyboard edge
mon_m = studio_mat('Monitor', (0.012, 0.012, 0.013), rough=0.45)
cone_m = studio_mat('Cone', (0.02, 0.02, 0.02), rough=0.7)
for x in (-4.2, 4.6):
    bpy.ops.mesh.primitive_cube_add(size=1, location=(x, 6.5, 0.45)); m_ = S1(bpy.context.active_object); m_.scale = (1.5, 1.3, 2.7); m_.data.materials.append(mon_m)
    bpy.ops.object.modifier_add(type='BEVEL'); m_.modifiers[-1].width = 0.08; m_.modifiers[-1].segments = 3
    for zz, r in ((0.9, 0.45), (-0.05, 0.22)):
        bpy.ops.mesh.primitive_cylinder_add(radius=r, depth=0.05, location=(x, 5.84, zz), rotation=(math.radians(90), 0, 0))
        c_ = S1(bpy.context.active_object); c_.data.materials.append(cone_m)
shelf_m = studio_mat('Shelf', (0.03, 0.02, 0.014), rough=0.5)
bpy.ops.mesh.primitive_cube_add(size=1, location=(2.6, 10.4, 1.05)); sh_ = S1(bpy.context.active_object); sh_.scale = (9.0, 1.2, 0.12); sh_.data.materials.append(shelf_m)
spine_cols = [(0.06, 0.02, 0.012), (0.012, 0.012, 0.014), (0.6, 0.14, 0.05), (0.05, 0.045, 0.04), (0.2, 0.17, 0.12), (0.02, 0.03, 0.05), (0.35, 0.06, 0.03)]
x = -1.6
while x < 6.8:
    w = random.uniform(0.05, 0.11); h = random.uniform(1.15, 1.4)
    bpy.ops.mesh.primitive_cube_add(size=1, location=(x, 10.4, 1.11 + h / 2)); sp_r = S1(bpy.context.active_object)
    sp_r.scale = (w, 1.05, h); sp_r.rotation_euler.y = math.radians(random.uniform(-3, 3))
    sp_r.data.materials.append(studio_mat(f'Spine{int(x * 100)}', random.choice(spine_cols), rough=0.55)); x += w + random.uniform(0.0, 0.03)
for i, (xx, col) in enumerate(((-3.0, (0.55, 0.12, 0.04)), (7.6, (0.03, 0.03, 0.035)))):
    bpy.ops.mesh.primitive_cube_add(size=1, location=(xx, 10.6, 1.9)); fo = S1(bpy.context.active_object)
    fo.scale = (1.3, 0.05, 1.3); fo.rotation_euler.x = math.radians(-6); fo.data.materials.append(studio_mat(f'FaceOut{i}', col, rough=0.5))
string_m, string_e = emissive('String', (1.0, 0.58, 0.28), 14.0)
for i in range(11):
    t = i / 10
    bpy.ops.mesh.primitive_uv_sphere_add(radius=0.06, location=(-6 + 14 * t, 10.7, 4.4 - 0.5 * math.sin(math.pi * t)))
    S1(bpy.context.active_object).data.materials.append(string_m)
bpy.ops.mesh.primitive_cube_add(size=1, location=(-1.5, 3.2, -0.78)); kb = S1(bpy.context.active_object); kb.scale = (5.5, 1.6, 0.22)
kb.data.materials.append(studio_mat('Keys', (0.02, 0.02, 0.022), rough=0.4))
# practical lights (they read as bokeh): orange neon on the wall, a warm lamp, a few tiny LEDs
neon_m, neon_e = emissive('Neon', EMBER, 9.0)
nc = bpy.data.curves.new('NeonC', 'CURVE'); nc.dimensions = '3D'; sp_ = nc.splines.new('POLY'); sp_.points.add(2)
for i, co in enumerate(((-7.0, 10.8, 6.0), (-7.0, 10.8, 1.2), (-3.2, 10.8, 1.2))): sp_.points[i].co = (*co, 1)
nc.bevel_depth = 0.05; neon = S1(link(bpy.data.objects.new('Neon', nc))); neon.data.materials.append(neon_m)
lamp_m, lamp_e = emissive('Lamp', (1.0, 0.62, 0.32), 22.0)
bpy.ops.mesh.primitive_uv_sphere_add(radius=0.38, location=(6.2, 9.0, 2.6)); lamp = S1(bpy.context.active_object); lamp.data.materials.append(lamp_m)
led_m, led_e = emissive('Led', (1.0, 0.35, 0.12), 30.0)
for x, z in ((-4.2, 1.95), (4.6, 1.95), (2.6, -0.62), (-0.4, -0.62)):
    bpy.ops.mesh.primitive_uv_sphere_add(radius=0.035, location=(x, 5.8 if abs(x) > 4 else 3.0, z)); S1(bpy.context.active_object).data.materials.append(led_m)
key = look_light('Key', (-2.4, -4.0, 2.6), (0, 0, 0), 2.6, 260, color=(1.0, 0.9, 0.82))
rim = look_light('RimOrange', (3.2, 3.5, 1.6), (0, 0, 0), 1.5, 650, color=EMBER)
room = look_light('RoomWarm', (5.5, 7.0, 3.5), (0, 6, 0), 4.0, 900, color=(1.0, 0.6, 0.35))
# the studio goes dark through the turn: lights and practicals off, props hidden at the cut
OFF0, OFF1 = 55, CUT
keyed_energy(key, [(1, 260), (OFF0, 260), (OFF1, 30)])
keyed_energy(rim, [(1, 650), (OFF0, 650), (OFF1, 120)])
keyed_energy(room, [(1, 900), (OFF0, 900), (OFF1 - 2, 0)])
keyed(neon_e.inputs['Strength'], [(1, 9.0), (OFF0, 9.0), (OFF1 - 2, 0.0)])
keyed(lamp_e.inputs['Strength'], [(1, 22.0), (OFF0, 22.0), (OFF1 - 2, 0.0)])
keyed(led_e.inputs['Strength'], [(1, 30.0), (OFF0, 30.0), (OFF1 - 3, 0.0)])
keyed(string_e.inputs['Strength'], [(1, 14.0), (OFF0, 14.0), (OFF1 - 3, 0.0)])
for ob in studio: visible(ob, [(1, CUT - 1)])

# ---------------------------------------------------------------- SCENE 2: the void, the ring of light, the glass reflection
RING_R = 0.78                                # wider than the phone, close enough to light it
ring_root = link(bpy.data.objects.new('RingRoot', None)); ring_root.parent = float_
keys(ring_root, 'location', [(CUT, (0, 0, -0.98)), (104, (0, 0, 0.98))], interp='SINE', easing='EASE_IN_OUT')
rc = bpy.data.curves.new('RingC', 'CURVE'); rc.dimensions = '3D'; rsp = rc.splines.new('POLY'); N_ = 160; rsp.points.add(N_)
for i in range(N_ + 1):
    a = 2 * math.pi * i / N_; rsp.points[i].co = (RING_R * math.cos(a), RING_R * 0.62 * math.sin(a), 0, 1)
rc.bevel_depth = 0.0035; rc.bevel_resolution = 3
ring_m, ring_e = glow_material('RingFaint', EMBER, 0.0)
ring = link(bpy.data.objects.new('Ring', rc)); ring.data.materials.append(ring_m); ring.parent = ring_root
ring.rotation_euler = (math.radians(-10), 0, 0)                            # tipped toward the lens: front arc low, back arc high
keyed(ring_e.inputs['Strength'], [(CUT - 1, 0.0), (CUT, 7.0), (CUT + 10, 2.2), (100, 2.2), (112, 0.0)])
visible(ring, [(CUT, 112)])
cc = rc.copy(); cc.bevel_depth = 0.008
cc.bevel_factor_mapping_start = cc.bevel_factor_mapping_end = 'SPLINE'
comet_m, comet_e = glow_material('Comet', EMBER_HOT, 0.0)
comet = link(bpy.data.objects.new('Comet', cc)); comet.data.materials.append(comet_m); comet.parent = ring
L0, L1, SEG, LAPS = CUT, 112, 0.22, 1.7
# one comet, ~1.7 laps: start/end keyed per frame (wraps by restarting near 0)
hl = bpy.data.lights.new('CometLight', 'POINT'); hl.color = EMBER_HOT; hl.shadow_soft_size = 0.08
head = link(bpy.data.objects.new('CometLight', hl)); head.parent = ring
for f in range(L0, L1 + 1):
    t = (f - L0) / (L1 - L0); pos = (LAPS * t) % 1.0
    s0 = min(pos, 1.0 - SEG)
    cc.bevel_factor_start = s0; cc.keyframe_insert('bevel_factor_start', frame=f)
    cc.bevel_factor_end = s0 + SEG; cc.keyframe_insert('bevel_factor_end', frame=f)
    a = 2 * math.pi * (s0 + SEG)
    head.location = (RING_R * math.cos(a), RING_R * 0.62 * math.sin(a), 0.02); head.keyframe_insert('location', frame=f)
set_interp(cc, 'CONSTANT'); set_interp(head, 'LINEAR')
keyed(comet_e.inputs['Strength'], [(CUT - 1, 0.0), (CUT, 40.0), (CUT + 6, 20.0), (100, 20.0), (112, 0.0)])
visible(comet, [(CUT, 112)])
keyed_energy(head, [(CUT - 1, 0.0), (CUT, 30.0), (CUT + 8, 14.0), (100, 14.0), (112, 0.0)])
# void lighting: cool-neutral key from above-left, orange rim behind, a soft strip whose reflection sweeps the glass
vkey = look_light('VoidKey', (-2.2, -3.0, 3.2), (0, 0, 0), 2.0, 0.0, color=(0.92, 0.94, 1.0))
keyed_energy(vkey, [(CUT - 1, 0.0), (CUT, 150.0), (120, 150.0)])
vrim = look_light('VoidRim', (0.6, 3.0, 1.4), (0, 0, 0), 2.5, 0.0, color=EMBER)
keyed_energy(vrim, [(CUT - 1, 0.0), (CUT, 900.0), (CUT + 8, 420.0), (120, 420.0)])
sweep = look_light('GlassSweep', (-2.8, -2.4, 1.2), (0, 0, 0), 0.9, 0.0, size_y=4.0)
sweep.visible_camera = False
keys(sweep, 'location', [(CUT + 6, (-2.8, -2.4, 1.2)), (114, (2.8, -2.4, 0.2))], interp='SINE', easing='EASE_IN_OUT')
sweep.rotation_euler.rotate_axis('Z', math.radians(25))
keyed_energy(sweep, [(CUT + 4, 0.0), (CUT + 10, 4.5), (108, 4.5), (116, 0.0)])
# faint ember backdrop + floating dust for depth
bpy.ops.mesh.primitive_plane_add(size=40, location=(0, 12, 0.5), rotation=(math.radians(90), 0, 0)); bd = bpy.context.active_object
bm_ = bpy.data.materials.new('Backdrop'); bm_.use_nodes = True; bn = bm_.node_tree; bn.nodes.clear()
btc = bn.nodes.new('ShaderNodeTexCoord'); bgr = bn.nodes.new('ShaderNodeTexGradient'); bgr.gradient_type = 'SPHERICAL'
bmp = bn.nodes.new('ShaderNodeMapping'); bmp.inputs['Scale'].default_value = (0.12, 0.12, 0.12)
bpw = bn.nodes.new('ShaderNodeMath'); bpw.operation = 'POWER'; bpw.inputs[1].default_value = 3.0
bmu = bn.nodes.new('ShaderNodeMath'); bmu.operation = 'MULTIPLY'
keyed(bmu.inputs[1], [(CUT - 1, 0.0), (CUT, 0.10), (120, 0.06)])
bem = bn.nodes.new('ShaderNodeEmission'); bem.inputs['Color'].default_value = (*EMBER, 1); bo = bn.nodes.new('ShaderNodeOutputMaterial')
bn.links.new(btc.outputs['Object'], bmp.inputs['Vector']); bn.links.new(bmp.outputs['Vector'], bgr.inputs['Vector'])
bn.links.new(bgr.outputs['Fac'], bpw.inputs[0]); bn.links.new(bpw.outputs[0], bmu.inputs[0]); bn.links.new(bmu.outputs[0], bem.inputs['Strength'])
bn.links.new(bem.outputs[0], bo.inputs['Surface']); bd.data.materials.append(bm_)
visible(bd, [(CUT, 120)])
dust = [Vector((random.uniform(-2.5, 2.5), random.uniform(-2.0, 3.5), random.uniform(-1.8, 1.8))) for _ in range(380)]
particles('Dust', dust, [d_ + Vector((random.uniform(-0.1, 0.1), 0, random.uniform(0.1, 0.25))) for d_ in dust],
          [Vector((0, 0, 0))] * len(dust), [CUT + 60] * len(dust), CUT, settle=5, base=0.0018, fly=0.0, noise_amp=0.12,
          appear=CUT, glow=0.22)

# ---------------------------------------------------------------- camera: one continuous move
# The phone is modelled ~11x real size, so f-numbers are scaled down ~11x to give real-lens depth of field.
cam = Camera(lens=50, fstop=0.2)
cam.key(1, (0.42, -10.2, 1.25), (0.02, 0, 0.2), (0, 0, 0))
cam.key(48, (0.2, -7.4, 0.8), (0.0, 0, 0.18), (0, 0, 0))
cam.key(CUT - 1, (0.06, -4.9, 0.32), (0.0, 0, 0.2), (0, 0, 0.04), 0.22)        # the rush
cam.key(CUT + 6, (0.0, -4.6, 0.3), (0.0, 0, 0.24), (0, 0, 0.08), 0.45)
cam.key(98, (2.3, -4.0, 0.55), (0.0, 0, 0.24), (0, 0, 0.1))                    # arc: the edge and thickness show
cam.key(120, (0.7, -4.5, 0.36), (0.0, 0, 0.24), (0, 0, 0.1))                   # settling toward the front
cam.smooth()
# a little handheld life in the studio shot (decays to nothing by the turn)
jit = []
for f in range(3, 54, 5):
    sc.frame_set(f); a = 0.014 * (1 - f / 54)
    jit.append((f, cam.cam.location.copy() + Vector((random.uniform(-a, a), 0, random.uniform(-a, a)))))
for f, loc in jit:
    cam.cam.location = loc; cam.cam.keyframe_insert('location', frame=f)
cam.bind(1)
render(os.path.join(HERE, 'frames_opening'))
