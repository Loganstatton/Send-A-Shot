"""NEXT reveal trailer — Scenes 5–6, 25–40 s (global frames 751–1200; local 1–450 here).
Adapted from Ad #2's hero.py (which is unchanged), slower and retimed to the trailer score.

  local    global   time
  1–75     751–825  25.0 s  the music falls away; darkness; a small orange light; the Founding
                            Believer card (Ad #1 v2.1 design, demo data) turns out of edge-on
  76       826      27.5 s  the hit (metal accent): spotlight, rims, a few sparks off the edges
  76–210   826–960          the camera circles the card (left → right → front), a glint runs
                            across the foil on the 29.0 s accent; the card settles front-on
  211–228  961–978  32.0 s  it backs away and dissolves into fine orange particles
  228–271  978–1021         the particles sweep into a huge NEXT logo; the dot lands at 34.0 s
  271–450  1021–1200        the logo holds on black with soft reflections; slow pull-back

  blender-venv/bin/python finale3.py -- --assets DIR [--preview|--gpu] [--frames a-b|--list ...] [--out DIR]
"""
import math, os, random, sys
HERE = os.path.dirname(os.path.abspath(__file__))
for p in (HERE, os.path.join(HERE, '..', 'commercial2'), os.path.join(HERE, '..', 'commercial')):
    if p not in sys.path: sys.path.insert(0, p)
from card2 import *
from mathutils import Vector

random.seed(751)
END = 450
sc = init(END, samples=64)
WIDE = arg('--hook') == 'wide'                  # 16:9 version: same shots, 1920x1080 (vertical field of view kept)
if WIDE: sc.render.resolution_x, sc.render.resolution_y = 1920, 1080
S = lambda name: os.path.join(ASSETS, name)
HIT, BACK, OUT = 76, 211, 228
def keyed(socket, pairs):
    for f, v in pairs:
        socket.default_value = v; socket.keyframe_insert('default_value', frame=f)
def keyed_energy(ob, pairs):
    for f, v in pairs:
        ob.data.energy = v; ob.data.keyframe_insert('energy', frame=f)

# ---------------------------------------------------------------- the card (Ad #1 v2.1 design)
root, tilt, face, CW, CH = build_card(S('card-hero.png'), [(1, 0.0), (20, 0.0), (HIT - 1, 0.35), (HIT, 1.3), (HIT + 12, 1.0)], END)
keys(root, 'location', [(1, (0.25, 0.9, 0.05)), (HIT - 1, (0.05, 0.15, 0.02)), (120, (0, 0, 0.02)), (BACK, (0, 0, 0.0)), (OUT, (0, 0.9, 0.12))])
keys(root, 'rotation_euler', [(1, (math.radians(4), 0, math.radians(80))), (HIT - 1, (math.radians(3), 0, math.radians(22))),
                              (120, (math.radians(1.5), 0, math.radians(4))), (BACK, (math.radians(1), 0, math.radians(-1))),
                              (OUT, (math.radians(-4), 0, math.radians(-16)))])
keys(root, 'scale', [(OUT - 2, (1, 1, 1)), (OUT + 7, (0, 0, 0))])
for fc in iter_fcurves(root.animation_data.action):
    for kp in fc.keyframe_points:
        if round(kp.co.x) == 1: kp.interpolation = 'SINE'; kp.easing = 'EASE_OUT'
        if round(kp.co.x) == OUT - 2: kp.interpolation = 'EXPO'; kp.easing = 'EASE_IN'

