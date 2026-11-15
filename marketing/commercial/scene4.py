"""Scene 4 (16.2–22.2 s): everything collapses into the NEXT logo.
The Founding Believer card from scene 3 dissolves into particles that stream
into a 3D NEXT wordmark (the site's Bricolage letterforms + ember dot).
180 frames at 30 fps. Tagline and call to action are added in post.

  blender-venv/bin/python scene4.py -- --assets DIR [--preview|--gpu] [--frames a-b|--list ...] [--out DIR]
"""
import math, os, random, sys
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from next3d import *
from mathutils import Vector

random.seed(41)
sc = init(180)
S = lambda name: os.path.join(ASSETS, name)

# ---------------------------------------------------------------- the card (continuity from scene 3's last frame)
img = load_image(S('card-founding-believer.png'))
cw = 0.72; ch = cw * img.size[1] / img.size[0]
face_m = bpy.data.materials.new('CardFaceM'); face_m.use_nodes = True
fn = face_m.node_tree; fb = fn.nodes['Principled BSDF']
ftc = fn.nodes.new('ShaderNodeTexCoord'); ftex = fn.nodes.new('ShaderNodeTexImage'); ftex.image = img; ftex.extension = 'CLIP'
fn.links.new(ftc.outputs['UV'], ftex.inputs['Vector']); fn.links.new(ftex.outputs['Color'], fb.inputs['Emission Color'])
fb.inputs['Base Color'].default_value = (0, 0, 0, 1); fb.inputs['Emission Strength'].default_value = 1.2; fb.inputs['Roughness'].default_value = 0.05
card = link(bpy.data.objects.new('Card', None)); card.location = (0, 0, 0.05); card.rotation_euler = (math.radians(1), 0, math.radians(6))
tilt = link(bpy.data.objects.new('CardTilt', None)); tilt.parent = card; tilt.rotation_euler = (math.radians(90), 0, 0)
edge = rounded_slab('CardEdge', cw + 0.02, ch + 0.02, 0.07, depth=0.012, bevel=0.004, mat=principled('Gold', (1.0, 0.78, 0.45), metallic=1.0, rough=0.2))
edge.parent = tilt
face = rounded_mesh('CardFace', cw, ch, 0.06, mat=face_m); face.parent = tilt; face.location.z = 0.019
keys(card, 'scale', [(5, (1, 1, 1)), (12, (0.0, 0.0, 0.0))], interp='EXPO', easing='EASE_IN')
fl_m, fl_e = glow_material('Flash', EMBER_HOT, 0.0)
flash = rounded_mesh('Flash', cw * 1.2, ch * 1.2, 0.1, mat=fl_m); flash.parent = tilt; flash.location.z = 0.03
for f, v in ((5, 0.0), (7, 6.0), (10, 0.0)):
    fl_e.inputs['Strength'].default_value = v; fl_e.inputs['Strength'].keyframe_insert('default_value', frame=f)

# ---------------------------------------------------------------- the logo
LOGO_Z = 0.62
logo_m = principled('Logo', PAPER, rough=0.28, coat=0.6, emission=PAPER, estr=0.0)
lb = logo_m.node_tree.nodes['Principled BSDF']
for f, v in ((1, 0.0), (30, 0.0), (48, 0.55)):
    lb.inputs['Emission Strength'].default_value = v; lb.inputs['Emission Strength'].keyframe_insert('default_value', frame=f)
word = text_obj('NEXT', FONT_DISPLAY, 0.5, logo_m, extrude=0.045, bevel=0.007, align='LEFT')
word.rotation_euler = (math.radians(90), 0, 0)
bpy.context.view_layer.update()
ww = word.dimensions.x
dot_r = 0.042; gap = 0.06
lock_w = ww + gap + 2 * dot_r
scale = 1.3 / lock_w
word.scale = (scale, scale, scale)
word.location = (-1.3 / 2, 0, LOGO_Z)
bpy.context.view_layer.update()
dot_m, dot_e = emissive('Dot', EMBER, 0.0)
bpy.ops.mesh.primitive_uv_sphere_add(radius=dot_r * scale, segments=48, ring_count=24, location=(-1.3 / 2 + (ww + gap + dot_r) * scale, 0, LOGO_Z))
dot = bpy.context.active_object; dot.data.materials.append(dot_m); bpy.ops.object.shade_smooth()
for f, v in ((1, 0.0), (42, 0.0), (47, 30.0), (60, 12.0), (108, 12.0), (111, 40.0), (125, 14.0)):
    dot_e.inputs['Strength'].default_value = v; dot_e.inputs['Strength'].keyframe_insert('default_value', frame=f)
