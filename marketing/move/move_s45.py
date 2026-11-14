"""THE MOVE, shots 4–5 (15–25 s, frames 451–750).

  451–600  the reveal: the real NEXT portfolio page (Portfolio value $11,432.00; Total return +14.3%,
           $1,432.00; "Paper trading — NEXT Credits have no real monetary value") as a monumental
           polished glass display. On the hit (frame 481) a blade of light sweeps across it, and a chrome
           +$1,432 materializes in front of it.
  601–750  the collapse: the display, the figure, the chart and its bars are pulled into one point, and
           the NEXT wordmark (chrome, the ember dot) forms there.

  blender-venv/bin/python move_s45.py -- --journey J.json --assets SCREENS [--preview] [--frames 451-750] [--out DIR]
"""
from world_move import *

END, REVEAL, COLLAPSE, LOGO = 750, 481, 601, 630
sc = init(END, samples=int(arg('--samples', '40')))
sc.frame_start = 451
sc.cycles.max_bounces = 6; sc.cycles.glossy_bounces = 3; sc.cycles.diffuse_bounces = 2; sc.cycles.sample_clamp_indirect = 6.0
sc.render.motion_blur_shutter = 0.4
world_dark(sc)
M = materials(); build_floor(); monos = build_monoliths(M)
ch = Chart(area_gain=0.5); ch.reveal(N - 1); ch.head_e.inputs['Strength'].default_value = 30.0

# ---------------------------------------------------------------- the glass display: the real portfolio page
img = load_image(S_('m11-portfolio.png'))
DW = 2.5; DH = DW * img.size[1] / img.size[0]; DC = Vector((0.0, 1.6, 0.55 + DH / 2))
dm = bpy.data.materials.new('DisplayFace'); dm.use_nodes = True; nt = dm.node_tree; b = nt.nodes['Principled BSDF']
tc = nt.nodes.new('ShaderNodeTexCoord'); tex = nt.nodes.new('ShaderNodeTexImage'); tex.image = img; tex.extension = 'CLIP'; tex.interpolation = 'Cubic'
nt.links.new(tc.outputs['UV'], tex.inputs['Vector'])
b.inputs['Base Color'].default_value = (0, 0, 0, 1); b.inputs['Roughness'].default_value = 0.03; b.inputs['Coat Weight'].default_value = 1.0
nt.links.new(tex.outputs['Color'], b.inputs['Emission Color']); b.inputs['Emission Strength'].default_value = 1.15
face = rounded_mesh('DisplayFace', DW, DH, 0.16, mat=dm)
glass = principled('DisplayGlass', (0.01, 0.01, 0.012), rough=0.02, transmission=1.0, ior=1.5)
slab = rounded_slab('DisplaySlab', DW + 0.12, DH + 0.12, 0.2, depth=0.06, bevel=0.03, mat=glass)
rim = rounded_slab('DisplayRim', DW + 0.2, DH + 0.2, 0.24, depth=0.03, bevel=0.012, mat=M['chrome'])
disp = link(bpy.data.objects.new('Display', None)); disp.location = DC
for ob, z in ((rim, -0.07), (slab, 0.0), (face, 0.065)):
    ob.parent = disp; ob.rotation_euler = (math.radians(90), 0, 0); ob.location = (0, -z, 0)
keys(disp, 'location', [(451, tuple(DC + Vector((0, 0.8, -0.9)))), (472, tuple(DC)), (COLLAPSE, tuple(DC + Vector((0, 0, 0.12))))], interp='BEZIER')
keys(disp, 'rotation_euler', [(451, (0, 0, math.radians(-9))), (476, (0, 0, math.radians(1.5))), (COLLAPSE, (0, 0, math.radians(-3)))], interp='BEZIER')
# the chrome figure in front of it, from the reveal
fig, fig_face = chrome_text('Figure', money(PNL[-1]), 0.9, [M['chrome'], M['dark_chrome']],
                            face_mats=[emissive('FigFace', (1.0, 0.94, 0.86), 1.8)[0], emissive('FigSign', EMBER_HOT, 2.6)[0]])
for ob in (fig, fig_face):
    for i, c in enumerate(ob.data.body_format): c.material_index = 1 if ob.data.body[i] in '+$' else 0
bpy.context.view_layer.update()
w_ = max(v[0] for v in fig.bound_box) - min(v[0] for v in fig.bound_box); s_ = 2.0 / w_
fig.scale = (s_, s_, s_); FIG = Vector((0.0, -1.1, 1.45))
keys(fig, 'location', [(REVEAL - 3, tuple(FIG + Vector((0, 1.2, -0.25)))), (REVEAL + 3, tuple(FIG)), (COLLAPSE, tuple(FIG + Vector((0, 0, 0.06))))], interp='BEZIER')
keys(fig, 'scale', [(REVEAL - 3, (s_ * 0.6,) * 3), (REVEAL + 2, (s_ * 1.04,) * 3), (REVEAL + 8, (s_,) * 3)], interp='BEZIER')
visible(fig, [(REVEAL - 3, END)]); visible(fig_face, [(REVEAL - 3, END)])

# ---------------------------------------------------------------- light: a blade of light sweeps the glass on the hit
base_lights(key=700, rim=0.9)
blade = area('Blade', (-4.0, -2.2, 4.2), (math.radians(90), 0, 0), 0.25, 0.0, (1.0, 0.95, 0.88), size_y=9.0)
keys(blade, 'location', [(REVEAL - 4, (-4.0, -2.2, 4.2)), (REVEAL + 18, (4.0, -2.2, 4.2))], interp='SINE')
blade.data.energy = 0.0; blade.data.keyframe_insert('energy', frame=REVEAL - 5)
blade.data.energy = 900.0; blade.data.keyframe_insert('energy', frame=REVEAL); blade.data.keyframe_insert('energy', frame=REVEAL + 14)
blade.data.energy = 0.0; blade.data.keyframe_insert('energy', frame=REVEAL + 20)
look_light('DisplayKey', (-2.5, -5.5, 6.5), tuple(DC), 2.5, 260, (1.0, 0.96, 0.92), size_y=0.8)