# the small orange light that appears in the dark, behind the card
glow_m, glow_e = emissive('Ember', EMBER_HOT, 0.0)
bpy.ops.mesh.primitive_uv_sphere_add(radius=0.028, segments=24, ring_count=12, location=(-0.12, -0.25, 0.18)); ember = bpy.context.active_object
ember.data.materials.append(glow_m); keyed(glow_e.inputs['Strength'], [(1, 0.0), (14, 30.0), (HIT - 2, 80.0), (HIT, 0.0)])
keys(ember, 'scale', [(1, (0.2, 0.2, 0.2)), (24, (1, 1, 1)), (HIT - 2, (1.1, 1.1, 1.1))])
keys(ember, 'location', [(1, (-0.12, -0.25, 0.18)), (HIT - 1, (0.02, 0.05, 0.06))], interp='SINE', easing='EASE_IN_OUT')
halo = rounded_mesh('EmberHalo', 0.5, 0.5, 0.2499, mat=None)
hn = bpy.data.materials.new('EmberHaloM'); hn.use_nodes = True; ht = hn.node_tree; ht.nodes.clear()
htc = ht.nodes.new('ShaderNodeTexCoord'); hgr = ht.nodes.new('ShaderNodeTexGradient'); hgr.gradient_type = 'SPHERICAL'
hmp = ht.nodes.new('ShaderNodeMapping'); hmp.inputs['Scale'].default_value = (4.0, 4.0, 4.0)
hpw = ht.nodes.new('ShaderNodeMath'); hpw.operation = 'POWER'; hpw.inputs[1].default_value = 3.0
hmu = ht.nodes.new('ShaderNodeMath'); hmu.operation = 'MULTIPLY'; keyed(hmu.inputs[1], [(1, 0.0), (20, 2.0), (HIT - 2, 2.4), (HIT, 0.0)])
hem = ht.nodes.new('ShaderNodeEmission'); hem.inputs['Color'].default_value = (*EMBER_HOT, 1)
htr = ht.nodes.new('ShaderNodeBsdfTransparent'); had = ht.nodes.new('ShaderNodeAddShader'); hou = ht.nodes.new('ShaderNodeOutputMaterial')
ht.links.new(htc.outputs['Object'], hmp.inputs['Vector']); ht.links.new(hmp.outputs['Vector'], hgr.inputs['Vector'])
ht.links.new(hgr.outputs['Fac'], hpw.inputs[0]); ht.links.new(hpw.outputs[0], hmu.inputs[0]); ht.links.new(hmu.outputs[0], hem.inputs['Strength'])
ht.links.new(htr.outputs[0], had.inputs[0]); ht.links.new(hem.outputs[0], had.inputs[1]); ht.links.new(had.outputs[0], hou.inputs['Surface'])
halo.data.materials.append(hn); halo.rotation_euler = (math.radians(90), 0, 0); halo.parent = ember
visible(halo, [(1, HIT)]); visible(ember, [(1, HIT)])
el = bpy.data.lights.new('EmberLight', 'POINT'); el.color = EMBER_HOT; el.shadow_soft_size = 0.05
emb_l = link(bpy.data.objects.new('EmberLight', el)); emb_l.location = (0.05, 0.6, 0.05)
keyed_energy(emb_l, [(1, 0.0), (20, 6.0), (HIT - 1, 18.0), (HIT, 2.0), (BACK, 2.0), (OUT, 0.0)])

# sparks off the edges on the hit (few, fine), slow embers in the air
def edge_points(n, frame):
    sc.frame_set(frame); bpy.context.view_layer.update(); mw = face.matrix_world; out = []
    for _ in range(n):
        u, s_ = random.random(), random.choice((-1, 1))
        p = Vector(((u - 0.5) * CW, s_ * CH / 2, 0)) if random.random() < 0.45 else Vector((s_ * CW / 2, (u - 0.5) * CH, 0))
        out.append(mw @ p)
    return out
ed = edge_points(600, HIT); c0 = face.matrix_world.translation.copy()
particles('HitSparks', ed, [p + (p - c0).normalized() * random.uniform(0.3, 1.0) for p in ed], [Vector((0, 0, 0.06))] * len(ed),
          [HIT + random.uniform(0, 5) for _ in ed], HIT, settle=16, base=0.0013, fly=0.0026, noise_amp=0.15,
          appear=HIT, vanish=(HIT + 18, HIT + 36), glow=0.4)
amb = [Vector((random.uniform(-2.0, 2.0), random.uniform(-2.0, 2.2), random.uniform(-1.3, 1.3))) for _ in range(380)]
particles('Embers', amb, [a + Vector((random.uniform(-0.08, 0.08), 0, random.uniform(0.4, 0.8))) for a in amb], [Vector((0, 0, 0))] * len(amb),
          [OUT + 10] * len(amb), 20, settle=10, base=0.0016, fly=0.0, noise_amp=0.2, appear=20, vanish=(OUT, OUT + 12), glow=0.25)

