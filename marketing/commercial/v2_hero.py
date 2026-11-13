"""v2 shots 5–6 (13.8–24.0 s, global frames 415–720): the FOUNDING BELIEVER
payoff, then the NEXT logo and call to action, in one continuous shot.
  1–36    darkness: embers converge, an ember energy line traces the card's
          edge as the card rises out of the dark
  37      THE HIT (15.0 s, on the beat): spotlight snaps on, halo flares, sparks
          burst off the edges, the camera takes the impact
  37–162  the card floats: chrome edge, lacquered face, light sweep, energy
          comets circling the rim, embers drifting past the lens (parallax)
  163–306 the card dissolves into particles that build the 3D NEXT logo (fast)
306 frames at 30 fps. Headlines and the call to action are added in post.

  blender-venv/bin/python v2_hero.py -- --assets DIR [--preview|--gpu] [--frames a-b|--list ...] [--out DIR]
"""
import math, os, random, sys
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from next3d import *
from mathutils import Vector

random.seed(51)
sc = init(306)
S = lambda name: os.path.join(ASSETS, name)
HIT, OUT = 37, 165

# ---------------------------------------------------------------- the card
img = load_image(S('card-hero.png'))
CW = 0.9; CH = CW * img.size[1] / img.size[0]
root = link(bpy.data.objects.new('CardRoot', None))
tilt = link(bpy.data.objects.new('CardTilt', None)); tilt.parent = root; tilt.rotation_euler = (math.radians(90), 0, 0)
chrome = principled('Chrome', (0.93, 0.9, 0.87), metallic=1.0, rough=0.11, aniso=0.4)
body = rounded_slab('CardBody', CW + 0.034, CH + 0.034, 0.075, depth=0.012, bevel=0.007, mat=chrome); body.parent = tilt
face_m = bpy.data.materials.new('CardFace'); face_m.use_nodes = True
fn = face_m.node_tree; fb = fn.nodes['Principled BSDF']
ftc = fn.nodes.new('ShaderNodeTexCoord'); ftex = fn.nodes.new('ShaderNodeTexImage'); ftex.image = img; ftex.extension = 'CLIP'; ftex.interpolation = 'Cubic'
fn.links.new(ftc.outputs['UV'], ftex.inputs['Vector']); fn.links.new(ftex.outputs['Color'], fb.inputs['Emission Color'])
fb.inputs['Base Color'].default_value = (0, 0, 0, 1); fb.inputs['Roughness'].default_value = 0.05
fb.inputs['Coat Weight'].default_value = 1.0; fb.inputs['Coat Roughness'].default_value = 0.02
for f, v in ((1, 0.0), (20, 0.08), (HIT - 1, 0.25), (HIT, 1.35), (HIT + 10, 1.0)):
    fb.inputs['Emission Strength'].default_value = v; fb.inputs['Emission Strength'].keyframe_insert('default_value', frame=f)
face = rounded_mesh('CardFace', CW, CH, 0.06, mat=face_m); face.parent = tilt; face.location.z = 0.0195
back = rounded_mesh('CardBack', CW, CH, 0.06, mat=principled('CardBackM', (0.02, 0.012, 0.01), rough=0.25, coat=1.0))
back.parent = tilt; back.location.z = -0.0195; back.rotation_euler.y = math.pi

# rise out of the dark → land on the hit → float
keys(root, 'location', [(1, (0, 0.3, -1.25)), (HIT - 1, (0, 0, 0)), (80, (0, 0, 0.03)), (120, (0, 0, -0.01)), (162, (0, 0, 0.02))])
keys(root, 'rotation_euler', [(1, (math.radians(32), 0, math.radians(-28))), (HIT - 1, (0, 0, math.radians(-2))),
                              (100, (math.radians(1.5), 0, math.radians(-6))), (162, (math.radians(2.5), 0, math.radians(4)))])
keys(root, 'scale', [(HIT - 1, (0.97, 0.97, 0.97)), (HIT + 1, (1.035, 1.035, 1.035)), (HIT + 8, (1, 1, 1)), (OUT, (1, 1, 1)), (OUT + 7, (0, 0, 0))])
for fc in iter_fcurves(root.animation_data.action):
    for kp in fc.keyframe_points:
        if round(kp.co.x) == 1: kp.interpolation = 'CUBIC'; kp.easing = 'EASE_OUT'
        if round(kp.co.x) == OUT: kp.interpolation = 'EXPO'; kp.easing = 'EASE_IN'

