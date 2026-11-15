"""Scene 3 (9.0–16.2 s): PROVE YOU WERE EARLY.
Three shots, cut on the beat (216 frames at 30 fps):
  A  1–72    flight over 3D price charts built from the invented artists'
             in-app price histories, with floating price tags
  B  73–144  the phone: portfolio (+%), then the leaderboard (#1)
  C  145–216 the Founding Believer card reveal (holographic slab)

  blender-venv/bin/python scene3.py -- --assets DIR [--preview|--gpu] [--frames a-b|--list ...] [--out DIR]
"""
import json, math, os, random, sys
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from next3d import *
from mathutils import Vector

random.seed(31)
sc = init(216)
S = lambda name: os.path.join(ASSETS, name)
series = json.load(open(S('series.json')))

# ================================================================ A: charts (around the origin)
lines = [('Velvet Static', EMBER_HOT, 16.0, 0.0), ('Sol Kaito', (1.0, 0.55, 0.25), 11.0, 1.3), ('Mira Solace', (1.0, 0.8, 0.62), 8.0, 2.6)]
mono_mat = emissive('Mono', PAPER, 2.2)[0]
up_mat = emissive('UpTxt', UP, 3.5)[0]
for k, (name, col, strength, depth) in enumerate(lines):
    vals = smooth_series(series[name], 90)
    ob, pts = chart_line(f'Line{k}', vals, -3.2, 3.2, -1.25, 2.3 - 0.35 * k, depth_y=depth, radius=0.022 - 0.004 * k,
                         strength=strength, color=col, reveal=(2 + 6 * k, 46 + 6 * k))
    # soft glow sheet under each line
    first, last = series[name][0], series[name][-1]
    tag = text_obj(name.upper(), FONT_MONO, 0.13, mono_mat, align='LEFT')
    tag.location = pts[-1] + Vector((-1.15, -0.02, 0.32)); tag.rotation_euler = (math.radians(90), 0, 0)
    price = text_obj(f'${last / 100:.2f}  +{(last - first) / first * 100:.1f}%', FONT_MONO, 0.13, up_mat, align='LEFT')
    price.location = pts[-1] + Vector((-1.15, -0.02, 0.14)); price.rotation_euler = (math.radians(90), 0, 0)
    for t_ in (tag, price):
        visible(t_, [(40 + 6 * k, 72)])
        keys(t_, 'scale', [(40 + 6 * k, (0.6, 0.6, 0.6)), (48 + 6 * k, (1, 1, 1))], interp='BACK', easing='EASE_OUT')
floor(-1.3, grid=0.7)
# dust in the air
dust = [Vector((random.uniform(-4, 4), random.uniform(-0.5, 4), random.uniform(-1.2, 2.2))) for _ in range(700)]
particles('Dust', dust, [d + Vector((0, 0, 0.05)) for d in dust], [Vector((0, 0, 0))] * len(dust), [1.0] * len(dust), 1,
          settle=80, base=0.0028, fly=0.0, noise_amp=0.0, appear=1, vanish=(70, 73))
camA = Camera(lens=30, fstop=2.2)
camA.key(1, (-3.9, -2.6, -0.85), (-1.6, 1.0, -0.2), (-1.8, 0.4, -0.6))
camA.key(36, (-0.6, -2.9, -0.35), (0.6, 1.0, 0.25), (0.2, 0.2, 0.0))
camA.key(72, (2.4, -2.5, 0.35), (2.6, 1.0, 1.05), (2.6, 0.1, 0.8))
camA.smooth(); camA.bind(1)
look_light('A_Key', (0, -3, 3), (0, 0.5, 0), 6, 120)

# ================================================================ B: phone (around x = 50)
BX = 50
phone, scr = build_phone('PhoneB', [(S('07-portfolio.png'), 1, 'cut'), (S('08-leaderboard.png'), 109, 'up')], back_logo=False)
phone.location = (BX, 0, 0)
keys(phone, 'rotation_euler', [(73, (math.radians(4), 0, math.radians(-16))), (144, (math.radians(2), 0, math.radians(10)))], interp='LINEAR')
for k in range(3):   # out-of-focus chart glow behind the phone
    vals = smooth_series(series[lines[k][0]], 60)
    chart_line(f'BLine{k}', vals, BX - 3.5, BX + 3.5, -1.6 + 0.6 * k, 2.4, depth_y=3.5 + k, radius=0.03, strength=6.0, color=lines[k][1])