# ---------------------------------------------------------------- the logo (particles from the card)
LOGO_Z = 0.55
logo_m = principled('Logo', PAPER, rough=0.25, coat=0.7, emission=PAPER, estr=0.0)
lb = logo_m.node_tree.nodes['Principled BSDF']
keyed(lb.inputs['Emission Strength'], [(1, 0.0), (OUT + 22, 0.0), (OUT + 38, 0.5)])
word = text_obj('NEXT', FONT_DISPLAY, 0.5, logo_m, extrude=0.05, bevel=0.008, align='LEFT')
word.rotation_euler = (math.radians(90), 0, 0); bpy.context.view_layer.update()
ww = word.dimensions.x; dot_r = 0.042; gap = 0.06; scale = 1.3 / (ww + gap + 2 * dot_r)
word.scale = (scale, scale, scale); word.location = (-0.65, 0, LOGO_Z); bpy.context.view_layer.update()
dot_m, dot_e = emissive('Dot', EMBER, 0.0)
bpy.ops.mesh.primitive_uv_sphere_add(radius=dot_r * scale, segments=48, ring_count=24, location=(-0.65 + (ww + gap + dot_r) * scale, 0, LOGO_Z))
dot = bpy.context.active_object; dot.data.materials.append(dot_m); bpy.ops.object.shade_smooth()
DOT = 271                                              # global 1021 = 34.0 s, the final hit
keyed(dot_e.inputs['Strength'], [(1, 0.0), (DOT, 0.0), (DOT + 4, 26.0), (DOT + 18, 10.0), (END, 10.0)])
keys(dot, 'scale', [(DOT, (0.01, 0.01, 0.01)), (DOT + 8, (1, 1, 1))], interp='BACK', easing='EASE_OUT')
visible(word, [(OUT + 18, END)]); visible(dot, [(DOT, END)])
N = 2400 if PREVIEW else 7000
sc.frame_set(OUT); bpy.context.view_layer.update(); starts = surface_points(face, N)
sc.frame_set(OUT + 40); bpy.context.view_layer.update()
targets = surface_points(word, int(N * 0.93), jitter=0.003) + surface_points(dot, N - int(N * 0.93), jitter=0.002)
random.shuffle(targets)
particles('Collapse', starts, targets, [Vector((random.gauss(0, 0.3), -abs(random.gauss(0.25, 0.15)), random.gauss(0, 0.3))) for _ in starts],
          [OUT + 1 + 18 * max(0, min(1, (t.x + 0.65) / 1.3)) + random.uniform(0, 5) for t in targets], OUT, settle=14,
          base=0.0012, fly=0.0026, noise_amp=0.3, appear=OUT, vanish=(OUT + 34, OUT + 50), glow=0.38)

# ---------------------------------------------------------------- set & light: black, glossy floor (shadows + reflections)
def keep_off_floor(floor_ob, light_names):
    """Light linking: these lights still light the hero, but not the glossy floor (no light-shaped streaks in it)."""
    coll = bpy.data.collections.new('FloorOnly'); coll.objects.link(floor_ob)
    for nm in light_names:
        ob = bpy.data.objects[nm]; ob.light_linking.receiver_collection = coll
        for co in coll.collection_objects: co.light_linking.link_state = 'EXCLUDE'      # the floor is its only member
bpy.ops.mesh.primitive_plane_add(size=40, location=(0, 4, -1.05)); fl = bpy.context.active_object
fl.data.materials.append(principled('Floor', (0.004, 0.0035, 0.0035), rough=0.09, coat=0.6))
spot_d = bpy.data.lights.new('Spot', 'SPOT'); spot_d.spot_size = math.radians(30); spot_d.spot_blend = 0.4; spot_d.shadow_soft_size = 0.12
spot = link(bpy.data.objects.new('Spot', spot_d)); spot.location = (0.2, 0.15, 3.7)
spot.rotation_euler = (Vector((0, 0, 0)) - spot.location).to_track_quat('-Z', 'Y').to_euler()
keyed_energy(spot, [(1, 0.0), (HIT - 1, 0.0), (HIT, 1250.0), (HIT + 14, 640.0), (BACK, 640.0), (OUT + 6, 0.0)])
rimL = look_light('RimL', (-1.9, 0.9, 0.6), (0, 0, 0), 0.15, 0.0, color=EMBER, size_y=3.0)
rimR = look_light('RimR', (1.9, 0.9, -0.2), (0, 0, 0), 0.15, 0.0, color=(1.0, 0.75, 0.55), size_y=3.0)
for l in (rimL, rimR): keyed_energy(l, [(1, 0.0), (HIT - 1, 12.0), (HIT, 230.0), (HIT + 14, 140.0), (BACK, 140.0), (OUT + 10, 30.0)])
for nm, loc, e_ in (('SoftL', (-1.7, -2.3, 0.7), 12.0), ('SoftR', (1.8, -1.9, -0.2), 10.0)):
    sb = look_light(nm, loc, (0, 0, 0), 0.8, 0.0, color=(1.0, 0.93, 0.86), size_y=3.2)
    keyed_energy(sb, [(HIT - 1, 0.0), (HIT, e_), (OUT, e_), (OUT + 6, 0.0)])