# ember energy around the edge: a line that traces it on, then two comets circling it
def rim_curve(name, strength_keys, mat_color=EMBER_HOT, radius=0.0045):
    c = bpy.data.curves.new(name, 'CURVE'); c.dimensions = '3D'; sp = c.splines.new('POLY')
    pts = rounded_rect_points(CW + 0.05, CH + 0.05, 0.09, 12); sp.points.add(len(pts))
    for i, (x, y) in enumerate(pts + pts[:1]): sp.points[i].co = (x, y, 0, 1)
    c.bevel_depth = radius; c.bevel_resolution = 3
    c.bevel_factor_mapping_start = c.bevel_factor_mapping_end = 'SPLINE'
    m, e = glow_material(name + 'M', mat_color, 0.0)
    ob = link(bpy.data.objects.new(name, c)); ob.data.materials.append(m); ob.parent = tilt
    for f, v in strength_keys:
        e.inputs['Strength'].default_value = v; e.inputs['Strength'].keyframe_insert('default_value', frame=f)
    return ob, c
trace, tc_ = rim_curve('Trace', [(5, 0.0), (8, 9.0), (HIT - 1, 11.0), (HIT, 32.0), (HIT + 10, 4.0), (OUT - 2, 4.0), (OUT + 2, 0.0)])
tc_.bevel_factor_end = 0.0; tc_.keyframe_insert('bevel_factor_end', frame=6)
tc_.bevel_factor_end = 1.0; tc_.keyframe_insert('bevel_factor_end', frame=HIT - 2)
visible(trace, [(6, OUT + 2)])
for k in range(2):
    comet, cc = rim_curve(f'Comet{k}', [(HIT, 0.0), (HIT + 6, 22.0), (OUT - 2, 22.0), (OUT + 2, 0.0)], (1.0, 0.62, 0.3), 0.007)
    cc.bevel_factor_start = 0.0; cc.keyframe_insert('bevel_factor_start', frame=HIT)
    cc.bevel_factor_end = 0.1; cc.keyframe_insert('bevel_factor_end', frame=HIT)
    cc.bevel_factor_start = 0.88; cc.keyframe_insert('bevel_factor_start', frame=OUT)
    cc.bevel_factor_end = 0.98; cc.keyframe_insert('bevel_factor_end', frame=OUT)
    set_interp(cc, 'LINEAR')
    comet.rotation_euler.z = math.pi * k          # second comet starts on the opposite side
    visible(comet, [(HIT, OUT + 2)])

# halo behind the card + soft bloom disc
bpy.ops.mesh.primitive_torus_add(major_radius=0.6, minor_radius=0.009, major_segments=128, minor_segments=8)
halo = bpy.context.active_object; halo.rotation_euler = (math.radians(90), 0, 0); halo.location = (0, 0.7, 0.02)
hm, he = glow_material('HaloM', EMBER_HOT, 0.0); halo.data.materials.append(hm)
for f, s_, st in ((HIT - 1, 0.7, 0.0), (HIT, 0.85, 14.0), (HIT + 14, 1.18, 3.0), (OUT - 2, 1.22, 2.2), (OUT + 2, 1.24, 0.0)):
    halo.scale = (s_, s_, s_); halo.keyframe_insert('scale', frame=f)
    he.inputs['Strength'].default_value = st; he.inputs['Strength'].keyframe_insert('default_value', frame=f)
visible(halo, [(HIT - 1, OUT + 2)])
disc = rounded_mesh('HaloDisc', 3.4, 3.4, 1.69)
dm = bpy.data.materials.new('HaloDiscM'); dm.use_nodes = True; dn = dm.node_tree; dn.nodes.clear()
dtc = dn.nodes.new('ShaderNodeTexCoord'); dgr = dn.nodes.new('ShaderNodeTexGradient'); dgr.gradient_type = 'SPHERICAL'
dmp = dn.nodes.new('ShaderNodeMapping'); dmp.inputs['Scale'].default_value = (0.6, 0.6, 0.6)
dpw = dn.nodes.new('ShaderNodeMath'); dpw.operation = 'POWER'; dpw.inputs[1].default_value = 2.5
dmu = dn.nodes.new('ShaderNodeMath'); dmu.operation = 'MULTIPLY'
for f, v in ((1, 0.0), (HIT - 1, 0.05), (HIT, 0.9), (HIT + 14, 0.32), (OUT, 0.3), (OUT + 8, 0.0)):
    dmu.inputs[1].default_value = v; dmu.inputs[1].keyframe_insert('default_value', frame=f)