# ---------------------------------------------------------------- the collapse and the wordmark
CORE = Vector((0.0, 0.6, 3.1))
pivot = link(bpy.data.objects.new('Pivot', None)); pivot.location = CORE
bpy.context.view_layer.update()
for ob in [disp, fig] + ch.objects() + monos:
    if ob.parent is None:
        mw = ob.matrix_world.copy(); ob.parent = pivot; ob.matrix_parent_inverse = pivot.matrix_world.inverted()
keys(pivot, 'scale', [(COLLAPSE, (1, 1, 1)), (LOGO - 4, (0.02, 0.02, 0.02))], interp='EXPO', easing='EASE_IN')
keys(pivot, 'rotation_euler', [(COLLAPSE, (0, 0, 0)), (LOGO - 4, (0, 0, math.radians(35)))], interp='EXPO', easing='EASE_IN')
for ob in pivot.children_recursive: visible(ob, [(451, LOGO - 3)])
flash_m, flash_e = glow_material('Flash', (1.0, 0.7, 0.45), 0.0)
bpy.ops.mesh.primitive_uv_sphere_add(radius=0.5, segments=32, ring_count=16, location=CORE); flash = bpy.context.active_object; flash.data.materials.append(flash_m)
key_val = lambda sock_, pairs: [(sock_.__setattr__('default_value', v), sock_.keyframe_insert('default_value', frame=f)) for f, v in pairs]
key_val(flash_e.inputs['Strength'], [(LOGO - 8, 0.0), (LOGO - 3, 40.0), (LOGO + 4, 0.0)])
keys(flash, 'scale', [(LOGO - 8, (0.1,) * 3), (LOGO - 3, (1.2,) * 3), (LOGO + 4, (3.0,) * 3)])
visible(flash, [(LOGO - 8, LOGO + 4)])
# NEXT: chrome Bricolage letters with a lit face, and the ember dot
LOGO_C = Vector((-0.06, 0.6, 3.1))
word, word_face = chrome_text('NEXT', 'NEXT', 1.0, [M['chrome']], extrude=0.14, bevel=0.016,
                              face_mats=[emissive('NextFace', (1.0, 0.95, 0.9), 1.4)[0]])
bpy.context.view_layer.update()
ww = max(v[0] for v in word.bound_box) - min(v[0] for v in word.bound_box); ws = 1.35 / ww
word.location = LOGO_C
keys(word, 'scale', [(LOGO - 4, (ws * 0.2,) * 3), (LOGO + 3, (ws * 1.03,) * 3), (LOGO + 10, (ws,) * 3), (END, (ws * 1.02,) * 3)], interp='BEZIER')
visible(word, [(LOGO - 4, END + 1)]); visible(word_face, [(LOGO - 4, END + 1)])
dot_m, dot_e = emissive('NextDot', EMBER, 9.0)
bpy.ops.mesh.primitive_uv_sphere_add(radius=0.065, segments=32, ring_count=16); dot = bpy.context.active_object; dot.data.materials.append(dot_m)
keys(dot, 'scale', [(LOGO - 1, (0.0,) * 3), (LOGO, (1.0,) * 3)])
DOT = LOGO_C + Vector((1.35 / 2 + 0.1, -0.05, -0.17))
keys(dot, 'location', [(LOGO, tuple(CORE)), (LOGO + 9, tuple(DOT))], interp='BEZIER'); visible(dot, [(LOGO, END + 1)])
dl = bpy.data.lights.new('DotLight', 'POINT'); dl.energy = 140; dl.color = EMBER; dl.shadow_soft_size = 0.2
dlo = link(bpy.data.objects.new('DotLight', dl)); dlo.parent = dot
dl.energy = 0.0; dl.keyframe_insert('energy', frame=LOGO - 1); dl.energy = 140.0; dl.keyframe_insert('energy', frame=LOGO + 4)
look_light('LogoTop', (0, -2.5, 7.5), tuple(LOGO_C), 4.0, 380, (1.0, 0.96, 0.92), size_y=0.8)
finish_lights()
for nm in ('KeyTop', 'DisplayKey', 'LogoTop', 'CoolFill'): bpy.data.objects[nm].visible_glossy = False   # no hard softbox shapes in the glass

# ---------------------------------------------------------------- camera
cam = Camera(lens=28, fstop=4.0)
cam.key(451, (-1.6, -7.6, 1.15), tuple(DC + Vector((0, 0, -0.6))), tuple(DC), 4.0, 28)
cam.key(REVEAL, (-0.6, -7.2, 1.3), tuple(DC + Vector((0, 0, -0.9))), tuple(FIG))
cam.key(560, (0.4, -6.6, 1.45), tuple(DC + Vector((0, 0, -1.0))), tuple(FIG))
cam.key(COLLAPSE, (0.6, -6.4, 1.55), tuple(DC + Vector((0, 0, -1.0))), tuple(FIG))
cam.key(LOGO, (0.15, -6.2, 2.4), tuple(LOGO_C + Vector((0.06, 0, 0.35))), tuple(LOGO_C), 4.0, 34)
cam.key(END, (0.05, -5.6, 2.6), tuple(LOGO_C + Vector((0.06, 0, 0.35))), tuple(LOGO_C))
cam.smooth()
render(os.path.join(MHERE, 'frames', 's45'))