sweep = look_light('Sweep', (-2.6, -2.0, 0.9), (0, 0, 0), 0.45, 0.0, size_y=2.6)                  # glint across the foil (29.0 s)
keyed_energy(sweep, [(108, 0.0), (118, 3.4), (160, 3.4), (172, 0.0)])
keys(sweep, 'location', [(108, (-2.6, -2.0, 0.9)), (172, (2.6, -2.0, 0.9))], interp='SINE', easing='EASE_IN_OUT')
sweep.rotation_euler.rotate_axis('Z', math.radians(35))
key = look_light('Key', (0.5, -3.5, 2.6), (0, 0, LOGO_Z), 3.0, 0.0); keyed_energy(key, [(OUT, 0.0), (OUT + 16, 110.0)])
look_light('LogoRim', (0.3, 3.0, 1.8), (0, 0, LOGO_Z), 3.0, 0.0)
lrim = bpy.data.objects['LogoRim']; lrim.data.color = EMBER; keyed_energy(lrim, [(OUT, 0.0), (OUT + 20, 480.0)])
lsweep = look_light('LogoSweep', (-3.0, -2.2, 1.4), (0, 0, LOGO_Z), 0.12, 0.0, size_y=6)
keyed_energy(lsweep, [(296, 0.0), (304, 260.0), (380, 260.0), (388, 0.0)])
keys(lsweep, 'location', [(298, (-3.0, -2.2, 1.4)), (386, (3.0, -2.2, 1.4))], interp='SINE', easing='EASE_IN_OUT')
for ob in bpy.data.objects:
    if ob.type == 'LIGHT': ob.visible_camera = False
keep_off_floor(fl, ('RimL', 'RimR', 'SoftL', 'SoftR', 'Sweep', 'LogoRim', 'LogoSweep'))

# ---------------------------------------------------------------- camera: the card turns to us, then we circle it
def orbit(deg, r, h): a = math.radians(deg); return (r * math.sin(a), -r * math.cos(a), h)
cam = Camera(lens=50, fstop=0.4)
cam.key(1, (0.3, -4.9, 0.12), (0.05, 0.4, 0.02), (0.25, 0.9, 0.05))
cam.key(HIT - 1, orbit(-14, 4.6, 0.1), (0.03, 0.1, 0.02), (0.05, 0.15, 0.02))
cam.key(130, orbit(24, 4.5, 0.12), (0, 0, 0.02), (0, 0, 0.02))
cam.key(180, orbit(6, 4.35, 0.07), (0, 0, 0.02), (0, 0, 0.02))
cam.key(BACK, orbit(0, 4.2, 0.05), (0, 0, 0.02), (0, 0, 0.02))
cam.key(OUT + 10, (0.0, -5.4, 0.25), (0, 0, 0.2), (0, 0.5, 0.25), 0.6)
cam.key(OUT + 44, (0.0, -6.0, 0.3), (0, 0, 0.13), (0, 0, LOGO_Z), 0.9)
cam.key(END, (0.0, -6.8, 0.34), (0, 0, 0.16), (0, 0, LOGO_Z))
cam.smooth()
for f, (dx, dz) in ((HIT + 1, (0.012, -0.009)), (HIT + 3, (-0.008, 0.006)), (HIT + 5, (0.004, -0.003))):     # the impact
    sc.frame_set(f); cam.target.location = cam.target.location + Vector((dx, 0, dz)); cam.target.keyframe_insert('location', frame=f)
cam.bind(1)
render(os.path.join(HERE, 'frames_finale'))