dem = dn.nodes.new('ShaderNodeEmission'); dem.inputs['Color'].default_value = (*EMBER, 1); dout = dn.nodes.new('ShaderNodeOutputMaterial')
dn.links.new(dtc.outputs['Object'], dmp.inputs['Vector']); dn.links.new(dmp.outputs['Vector'], dgr.inputs['Vector'])
dn.links.new(dgr.outputs['Fac'], dpw.inputs[0]); dn.links.new(dpw.outputs[0], dmu.inputs[0]); dn.links.new(dmu.outputs[0], dem.inputs['Strength'])
dn.links.new(dem.outputs[0], dout.inputs['Surface']); disc.data.materials.append(dm)
disc.rotation_euler = (math.radians(90), 0, 0); disc.location = (0, 1.2, 0.0)

# ---------------------------------------------------------------- particles
def card_edge_points(n, frame):
    sc.frame_set(frame); bpy.context.view_layer.update()
    mw = face.matrix_world; out = []
    for _ in range(n):
        u, sign = random.random(), random.choice((-1, 1))
        p = Vector(((u - 0.5) * CW, sign * CH / 2, 0)) if random.random() < 0.45 else Vector((sign * CW / 2, (u - 0.5) * CH, 0))
        out.append(mw @ p)
    return out
# embers converge to the rim as the card rises
tg = card_edge_points(2200, HIT - 1)
st = []
for p in tg:
    a = random.uniform(0, 2 * math.pi); r = random.uniform(1.4, 2.8)
    st.append(Vector((math.cos(a) * r, random.uniform(0.2, 2.2), math.sin(a) * r * 1.2 - 0.4)))
particles('Converge', st, tg, [Vector((random.gauss(0, 0.3), 0, random.gauss(0, 0.3))) for _ in tg],
          [4 + random.uniform(0, 26) for _ in tg], 2, settle=8, base=0.0016, fly=0.0032, noise_amp=0.35, appear=2, vanish=(HIT, HIT + 6), glow=0.4)
# the hit: sparks thrown off the edges
ed = card_edge_points(1500, HIT)
c0 = face.matrix_world.translation.copy()
particles('HitSparks', ed, [p + (p - c0).normalized() * random.uniform(0.4, 1.4) + Vector((0, -random.uniform(0, 0.7), 0)) for p in ed],
          [Vector((0, 0, 0.08)) for _ in ed], [HIT + random.uniform(0, 4) for _ in ed], HIT, settle=12,
          base=0.0018, fly=0.0034, noise_amp=0.2, appear=HIT, vanish=(HIT + 18, HIT + 34), glow=0.45)
# embers drifting past (some between the lens and the card: parallax + bokeh)
amb = [Vector((random.uniform(-2.2, 2.2), random.uniform(-2.2, 2.4), random.uniform(-1.4, 1.2))) for _ in range(650)]
particles('Drift', amb, [a + Vector((random.uniform(-0.1, 0.1), 0, random.uniform(0.35, 0.7))) for a in amb], [Vector((0, 0, 0))] * len(amb),
          [HIT + 120] * len(amb), HIT, settle=10, base=0.0022, fly=0.0, noise_amp=0.25, appear=HIT, vanish=(OUT - 4, OUT + 8), glow=0.3)

# ---------------------------------------------------------------- the logo (from v1 scene 4)
LOGO_Z = 0.62
logo_m = principled('Logo', PAPER, rough=0.28, coat=0.6, emission=PAPER, estr=0.0)
lb = logo_m.node_tree.nodes['Principled BSDF']
for f, v in ((1, 0.0), (OUT + 22, 0.0), (OUT + 38, 0.55)):
    lb.inputs['Emission Strength'].default_value = v; lb.inputs['Emission Strength'].keyframe_insert('default_value', frame=f)