keys(dot, 'scale', [(42, (0.01, 0.01, 0.01)), (50, (1, 1, 1))], interp='BACK', easing='EASE_OUT')
visible(word, [(30, 180)])

# ---------------------------------------------------------------- particles: card -> logo
N = 3000 if PREVIEW else 9000
sc.frame_set(6); bpy.context.view_layer.update()
starts = surface_points(face, N)
sc.frame_set(60); bpy.context.view_layer.update()
targets = surface_points(word, int(N * 0.93), jitter=0.004) + surface_points(dot, N - int(N * 0.93), jitter=0.002)
random.shuffle(targets)
bursts, delays = [], []
for s0, t0 in zip(starts, targets):
    bursts.append(Vector((random.gauss(0, 0.5), -abs(random.gauss(0.4, 0.3)), random.gauss(0, 0.5))))
    xn = (t0.x + 0.65) / 1.3
    delays.append(8 + 22 * max(0, min(1, xn)) + random.uniform(0, 6))
particles('Collapse', starts, targets, bursts, delays, 6, settle=12, base=0.0028, fly=0.006, noise_amp=0.5, appear=6, vanish=(46, 64))

# ---------------------------------------------------------------- set & light
floor(-1.25, grid=0.18)
bg = rounded_mesh('Glow', 30, 30, 1)
gm = bpy.data.materials.new('GlowM'); gm.use_nodes = True
gn = gm.node_tree; gn.nodes.clear()
gtc = gn.nodes.new('ShaderNodeTexCoord'); ggr = gn.nodes.new('ShaderNodeTexGradient'); ggr.gradient_type = 'SPHERICAL'
gmp = gn.nodes.new('ShaderNodeMapping'); gmp.inputs['Scale'].default_value = (0.2, 0.2, 0.2)
gem = gn.nodes.new('ShaderNodeEmission'); gem.inputs['Color'].default_value = (*EMBER, 1)
gpw = gn.nodes.new('ShaderNodeMath'); gpw.operation = 'POWER'; gpw.inputs[1].default_value = 3.0
gmu = gn.nodes.new('ShaderNodeMath'); gmu.operation = 'MULTIPLY'; gmu.inputs[1].default_value = 0.0
for f, v in ((1, 0.04), (45, 0.04), (60, 0.1), (180, 0.1)):
    gmu.inputs[1].default_value = v; gmu.inputs[1].keyframe_insert('default_value', frame=f)
go = gn.nodes.new('ShaderNodeOutputMaterial')
gn.links.new(gtc.outputs['Object'], gmp.inputs['Vector']); gn.links.new(gmp.outputs['Vector'], ggr.inputs['Vector'])
gn.links.new(ggr.outputs['Fac'], gpw.inputs[0]); gn.links.new(gpw.outputs[0], gmu.inputs[0]); gn.links.new(gmu.outputs[0], gem.inputs['Strength'])
gn.links.new(gem.outputs[0], go.inputs['Surface'])
bg.data.materials.append(gm); bg.location = (0, 8, LOGO_Z); bg.rotation_euler = (math.radians(90), 0, 0)
look_light('Key', (0.5, -3.5, 2.6), (0, 0, LOGO_Z), 3.0, 120)
look_light('Rim', (0.3, 3.0, 1.8), (0, 0, LOGO_Z), 3.0, 500, color=EMBER)
sweep = look_light('Sweep', (-3.0, -2.2, 1.4), (0, 0, LOGO_Z), 0.12, 300, size_y=6)
keys(sweep, 'location', [(55, (-3.0, -2.2, 1.4)), (100, (3.0, -2.2, 1.4))], interp='SINE', easing='EASE_IN_OUT')

# ---------------------------------------------------------------- camera
cam = Camera(lens=50, fstop=2.8)
cam.key(1, (0.12, -4.8, 0.25), (0.12, 0, 0.1), (0, 0, 0))
cam.key(50, (0.0, -6.6, 0.3), (0, 0, 0.18), (0, 0, LOGO_Z))
cam.key(180, (0.0, -5.9, 0.32), (0, 0, 0.2), (0, 0, LOGO_Z))
cam.smooth(); cam.bind(1)
render(os.path.join(HERE, 'frames_s4'))