camB = Camera(lens=50, fstop=2.0)
camB.key(73, (BX + 1.1, -5.3, 0.7), (BX, 0, 0.12), (BX, 0, 0))
camB.key(144, (BX - 0.8, -4.7, 0.25), (BX, 0, 0.1), (BX, 0, 0))
camB.smooth(); camB.bind(73)
rigB = link(bpy.data.objects.new('RigB', None)); rigB.location = (BX, 0, 0)
for nm, loc, sz, szy, e in (('B_StripL', (BX - 2.6, -2.2, 1.6), 0.12, 5.0, 160), ('B_StripR', (BX + 2.8, -1.4, 0.6), 0.12, 5.0, 120)):
    look_light(nm, loc, (BX, 0, 0), sz, e, size_y=szy).parent = rigB
look_light('B_Rim', (BX + 0.4, 3.0, 1.4), (BX, 0, 0), 3.0, 380, color=EMBER)

# ================================================================ C: Founding Believer card (around x = 100)
CX = 100
img = load_image(S('card-founding-believer.png'))
cw = 0.72; ch = cw * img.size[1] / img.size[0]
# holographic face: the real card image + an iridescent sheen that shifts with the view angle
m = bpy.data.materials.new('Holo'); m.use_nodes = True
nt = m.node_tree; b = nt.nodes['Principled BSDF']
tc = nt.nodes.new('ShaderNodeTexCoord'); tex = nt.nodes.new('ShaderNodeTexImage'); tex.image = img; tex.extension = 'CLIP'
nt.links.new(tc.outputs['UV'], tex.inputs['Vector'])
lw = nt.nodes.new('ShaderNodeLayerWeight'); lw.inputs['Blend'].default_value = 0.35
nz = nt.nodes.new('ShaderNodeTexNoise'); nz.inputs['Scale'].default_value = 3.0
nt.links.new(tc.outputs['UV'], nz.inputs['Vector'])
addf = nt.nodes.new('ShaderNodeMath'); addf.operation = 'ADD'
nt.links.new(lw.outputs['Facing'], addf.inputs[0]); nt.links.new(nz.outputs['Fac'], addf.inputs[1])
rb = nt.nodes.new('ShaderNodeValToRGB')
els = rb.color_ramp.elements; els[0].position = 0.0; els[0].color = (1.0, 0.35, 0.2, 1); els[1].position = 1.0; els[1].color = (0.3, 0.6, 1.0, 1)
e2 = els.new(0.35); e2.color = (1.0, 0.85, 0.3, 1); e3 = els.new(0.65); e3.color = (0.5, 1.0, 0.7, 1)
nt.links.new(addf.outputs[0], rb.inputs['Fac'])
sheen = nt.nodes.new('ShaderNodeMix'); sheen.data_type = 'RGBA'; sheen.blend_type = 'SCREEN'
sock(sheen.inputs, 'Factor', 'VALUE').default_value = 0.055
nt.links.new(tex.outputs['Color'], sock(sheen.inputs, 'A', 'RGBA')); nt.links.new(rb.outputs['Color'], sock(sheen.inputs, 'B', 'RGBA'))
nt.links.new(sock(sheen.outputs, 'Result', 'RGBA'), b.inputs['Emission Color'])
b.inputs['Emission Strength'].default_value = 1.2
b.inputs['Base Color'].default_value = (0, 0, 0, 1); b.inputs['Roughness'].default_value = 0.05; b.inputs['Coat Weight'].default_value = 1.0
card_root = link(bpy.data.objects.new('CardRoot', None)); card_root.location = (CX, 0, 0)
spin_c = link(bpy.data.objects.new('CardSpin', None)); spin_c.parent = card_root
holder = link(bpy.data.objects.new('CardTilt', None)); holder.parent = spin_c; holder.rotation_euler = (math.radians(90), 0, 0)
edge = rounded_slab('CardEdge', cw + 0.02, ch + 0.02, 0.07, depth=0.012, bevel=0.004,
                    mat=principled('CardGold', (1.0, 0.78, 0.45), metallic=1.0, rough=0.2)); edge.parent = holder