word = text_obj('NEXT', FONT_DISPLAY, 0.5, logo_m, extrude=0.045, bevel=0.007, align='LEFT')
word.rotation_euler = (math.radians(90), 0, 0)
bpy.context.view_layer.update()
ww = word.dimensions.x; dot_r = 0.042; gap = 0.06
scale = 1.3 / (ww + gap + 2 * dot_r)
word.scale = (scale, scale, scale); word.location = (-1.3 / 2, 0, LOGO_Z)
bpy.context.view_layer.update()
dot_m, dot_e = emissive('Dot', EMBER, 0.0)
bpy.ops.mesh.primitive_uv_sphere_add(radius=dot_r * scale, segments=48, ring_count=24, location=(-1.3 / 2 + (ww + gap + dot_r) * scale, 0, LOGO_Z))
dot = bpy.context.active_object; dot.data.materials.append(dot_m); bpy.ops.object.shade_smooth()
DOT = OUT + 31            # the dot pops as the last particles land
CTA = 235                 # global 649: JOIN NEXT
for f, v in ((1, 0.0), (DOT, 0.0), (DOT + 4, 26.0), (DOT + 16, 11.0), (CTA - 1, 11.0), (CTA + 2, 34.0), (CTA + 14, 12.0)):
    dot_e.inputs['Strength'].default_value = v; dot_e.inputs['Strength'].keyframe_insert('default_value', frame=f)
keys(dot, 'scale', [(DOT, (0.01, 0.01, 0.01)), (DOT + 8, (1, 1, 1))], interp='BACK', easing='EASE_OUT')
visible(word, [(OUT + 20, 306)]); visible(dot, [(DOT, 306)])
fl_m, fl_e = glow_material('Flash', EMBER_HOT, 0.0)
flash = rounded_mesh('Flash', CW * 1.04, CH * 1.04, 0.07, mat=fl_m); flash.parent = tilt; flash.location.z = 0.03
for f, v in ((OUT, 0.0), (OUT + 2, 1.0), (OUT + 4, 0.0)):
    fl_e.inputs['Strength'].default_value = v; fl_e.inputs['Strength'].keyframe_insert('default_value', frame=f)
visible(flash, [])                      # (kept for tuning; the particles are the transition)
N = 2500 if PREVIEW else 6500
sc.frame_set(OUT + 1); bpy.context.view_layer.update()
starts = surface_points(face, N)
sc.frame_set(OUT + 40); bpy.context.view_layer.update()
targets = surface_points(word, int(N * 0.93), jitter=0.003) + surface_points(dot, N - int(N * 0.93), jitter=0.002)
random.shuffle(targets)
bursts, delays = [], []
for s0, t0 in zip(starts, targets):
    bursts.append(Vector((random.gauss(0, 0.35), -abs(random.gauss(0.3, 0.2)), random.gauss(0, 0.35))))
    delays.append(OUT + 2 + 13 * max(0, min(1, (t0.x + 0.65) / 1.3)) + random.uniform(0, 4))
particles('Collapse', starts, targets, bursts, delays, OUT + 1, settle=10, base=0.0015, fly=0.0032, noise_amp=0.35,
          appear=OUT + 1, vanish=(OUT + 30, OUT + 44), glow=0.42)

# ---------------------------------------------------------------- set & light
fl = floor(-1.05, grid=0.07)
fl.data.materials[0].node_tree.nodes['Principled BSDF'].inputs['Roughness'].default_value = 0.07
bg = rounded_mesh('Back', 30, 30, 1)
gm = bpy.data.materials.new('BackM'); gm.use_nodes = True; gn = gm.node_tree; gn.nodes.clear()
gtc = gn.nodes.new('ShaderNodeTexCoord'); ggr = gn.nodes.new('ShaderNodeTexGradient'); ggr.gradient_type = 'SPHERICAL'
gmp = gn.nodes.new('ShaderNodeMapping'); gmp.inputs['Scale'].default_value = (0.2, 0.2, 0.2)
gem = gn.nodes.new('ShaderNodeEmission'); gem.inputs['Color'].default_value = (*EMBER, 1)
gpw = gn.nodes.new('ShaderNodeMath'); gpw.operation = 'POWER'; gpw.inputs[1].default_value = 3.0
gmu = gn.nodes.new('ShaderNodeMath'); gmu.operation = 'MULTIPLY'
for f, v in ((1, 0.015), (HIT - 1, 0.03), (HIT, 0.09), (OUT, 0.08), (OUT + 30, 0.1)):
    gmu.inputs[1].default_value = v; gmu.inputs[1].keyframe_insert('default_value', frame=f)
