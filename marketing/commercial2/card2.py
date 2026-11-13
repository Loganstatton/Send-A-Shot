"""The Founding Believer / Backer #1 card, exactly as finished in Ad #1 v2.1
(card-hero.png from ../commercial/make_card.py: the same design), lifted into a
function for Ad #2, plus reflective foil lettering: the card's bright lettering
and "#1" are slightly metallic so light sweeps glint off them.
"""
import math, os, sys
HERE = os.path.dirname(os.path.abspath(__file__))
for p in (HERE, os.path.join(HERE, '..', 'commercial')):
    if p not in sys.path: sys.path.insert(0, p)
from next3d import *

def build_card(path, emission_keys, shimmer_frames=306):
    """Returns (root, tilt, face, CW, CH). Root's local -Y faces the camera."""
    # ---------------------------------------------------------------- the card
    img = load_image(path)
    CW = 0.9; CH = CW * img.size[1] / img.size[0]
    root = link(bpy.data.objects.new('CardRoot', None))
    tilt = link(bpy.data.objects.new('CardTilt', None)); tilt.parent = root; tilt.rotation_euler = (math.radians(90), 0, 0)
    chrome = principled('Chrome', (0.93, 0.9, 0.87), metallic=1.0, rough=0.11, aniso=0.4)
    THK, BEV = 0.019, 0.01            # half-thickness of the slab core + rounded polished edge
    body = rounded_slab('CardBody', CW + 0.034, CH + 0.034, 0.075, depth=THK, bevel=BEV, mat=chrome); body.parent = tilt
    body.data.bevel_resolution = 6
    face_m = bpy.data.materials.new('CardFace'); face_m.use_nodes = True
    fn = face_m.node_tree; fb = fn.nodes['Principled BSDF']
    ftc = fn.nodes.new('ShaderNodeTexCoord'); ftex = fn.nodes.new('ShaderNodeTexImage'); ftex.image = img; ftex.extension = 'CLIP'; ftex.interpolation = 'Cubic'
    fn.links.new(ftc.outputs['UV'], ftex.inputs['Vector'])
    hlw = fn.nodes.new('ShaderNodeLayerWeight'); hlw.inputs['Blend'].default_value = 0.45
    hnz = fn.nodes.new('ShaderNodeTexNoise'); hnz.noise_dimensions = '4D'; hnz.inputs['Scale'].default_value = 2.2; hnz.inputs['Detail'].default_value = 1.0
    fn.links.new(ftc.outputs['UV'], hnz.inputs['Vector'])
    for f_, w_ in ((1, 0.0), (shimmer_frames, 1.6)):
        hnz.inputs['W'].default_value = w_; hnz.inputs['W'].keyframe_insert('default_value', frame=f_)
    hsum = fn.nodes.new('ShaderNodeMath'); hsum.operation = 'ADD'
    fn.links.new(hlw.outputs['Facing'], hsum.inputs[0]); fn.links.new(hnz.outputs['Fac'], hsum.inputs[1])
    hfr = fn.nodes.new('ShaderNodeMath'); hfr.operation = 'FRACT'; fn.links.new(hsum.outputs[0], hfr.inputs[0])
    hramp = fn.nodes.new('ShaderNodeValToRGB'); he_ = hramp.color_ramp.elements
    he_[0].position, he_[0].color = 0.0, (1.0, 0.35, 0.25, 1); he_[1].position, he_[1].color = 1.0, (1.0, 0.35, 0.25, 1)
    for pos, col in ((0.2, (1.0, 0.8, 0.3, 1)), (0.4, (0.45, 1.0, 0.6, 1)), (0.6, (0.35, 0.7, 1.0, 1)), (0.8, (0.85, 0.45, 1.0, 1))):
        e_ = he_.new(pos); e_.color = col
    fn.links.new(hfr.outputs[0], hramp.inputs['Fac'])
    hlum = fn.nodes.new('ShaderNodeRGBToBW'); fn.links.new(ftex.outputs['Color'], hlum.inputs[0])
    hmask = fn.nodes.new('ShaderNodeMath'); hmask.operation = 'POWER'; hmask.inputs[1].default_value = 3.0
    hinv = fn.nodes.new('ShaderNodeMath'); hinv.operation = 'SUBTRACT'; hinv.inputs[0].default_value = 1.0
    fn.links.new(hlum.outputs[0], hinv.inputs[1]); fn.links.new(hinv.outputs[0], hmask.inputs[0])
    hbn = fn.nodes.new('ShaderNodeTexNoise'); hbn.noise_dimensions = '4D'; hbn.inputs['Scale'].default_value = 1.6; hbn.inputs['Detail'].default_value = 0.0
    hmap = fn.nodes.new('ShaderNodeMapping'); hmap.inputs['Scale'].default_value = (1.0, 0.18, 1.0); hmap.inputs['Rotation'].default_value = (0, 0, math.radians(32))
    fn.links.new(ftc.outputs['UV'], hmap.inputs['Vector']); fn.links.new(hmap.outputs['Vector'], hbn.inputs['Vector'])
    fn.links.new(hlw.outputs['Facing'], hbn.inputs['W'])                 # the bands slide as the card turns
    hband = fn.nodes.new('ShaderNodeMapRange'); hband.inputs['From Min'].default_value = 0.58; hband.inputs['From Max'].default_value = 0.72
    fn.links.new(hbn.outputs['Fac'], hband.inputs['Value'])
    hbm = fn.nodes.new('ShaderNodeMath'); hbm.operation = 'MULTIPLY'; fn.links.new(hmask.outputs[0], hbm.inputs[0]); fn.links.new(hband.outputs['Result'], hbm.inputs[1])
    hamt = fn.nodes.new('ShaderNodeMath'); hamt.operation = 'MULTIPLY'; hamt.inputs[1].default_value = 0.022   # subtle
    fn.links.new(hbm.outputs[0], hamt.inputs[0])
    hmix = fn.nodes.new('ShaderNodeMix'); hmix.data_type = 'RGBA'; hmix.blend_type = 'ADD'
    fn.links.new(hamt.outputs[0], sock(hmix.inputs, 'Factor', 'VALUE'))
    fn.links.new(ftex.outputs['Color'], sock(hmix.inputs, 'A', 'RGBA')); fn.links.new(hramp.outputs['Color'], sock(hmix.inputs, 'B', 'RGBA'))
    fn.links.new(sock(hmix.outputs, 'Result', 'RGBA'), fb.inputs['Emission Color'])
    fb.inputs['Base Color'].default_value = (0, 0, 0, 1); fb.inputs['Roughness'].default_value = 0.05
    fb.inputs['Coat Weight'].default_value = 1.0; fb.inputs['Coat Roughness'].default_value = 0.02
    for f, v in emission_keys:
        fb.inputs['Emission Strength'].default_value = v; fb.inputs['Emission Strength'].keyframe_insert('default_value', frame=f)
    face = rounded_mesh('CardFace', CW, CH, 0.06, mat=face_m); face.parent = tilt; face.location.z = THK + BEV + 0.0012
    back = rounded_mesh('CardBack', CW, CH, 0.06, mat=principled('CardBackM', (0.02, 0.012, 0.01), rough=0.25, coat=1.0))
    back.parent = tilt; back.location.z = -(THK + BEV + 0.0012); back.rotation_euler.y = math.pi
    # foil: where the lettering is bright, the face turns slightly metallic (catches the lights)
    flum = fn.nodes.new('ShaderNodeRGBToBW'); fn.links.new(ftex.outputs['Color'], flum.inputs[0])
    fmr = fn.nodes.new('ShaderNodeMapRange'); fmr.inputs['From Min'].default_value = 0.32; fmr.inputs['From Max'].default_value = 0.7
    fmr.inputs['To Max'].default_value = 0.85; fn.links.new(flum.outputs[0], fmr.inputs['Value'])
    fn.links.new(fmr.outputs['Result'], fb.inputs['Metallic'])
    fn.links.new(ftex.outputs['Color'], fb.inputs['Base Color'])
    fr_ = fn.nodes.new('ShaderNodeMapRange'); fr_.inputs['To Min'].default_value = 0.05; fr_.inputs['To Max'].default_value = 0.22
    fn.links.new(fmr.outputs['Result'], fr_.inputs['Value']); fn.links.new(fr_.outputs['Result'], fb.inputs['Roughness'])
    return root, tilt, face, CW, CH