face = rounded_mesh('CardFace', cw, ch, 0.06, mat=m); face.parent = holder; face.location.z = 0.019
back = rounded_mesh('CardBack', cw, ch, 0.06, mat=principled('CardBackMat', (0.03, 0.02, 0.02), rough=0.3, coat=1.0))
back.parent = holder; back.location.z = -0.019; back.rotation_euler.y = math.pi
keys(spin_c, 'location', [(145, (0.5, 5.5, -1.0)), (170, (0, 0, 0)), (216, (0, 0, 0.05))])
keys(spin_c, 'rotation_euler', [(145, (math.radians(20), 0, math.radians(-720 - 40))), (170, (math.radians(3), 0, math.radians(-8))),
                                (216, (math.radians(1), 0, math.radians(6)))])
for fc in iter_fcurves(spin_c.animation_data.action):
    for kp in fc.keyframe_points:
        if round(kp.co.x) == 145: kp.interpolation = 'EXPO'; kp.easing = 'EASE_OUT'
# sparks off the card edge when it lands
sc.frame_set(171); bpy.context.view_layer.update()
mw = face.matrix_world
starts, targets, bursts, delays = [], [], [], []
for _ in range(1600):
    u, sign = random.random(), random.choice((-1, 1))
    p = Vector(((u - 0.5) * cw, sign * ch / 2, 0)) if random.random() < 0.5 else Vector((sign * cw / 2, (u - 0.5) * ch, 0))
    s0 = mw @ p
    d = (s0 - mw @ Vector((0, 0, 0))).normalized()
    starts.append(s0); targets.append(s0 + d * random.uniform(0.3, 1.2) + Vector((0, -random.uniform(0, 0.6), 0)))
    bursts.append(Vector((0, 0, 0.1))); delays.append(171 + random.uniform(0, 5))
particles('CardSparks', starts, targets, bursts, delays, 171, settle=12, base=0.0025, fly=0.004, noise_amp=0.2, appear=171, vanish=(190, 205))
backdrop = rounded_mesh('BackGlow', 30, 30, 1, mat=None)
bg_m = bpy.data.materials.new('BackGlowM'); bg_m.use_nodes = True
bn = bg_m.node_tree; bn.nodes.clear()
btc = bn.nodes.new('ShaderNodeTexCoord'); bgr = bn.nodes.new('ShaderNodeTexGradient'); bgr.gradient_type = 'SPHERICAL'
bmp = bn.nodes.new('ShaderNodeMapping'); bmp.inputs['Scale'].default_value = (0.2, 0.2, 0.2)
bem = bn.nodes.new('ShaderNodeEmission'); bem.inputs['Color'].default_value = (*EMBER, 1)
bpw = bn.nodes.new('ShaderNodeMath'); bpw.operation = 'POWER'; bpw.inputs[1].default_value = 3.0
bmu = bn.nodes.new('ShaderNodeMath'); bmu.operation = 'MULTIPLY'; bmu.inputs[1].default_value = 0.14
bo = bn.nodes.new('ShaderNodeOutputMaterial')
bn.links.new(btc.outputs['Object'], bmp.inputs['Vector']); bn.links.new(bmp.outputs['Vector'], bgr.inputs['Vector'])
bn.links.new(bgr.outputs['Fac'], bpw.inputs[0]); bn.links.new(bpw.outputs[0], bmu.inputs[0]); bn.links.new(bmu.outputs[0], bem.inputs['Strength'])
bn.links.new(bem.outputs[0], bo.inputs['Surface'])
backdrop.data.materials.append(bg_m); backdrop.location = (CX, 8, 0.4); backdrop.rotation_euler = (math.radians(90), 0, 0)
sweep = look_light('C_Sweep', (CX - 3, -2.0, 1.2), (CX, 0, 0), 0.15, 260, size_y=6)
keys(sweep, 'location', [(172, (CX - 3, -2.0, 1.2)), (205, (CX + 3, -2.0, 1.2))], interp='SINE', easing='EASE_IN_OUT')
look_light('C_Rim', (CX + 0.4, 3.0, 1.4), (CX, 0, 0), 3.0, 420, color=EMBER)
camC = Camera(lens=50, fstop=2.4)
camC.key(145, (CX + 0.2, -5.6, 0.35), (CX, 0, 0.12), (CX, 0, 0))
camC.key(216, (CX - 0.1, -4.8, 0.25), (CX, 0, 0.1), (CX, 0, 0))
camC.smooth(); camC.bind(145)
render(os.path.join(HERE, 'frames_s3'))