go = gn.nodes.new('ShaderNodeOutputMaterial')
gn.links.new(gtc.outputs['Object'], gmp.inputs['Vector']); gn.links.new(gmp.outputs['Vector'], ggr.inputs['Vector'])
gn.links.new(ggr.outputs['Fac'], gpw.inputs[0]); gn.links.new(gpw.outputs[0], gmu.inputs[0]); gn.links.new(gmu.outputs[0], gem.inputs['Strength'])
gn.links.new(gem.outputs[0], go.inputs['Surface'])
bg.data.materials.append(gm); bg.location = (0, 8, 0.4); bg.rotation_euler = (math.radians(90), 0, 0)

def keyed_energy(light_obj, pairs):
    for f, v in pairs:
        light_obj.data.energy = v; light_obj.data.keyframe_insert('energy', frame=f)
spot_d = bpy.data.lights.new('Spot', 'SPOT'); spot_d.spot_size = math.radians(34); spot_d.spot_blend = 0.35; spot_d.shadow_soft_size = 0.15
spot = link(bpy.data.objects.new('Spot', spot_d)); spot.location = (0.25, -0.7, 3.4)
spot.rotation_euler = (Vector((0, 0, 0)) - spot.location).to_track_quat('-Z', 'Y').to_euler()
keyed_energy(spot, [(1, 0.0), (HIT - 1, 0.0), (HIT, 2600.0), (HIT + 12, 1300.0), (OUT, 1300.0), (OUT + 8, 0.0)])
rimL = look_light('RimL', (-1.9, 0.9, 0.6), (0, 0, 0), 0.15, 0.0, color=EMBER, size_y=3.0)
rimR = look_light('RimR', (1.9, 0.9, -0.2), (0, 0, 0), 0.15, 0.0, color=(1.0, 0.75, 0.55), size_y=3.0)
for l in (rimL, rimR):
    keyed_energy(l, [(1, 8.0), (HIT - 1, 25.0), (HIT, 260.0), (HIT + 12, 150.0), (OUT, 150.0), (OUT + 10, 40.0)])
sweep = look_light('Sweep', (-2.6, -2.0, 0.9), (0, 0, 0), 0.05, 0.0, size_y=2.2)
keyed_energy(sweep, [(66, 0.0), (72, 35.0), (108, 35.0), (114, 0.0)])
keys(sweep, 'location', [(66, (-2.6, -2.0, 0.9)), (114, (2.6, -2.0, 0.9))], interp='SINE', easing='EASE_IN_OUT')
sweep.rotation_euler.rotate_axis('Z', math.radians(35))
key = look_light('Key', (0.5, -3.5, 2.6), (0, 0, LOGO_Z), 3.0, 0.0)
keyed_energy(key, [(OUT, 0.0), (OUT + 14, 120.0)])
look_light('LogoRim', (0.3, 3.0, 1.8), (0, 0, LOGO_Z), 3.0, 500, color=EMBER)
lsweep = look_light('LogoSweep', (-3.0, -2.2, 1.4), (0, 0, LOGO_Z), 0.12, 300, size_y=6)
keys(lsweep, 'location', [(OUT + 40, (-3.0, -2.2, 1.4)), (OUT + 85, (3.0, -2.2, 1.4))], interp='SINE', easing='EASE_IN_OUT')

# ---------------------------------------------------------------- camera
cam = Camera(lens=50, fstop=2.8)
cam.key(1, (0.25, -5.6, -0.4), (0, 0, -0.3))
cam.key(HIT - 1, (0.14, -5.0, 0.04), (0, 0, -0.02))
cam.key(162, (-0.2, -3.95, 0.03), (0, 0, 0.0))
cam.key(OUT + 8, (-0.12, -4.5, 0.12), (0, 0, 0.12), (0, 0, 0.1))
cam.key(OUT + 40, (0.0, -6.5, 0.3), (0, 0, 0.18), (0, 0, LOGO_Z))
cam.key(306, (0.0, -5.85, 0.32), (0, 0, 0.2), (0, 0, LOGO_Z))
cam.smooth()
# the impact: a short, decaying shake on the hit
def lerp(a, b, t): return a + (b - a) * t
for f, (dx, dz) in ((HIT + 1, (0.016, -0.012)), (HIT + 3, (-0.011, 0.009)), (HIT + 5, (0.006, -0.005)), (HIT + 7, (-0.002, 0.002))):
    t = (f - (HIT - 1)) / (162 - (HIT - 1))
    cam.target.location = (lerp(0, 0, t) + dx, 0, lerp(-0.02, 0.0, t) + dz); cam.target.keyframe_insert('location', frame=f)
cam.bind(1)
render(os.path.join(HERE, 'frames_v2_hero'))
