"""NEXT commercial — opening scene (0–3 s): chrome vinyl → shatter → particle chart.

Run:  blender-venv/bin/python opener.py -- [--preview] [--frames a-b] [--out DIR] [--save scene.blend]
Renders linear EXR frames (bloom, grade and type are added in post.py).
"""
import bpy, bmesh, math, random, sys, os
from mathutils import Vector, Matrix, Euler

argv = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []
PREVIEW = '--preview' in argv
def arg(name, default=None):
    return argv[argv.index(name) + 1] if name in argv else default
OUT = arg('--out', os.path.join(os.path.dirname(os.path.abspath(__file__)), 'frames'))
FRAMES = arg('--frames', '1-90')
HERE = os.path.dirname(os.path.abspath(__file__))
FONT = os.path.join(HERE, 'fonts', 'BricolageGrotesque-ExtraBold.ttf')

random.seed(7)
EMBER = (0.9865, 0.139, 0.057)          # brand ember #FD6844, linear
EMBER_HOT = (1.0, 0.42, 0.16)
INK = (0.0051, 0.0029, 0.0023)          # brand background #100908, linear
F_SHATTER = 37                          # frame the record breaks (1.2 s at 30 fps)

# ---------------------------------------------------------------- scene
bpy.ops.wm.read_factory_settings(use_empty=True)
sc = bpy.context.scene
sc.render.fps = 30
sc.frame_start, sc.frame_end = 1, 90
sc.render.engine = 'CYCLES'
cy = sc.cycles
cy.device = 'CPU'
cy.samples = 24 if PREVIEW else 40
cy.adaptive_threshold = 0.03
cy.use_denoising = True
cy.denoiser = 'OPENIMAGEDENOISE'
cy.max_bounces, cy.diffuse_bounces, cy.glossy_bounces, cy.transmission_bounces = 6, 2, 4, 2
cy.caustics_reflective = cy.caustics_refractive = False
sc.render.resolution_x, sc.render.resolution_y = 1080, 1920
sc.render.resolution_percentage = 35 if PREVIEW else 100
sc.render.use_motion_blur = True
sc.render.motion_blur_shutter = 0.45
sc.view_settings.view_transform = 'AgX'
sc.view_settings.look = 'None'
sc.render.image_settings.file_format = 'HDR'
sc.render.film_transparent = False

world = bpy.data.worlds.new('World'); sc.world = world
world.use_nodes = True
world.node_tree.nodes['Background'].inputs['Color'].default_value = (0.0004, 0.0003, 0.0003, 1)
world.node_tree.nodes['Background'].inputs['Strength'].default_value = 1.0

def link(o):
    sc.collection.objects.link(o); return o

def key(obj, path, frame, value, interp='BEZIER', easing='AUTO', index=-1):
    setattr(obj, path, value) if not isinstance(obj, bpy.types.bpy_struct) or True else None
    obj.keyframe_insert(data_path=path, frame=frame, index=index)
    ad = obj.animation_data if hasattr(obj, 'animation_data') else obj.id_data.animation_data
    return ad

def set_interp(id_data, interp='BEZIER', easing='AUTO'):
    ad = id_data.animation_data
    if not ad or not ad.action: return
    for fc in iter_fcurves(ad.action):
        for kp in fc.keyframe_points:
            kp.interpolation = interp; kp.easing = easing

def iter_fcurves(action):
    # Blender 5 "layered" actions keep F-curves in channelbags.
    if hasattr(action, 'fcurves') and len(getattr(action, 'fcurves', [])):
        yield from action.fcurves; return
    for layer in getattr(action, 'layers', []):
        for strip in layer.strips:
            for bag in strip.channelbags:
                yield from bag.fcurves

# ---------------------------------------------------------------- materials
def principled(name, base, metallic=0.0, rough=0.4, aniso=0.0, emission=None, estr=0.0, alpha=1.0, coat=0.0):
    m = bpy.data.materials.new(name); m.use_nodes = True
    nt = m.node_tree; b = nt.nodes['Principled BSDF']
    b.inputs['Base Color'].default_value = (*base, 1)
    b.inputs['Metallic'].default_value = metallic
    b.inputs['Roughness'].default_value = rough
    if aniso: b.inputs['Anisotropic'].default_value = aniso
    if coat: b.inputs['Coat Weight'].default_value = coat
    if emission:
        b.inputs['Emission Color'].default_value = (*emission, 1)
        b.inputs['Emission Strength'].default_value = estr
    b.inputs['Alpha'].default_value = alpha
    return m, nt, b

# Chrome vinyl: polished metal with radial anisotropy (the streaked highlight
# real records have) and fine concentric grooves as bump.
chrome, nt, b = principled('Chrome', (0.92, 0.92, 0.95), metallic=1.0, rough=0.16, aniso=0.85)
tan = nt.nodes.new('ShaderNodeTangent'); tan.direction_type = 'RADIAL'; tan.axis = 'Z'
nt.links.new(tan.outputs['Tangent'], b.inputs['Tangent'])
tc = nt.nodes.new('ShaderNodeTexCoord')
wave = nt.nodes.new('ShaderNodeTexWave'); wave.wave_type = 'RINGS'; wave.rings_direction = 'Z'
wave.inputs['Scale'].default_value = 40.0; wave.inputs['Distortion'].default_value = 0.4; wave.inputs['Detail'].default_value = 2
nt.links.new(tc.outputs['Object'], wave.inputs['Vector'])
bump = nt.nodes.new('ShaderNodeBump'); bump.inputs['Strength'].default_value = 0.12; bump.inputs['Distance'].default_value = 0.002
nt.links.new(wave.outputs['Fac'], bump.inputs['Height']); nt.links.new(bump.outputs['Normal'], b.inputs['Normal'])
# Darker grooved band vs. bright run-out band: vary roughness by radius.
grad = nt.nodes.new('ShaderNodeTexGradient'); grad.gradient_type = 'SPHERICAL'
nt.links.new(tc.outputs['Object'], grad.inputs['Vector'])
ramp = nt.nodes.new('ShaderNodeValToRGB')
ramp.color_ramp.elements[0].position = 0.18; ramp.color_ramp.elements[0].color = (0.3, 0.3, 0.3, 1)
ramp.color_ramp.elements[1].position = 0.24; ramp.color_ramp.elements[1].color = (0.12, 0.12, 0.12, 1)
mapr = nt.nodes.new('ShaderNodeMapping'); mapr.inputs['Scale'].default_value = (0.65, 0.65, 0.65)
nt.links.new(tc.outputs['Object'], mapr.inputs['Vector']); nt.links.new(mapr.outputs['Vector'], grad.inputs['Vector'])
nt.links.new(grad.outputs['Fac'], ramp.inputs['Fac']); nt.links.new(ramp.outputs['Color'], b.inputs['Roughness'])

label_mat, _, _ = principled('Label', EMBER, rough=0.35, coat=0.6, emission=EMBER, estr=0.6)
ink_mat, _, _ = principled('Ink', INK, rough=0.5)
core_mat, cnt, cb = principled('Core', (0, 0, 0), emission=EMBER_HOT, estr=0.0)

glow_line, gnt, gb = principled('ChartLine', (0, 0, 0), emission=EMBER_HOT, estr=18.0)
bar_mat, bnt, bb = principled('Bars', (0.02, 0.01, 0.01), rough=0.25, emission=EMBER, estr=1.6, alpha=1.0)
floor_mat, fnt, fb = principled('Floor', (0.006, 0.005, 0.005), rough=0.22, coat=0.5)

# Particle material: ember→white-hot by per-point random, strong emission.
pmat = bpy.data.materials.new('Particles'); pmat.use_nodes = True
pn = pmat.node_tree.nodes; pl = pmat.node_tree.links
pn.clear()
attr = pn.new('ShaderNodeAttribute'); attr.attribute_name = 'rnd'
pr = pn.new('ShaderNodeValToRGB')
pr.color_ramp.elements[0].color = (*EMBER, 1); pr.color_ramp.elements[1].color = (1.0, 0.75, 0.45, 1)
pr.color_ramp.elements[1].position = 0.95
em = pn.new('ShaderNodeEmission'); out = pn.new('ShaderNodeOutputMaterial')
mul = pn.new('ShaderNodeMath'); mul.operation = 'MULTIPLY_ADD'; mul.inputs[1].default_value = 14.0; mul.inputs[2].default_value = 6.0
pl.new(attr.outputs['Fac'], pr.inputs['Fac']); pl.new(pr.outputs['Color'], em.inputs['Color'])
pl.new(attr.outputs['Fac'], mul.inputs[0]); pl.new(mul.outputs[0], em.inputs['Strength'])
pl.new(em.outputs[0], out.inputs['Surface'])

# ---------------------------------------------------------------- record
R_OUT, R_LABEL, R_HOLE, THICK, GAP = 1.5, 0.46, 0.035, 0.035, 0.002
pivot = link(bpy.data.objects.new('RecordPivot', None))     # tilt
pivot.rotation_euler = (math.radians(70), 0, math.radians(-10))
spinner = link(bpy.data.objects.new('Spinner', None)); spinner.parent = pivot

def wedge(r0, r1, a0, a1, z0, z1, segs=6):
    bm = bmesh.new()
    rings = []
    for z in (z0, z1):
        ring = []
        for i in range(segs + 1):
            a = a0 + (a1 - a0) * i / segs
            ring.append((bm.verts.new((r0 * math.cos(a), r0 * math.sin(a), z)), bm.verts.new((r1 * math.cos(a), r1 * math.sin(a), z))))
        rings.append(ring)
    bot, top = rings
    for i in range(segs):
        bm.faces.new((top[i][0], top[i][1], top[i + 1][1], top[i + 1][0]))
        bm.faces.new((bot[i][0], bot[i + 1][0], bot[i + 1][1], bot[i][1]))
        bm.faces.new((bot[i][1], bot[i + 1][1], top[i + 1][1], top[i][1]))
        bm.faces.new((bot[i][0], top[i][0], top[i + 1][0], bot[i + 1][0]))
    bm.faces.new((bot[0][0], bot[0][1], top[0][1], top[0][0]))
    bm.faces.new((bot[segs][0], top[segs][0], top[segs][1], bot[segs][1]))
    return bm

shards = []
ring_edges = [R_LABEL + 0.02, 0.8, 1.15, R_OUT]
for ri in range(3):
    n = (18, 26, 34)[ri]
    jitter = [random.uniform(-0.35, 0.35) for _ in range(n)]
    for j in range(n):
        a0 = 2 * math.pi * (j + jitter[j] * 0.5) / n
        a1 = 2 * math.pi * (j + 1 + jitter[(j + 1) % n] * 0.5) / n
        r0, r1 = ring_edges[ri] + GAP, ring_edges[ri + 1] - (GAP if ri < 2 else 0)
        da = GAP / ((r0 + r1) / 2)
        bm = wedge(r0, r1, a0 + da, a1 - da, -THICK / 2, THICK / 2)
        me = bpy.data.meshes.new(f'shard{ri}_{j}'); bm.to_mesh(me); bm.free()
        for p in me.polygons: p.use_smooth = True
        ob = link(bpy.data.objects.new(me.name, me)); ob.data.materials.append(chrome); ob.parent = spinner
        mid = (a0 + a1) / 2; rm = (r0 + r1) / 2
        shards.append((ob, Vector((math.cos(mid), math.sin(mid), 0)), rm))

# Intact record with glowing fracture lines that appear just before the break.
intact_mat = chrome.copy(); intact_mat.name = 'ChromeIntact'
it = intact_mat.node_tree; ib = it.nodes['Principled BSDF']
itc = it.nodes.new('ShaderNodeTexCoord')
vor = it.nodes.new('ShaderNodeTexVoronoi'); vor.feature = 'DISTANCE_TO_EDGE'; vor.inputs['Scale'].default_value = 2.4
it.links.new(itc.outputs['Object'], vor.inputs['Vector'])
cr = it.nodes.new('ShaderNodeMapRange'); cr.inputs['From Min'].default_value = 0.0; cr.inputs['From Max'].default_value = 0.012
cr.inputs['To Min'].default_value = 1.0; cr.inputs['To Max'].default_value = 0.0
it.links.new(vor.outputs['Distance'], cr.inputs['Value'])
cstr = it.nodes.new('ShaderNodeMath'); cstr.operation = 'MULTIPLY'; it.links.new(cr.outputs['Result'], cstr.inputs[0])
ib.inputs['Emission Color'].default_value = (*EMBER_HOT, 1)
it.links.new(cstr.outputs[0], ib.inputs['Emission Strength'])
for f_, v_ in ((1, 0.0), (24, 0.0), (31, 3.0), (F_SHATTER - 1, 16.0)):
    cstr.inputs[1].default_value = v_; cstr.inputs[1].keyframe_insert('default_value', frame=f_)
bm = bmesh.new()
bmesh.ops.create_circle(bm, cap_ends=False, radius=R_OUT, segments=128)
outer = list(bm.verts)
bmesh.ops.create_circle(bm, cap_ends=False, radius=R_LABEL + 0.02, segments=128)
inner_v = [v for v in bm.verts if v not in outer]
bm.verts.ensure_lookup_table()
for i in range(128):
    bm.faces.new((outer[i], outer[(i + 1) % 128], inner_v[(i + 1) % 128], inner_v[i]))
geom = bmesh.ops.extrude_face_region(bm, geom=list(bm.faces))
for v in [e for e in geom['geom'] if isinstance(e, bmesh.types.BMVert)]: v.co.z += THICK
for v in bm.verts: v.co.z -= THICK / 2
bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
me = bpy.data.meshes.new('Intact'); bm.to_mesh(me); bm.free()
for p_ in me.polygons: p_.use_smooth = True
intact = link(bpy.data.objects.new('Intact', me)); intact.data.materials.append(intact_mat); intact.parent = spinner
def vis(ob, show_from=None, hide_from=None):
    for f_, hidden in ((1, show_from is not None), (show_from, False), (hide_from, True)):
        if f_ is None: continue
        ob.hide_render = hidden; ob.keyframe_insert('hide_render', frame=f_)
        ob.hide_viewport = hidden; ob.keyframe_insert('hide_viewport', frame=f_)
vis(intact, hide_from=F_SHATTER)
for ob_, _, _ in shards: vis(ob_, show_from=F_SHATTER)

# Label (one piece, shatters with the inner ring) and the NEXT wordmark on it.
bpy.ops.mesh.primitive_cylinder_add(vertices=96, radius=R_LABEL, depth=THICK + 0.004)
label = bpy.context.active_object; label.data.materials.append(label_mat); label.parent = spinner
bpy.ops.object.shade_flat()
bpy.ops.mesh.primitive_cylinder_add(vertices=48, radius=R_HOLE, depth=THICK + 0.02)
hole = bpy.context.active_object; hole.data.materials.append(ink_mat); hole.parent = spinner
font = bpy.data.fonts.load(FONT)
cu = bpy.data.curves.new('Wordmark', 'FONT'); cu.body = 'NEXT'; cu.font = font
cu.size = 0.2; cu.align_x = 'CENTER'; cu.align_y = 'CENTER'; cu.extrude = 0.0015
word = link(bpy.data.objects.new('Wordmark', cu)); word.data.materials.append(ink_mat)
word.parent = spinner; word.location = (-0.03, 0.17, THICK / 2 + 0.004)
dotc = bpy.data.curves.new('Dot', 'CURVE'); dotc.dimensions = '2D'
bpy.ops.mesh.primitive_cylinder_add(vertices=24, radius=0.018, depth=0.003, location=(0.21, 0.17, THICK / 2 + 0.004))
dot = bpy.context.active_object; dot.data.materials.append(ink_mat); dot.parent = spinner
# Glowing core between the shards: seams of light before the break.
bpy.ops.mesh.primitive_cylinder_add(vertices=96, radius=R_OUT - 0.02, depth=THICK * 0.6)
core = bpy.context.active_object; core.data.materials.append(core_mat); core.parent = spinner

# Spin: fast, constant, slowing slightly as it cracks.
spinner.rotation_euler = (0, 0, 0); spinner.keyframe_insert('rotation_euler', frame=1, index=2)
spinner.rotation_euler = (0, 0, -math.radians(360 * 1.15)); spinner.keyframe_insert('rotation_euler', frame=F_SHATTER, index=2)
spinner.rotation_euler = (0, 0, -math.radians(360 * 1.15 + 50)); spinner.keyframe_insert('rotation_euler', frame=F_SHATTER + 20, index=2)
set_interp(spinner, 'LINEAR')
# Core glow ramps up through the cracks, flashes, then is gone.
cs = cb.inputs['Emission Strength']
for f, v in ((1, 0.0), (24, 0.0), (33, 6.0), (F_SHATTER - 1, 30.0), (F_SHATTER, 120.0), (F_SHATTER + 2, 0.0)):
    cs.default_value = v; cs.keyframe_insert('default_value', frame=f)
for f, s in ((F_SHATTER, 1.0), (F_SHATTER + 2, 0.0)):
    core.scale = (s, s, s); core.keyframe_insert('scale', frame=f)

# Shards fly out toward camera, tumble and shrink away (they become particles).
cam_dir_local = Vector((0, 0, 1))   # disc normal faces the camera
inner = [label, hole, word, dot]
for ob, radial, rm in shards + [(o, Vector((0, 0, 0)), 0.2) for o in inner]:
    d = radial * random.uniform(0.9, 2.6) * (0.6 + rm * 0.5) + cam_dir_local * (random.uniform(0.6, 2.0) if rm > 0.3 else random.uniform(0.1, 0.4))
    dur = random.randint(16, 26)
    ob.keyframe_insert('location', frame=F_SHATTER)
    ob.keyframe_insert('rotation_euler', frame=F_SHATTER)
    ob.keyframe_insert('scale', frame=F_SHATTER)
    ob.location = ob.location + d
    ob.rotation_euler = Euler((random.uniform(-3, 3), random.uniform(-3, 3), random.uniform(-2, 2)))
    ob.keyframe_insert('location', frame=F_SHATTER + dur)
    ob.keyframe_insert('rotation_euler', frame=F_SHATTER + dur)
    ob.scale = (0.0, 0.0, 0.0); ob.keyframe_insert('scale', frame=F_SHATTER + dur)
    set_interp(ob, 'EXPO', 'EASE_OUT')

# ---------------------------------------------------------------- chart
# A rising line with real-looking dips; bars beneath; a glossy floor.
CH_W, CH_H, CH_BASE = 3.6, 4.4, -2.3
N = 64
vals, v = [], 0.0
for i in range(N):
    v += random.gauss(0.03, 0.09) + (0.09 if i > N * 0.72 else 0) - (0.12 if N * 0.45 < i < N * 0.52 else 0)
    vals.append(v)
lo, hi = min(vals), max(vals)
pts = [Vector((-CH_W / 2 + CH_W * i / (N - 1), 0.0, CH_BASE + 0.35 + (vals[i] - lo) / (hi - lo) * CH_H)) for i in range(N)]
crv = bpy.data.curves.new('ChartLine', 'CURVE'); crv.dimensions = '3D'
sp = crv.splines.new('POLY'); sp.points.add(N - 1)
for i, p in enumerate(pts): sp.points[i].co = (*p, 1)
crv.bevel_depth = 0.022; crv.bevel_resolution = 4
line = link(bpy.data.objects.new('ChartLine', crv)); line.data.materials.append(glow_line)
crv.bevel_factor_end = 0.0; crv.keyframe_insert('bevel_factor_end', frame=48)
crv.bevel_factor_end = 1.0; crv.keyframe_insert('bevel_factor_end', frame=80)
set_interp(crv, 'SINE', 'EASE_IN_OUT')

bars = []
NB = 22
for k in range(NB):
    i = int(k * (N - 1) / (NB - 1))
    h = pts[i].z - CH_BASE - 0.12
    bpy.ops.mesh.primitive_cube_add(size=1, location=(pts[i].x, 0.35, CH_BASE))
    bar = bpy.context.active_object; bar.data.materials.append(bar_mat)
    bar.scale = (0.07, 0.07, 0.0001); bar.location.z = CH_BASE
    f0 = 52 + int(26 * k / NB)
    for ff, hid in ((1, True), (f0, False)):
        bar.hide_render = hid; bar.keyframe_insert('hide_render', frame=ff)
    bar.keyframe_insert('scale', frame=f0); bar.keyframe_insert('location', frame=f0)
    bar.scale = (0.07, 0.07, h * 0.82); bar.location.z = CH_BASE + h * 0.41
    bar.keyframe_insert('scale', frame=f0 + 10); bar.keyframe_insert('location', frame=f0 + 10)
    set_interp(bar, 'BACK', 'EASE_OUT')
    bars.append((bar, h))

bpy.ops.mesh.primitive_plane_add(size=40, location=(0, 0, CH_BASE - 0.02))
floor = bpy.context.active_object; floor.data.materials.append(floor_mat)
# Faint grid lines on the floor (emission), fading with distance.
fnt_ = floor_mat.node_tree; fbsdf = fb
ftc = fnt_.nodes.new('ShaderNodeTexCoord'); fmap = fnt_.nodes.new('ShaderNodeMapping'); fmap.inputs['Scale'].default_value = (2.5, 2.5, 1)
fnt_.links.new(ftc.outputs['Object'], fmap.inputs['Vector'])
brick = fnt_.nodes.new('ShaderNodeTexBrick'); brick.inputs['Mortar Size'].default_value = 0.012; brick.offset = 0.0
brick.inputs['Color1'].default_value = (0, 0, 0, 1); brick.inputs['Color2'].default_value = (0, 0, 0, 1); brick.inputs['Mortar'].default_value = (1, 1, 1, 1)
brick.inputs['Brick Width'].default_value = 1.0; brick.inputs['Row Height'].default_value = 1.0
fnt_.links.new(fmap.outputs['Vector'], brick.inputs['Vector'])
fgrad = fnt_.nodes.new('ShaderNodeTexGradient'); fgrad.gradient_type = 'SPHERICAL'
fmap2 = fnt_.nodes.new('ShaderNodeMapping'); fmap2.inputs['Scale'].default_value = (0.16, 0.16, 0.16)
fnt_.links.new(ftc.outputs['Object'], fmap2.inputs['Vector']); fnt_.links.new(fmap2.outputs['Vector'], fgrad.inputs['Vector'])
fmul = fnt_.nodes.new('ShaderNodeMath'); fmul.operation = 'MULTIPLY'
fnt_.links.new(brick.outputs['Fac'], fmul.inputs[0]); fnt_.links.new(fgrad.outputs['Fac'], fmul.inputs[1])
fstr = fnt_.nodes.new('ShaderNodeMath'); fstr.operation = 'MULTIPLY'; fnt_.links.new(fmul.outputs[0], fstr.inputs[0])
fstr.inputs[1].default_value = 0.0
fstr.inputs[1].keyframe_insert('default_value', frame=44)
fstr.inputs[1].default_value = 0.9
fstr.inputs[1].keyframe_insert('default_value', frame=70)
fbsdf.inputs['Emission Color'].default_value = (*EMBER, 1)
fnt_.links.new(fstr.outputs[0], fbsdf.inputs['Emission Strength'])

# ---------------------------------------------------------------- particles
# Each point starts on the record's surface, bursts outward when it
# shatters, then streams (left to right, like the chart being drawn) into a
# place on the chart line or a bar. Everything is computed per point in
# Geometry Nodes from stored attributes, so motion blur stays correct.
NP = 4000 if PREVIEW else 9000
bpy.context.view_layer.update()
disc_mat = pivot.matrix_world.copy()
starts, ends, bursts, rnds, delays = [], [], [], [], []
seg_len = [(pts[i + 1] - pts[i]).length for i in range(N - 1)]
tot = sum(seg_len)
for k in range(NP):
    r = math.sqrt(random.uniform(R_HOLE ** 2 * 4, R_OUT ** 2)); a = random.uniform(0, 2 * math.pi)
    local = Vector((r * math.cos(a), r * math.sin(a), random.uniform(-THICK, THICK)))
    s = disc_mat @ local
    radial = (disc_mat.to_3x3() @ Vector((math.cos(a), math.sin(a), 0))).normalized()
    normal = (disc_mat.to_3x3() @ Vector((0, 0, 1))).normalized()
    burst = radial * random.uniform(0.35, 1.3) + normal * random.uniform(0.05, 0.45) + Vector([random.gauss(0, 0.12) for _ in range(3)])
    roll = random.random()
    if roll < 0.74:            # along the line
        d = random.uniform(0, tot); i = 0
        while i < N - 2 and d > seg_len[i]: d -= seg_len[i]; i += 1
        e = pts[i].lerp(pts[i + 1], d / seg_len[i]) + Vector([random.gauss(0, 0.018) for _ in range(3)])
    elif roll < 0.95:          # bar edges
        bar, h = random.choice(bars)
        e = Vector((bar.location.x + random.choice((-1, 1)) * 0.035, 0.35 + random.choice((-1, 1)) * 0.035, CH_BASE + random.uniform(0, h * 0.82)))
    else:                      # dust drifting around the chart
        e = Vector((random.uniform(-2.4, 2.4), random.uniform(-1.2, 1.6), random.uniform(CH_BASE + 0.2, CH_BASE + CH_H + 0.8)))
    xn = (e.x + CH_W / 2) / CH_W
    starts.append(s); ends.append(e); bursts.append(burst); rnds.append(random.random())
    delays.append(F_SHATTER + 1 + 26 * max(0.0, min(1.0, xn)) + random.uniform(0, 4))

pm = bpy.data.meshes.new('Particles'); pm.vertices.add(NP)
pm.vertices.foreach_set('co', [c for v in starts for c in v])
for name, data, kind in (('start', starts, 'FLOAT_VECTOR'), ('target', ends, 'FLOAT_VECTOR'), ('burst', bursts, 'FLOAT_VECTOR'),
                         ('rnd', rnds, 'FLOAT'), ('delay', delays, 'FLOAT')):
    at = pm.attributes.new(name, kind, 'POINT')
    at.data.foreach_set('vector' if kind == 'FLOAT_VECTOR' else 'value', [c for v in data for c in v] if kind == 'FLOAT_VECTOR' else data)
parts = link(bpy.data.objects.new('Particles', pm))

ng = bpy.data.node_groups.new('ParticleFlow', 'GeometryNodeTree')
ng.interface.new_socket('Geometry', in_out='INPUT', socket_type='NodeSocketGeometry')
ng.interface.new_socket('Geometry', in_out='OUTPUT', socket_type='NodeSocketGeometry')
N_ = ng.nodes; L_ = ng.links
gi = N_.new('NodeGroupInput'); go = N_.new('NodeGroupOutput')
t = N_.new('GeometryNodeInputSceneTime')
def named(name, dtype):
    n = N_.new('GeometryNodeInputNamedAttribute'); n.data_type = dtype; n.inputs['Name'].default_value = name; return n
a_start, a_target, a_burst = named('start', 'FLOAT_VECTOR'), named('target', 'FLOAT_VECTOR'), named('burst', 'FLOAT_VECTOR')
a_rnd, a_delay = named('rnd', 'FLOAT'), named('delay', 'FLOAT')
def math_(op, a=None, b=None, c=None):
    n = N_.new('ShaderNodeMath'); n.operation = op
    for i, x in enumerate((a, b, c)):
        if x is None: continue
        if isinstance(x, (int, float)): n.inputs[i].default_value = x
        else: L_.new(x, n.inputs[i])
    return n.outputs[0]
frame = t.outputs['Frame']
# u: 0→1 over the flight (starts at the shatter, lasts ~delay-shatter+14 frames)
flight_start = F_SHATTER
dur = math_('SUBTRACT', math_('ADD', a_delay.outputs['Attribute'], 14.0), float(flight_start))
u = math_('DIVIDE', math_('SUBTRACT', frame, float(flight_start)), dur)
u = math_('MINIMUM', math_('MAXIMUM', u, 0.0), 1.0)
# smootherstep for position, sin-arc for the burst
ease = math_('MULTIPLY', math_('MULTIPLY', u, u), math_('SUBTRACT', 3.0, math_('MULTIPLY', u, 2.0)))
arc = math_('SINE', math_('MULTIPLY', math_('POWER', u, 0.55), math.pi))
mix = N_.new('ShaderNodeMix'); mix.data_type = 'VECTOR'
L_.new(ease, mix.inputs['Factor']); L_.new(a_start.outputs['Attribute'], mix.inputs['A']); L_.new(a_target.outputs['Attribute'], mix.inputs['B'])
sc_b = N_.new('ShaderNodeVectorMath'); sc_b.operation = 'SCALE'
L_.new(a_burst.outputs['Attribute'], sc_b.inputs[0]); L_.new(arc, sc_b.inputs['Scale'])
# swirl: curl-ish noise while in flight
noise = N_.new('ShaderNodeTexNoise'); noise.noise_dimensions = '4D'; noise.inputs['Scale'].default_value = 0.28
L_.new(a_start.outputs['Attribute'], noise.inputs['Vector']); L_.new(math_('MULTIPLY', frame, 0.03), noise.inputs['W'])
nsub = N_.new('ShaderNodeVectorMath'); nsub.operation = 'SUBTRACT'; L_.new(noise.outputs['Color'], nsub.inputs[0]); nsub.inputs[1].default_value = (0.5, 0.5, 0.5)
nsc = N_.new('ShaderNodeVectorMath'); nsc.operation = 'SCALE'; L_.new(nsub.outputs[0], nsc.inputs[0]); L_.new(math_('MULTIPLY', arc, 0.7), nsc.inputs['Scale'])
add1 = N_.new('ShaderNodeVectorMath'); add1.operation = 'ADD'; L_.new(mix.outputs['Result'], add1.inputs[0]); L_.new(sc_b.outputs[0], add1.inputs[1])
add2 = N_.new('ShaderNodeVectorMath'); add2.operation = 'ADD'; L_.new(add1.outputs[0], add2.inputs[0]); L_.new(nsc.outputs[0], add2.inputs[1])
setpos = N_.new('GeometryNodeSetPosition'); L_.new(gi.outputs[0], setpos.inputs['Geometry']); L_.new(add2.outputs[0], setpos.inputs['Position'])
# radius: hidden before the break, bigger while flying, settles small, twinkles
alive = math_('GREATER_THAN', frame, float(F_SHATTER) - 0.5)
twinkle = math_('ADD', 0.75, math_('MULTIPLY', 0.25, math_('SINE', math_('ADD', math_('MULTIPLY', frame, 0.35), math_('MULTIPLY', a_rnd.outputs['Attribute'], 40.0)))))
size = math_('ADD', 0.0042, math_('MULTIPLY', arc, 0.0075))
size = math_('MULTIPLY', math_('MULTIPLY', size, twinkle), math_('ADD', 0.6, math_('MULTIPLY', a_rnd.outputs['Attribute'], 0.8)))
radius = math_('MULTIPLY', size, alive)
m2p = N_.new('GeometryNodeMeshToPoints'); L_.new(setpos.outputs[0], m2p.inputs['Mesh']); L_.new(radius, m2p.inputs['Radius'])
smat = N_.new('GeometryNodeSetMaterial'); smat.inputs['Material'].default_value = pmat
L_.new(m2p.outputs[0], smat.inputs['Geometry']); L_.new(smat.outputs[0], go.inputs[0])
mod = parts.modifiers.new('Flow', 'NODES'); mod.node_group = ng

# ---------------------------------------------------------------- lights
def area(name, loc, rot, size, energy, color=(1, 1, 1), shape='RECTANGLE', size_y=None):
    ld = bpy.data.lights.new(name, 'AREA'); ld.shape = shape; ld.size = size
    if size_y: ld.size_y = size_y
    ld.energy = energy; ld.color = color
    ob = link(bpy.data.objects.new(name, ld)); ob.location = loc; ob.rotation_euler = rot
    return ob
rig = link(bpy.data.objects.new('LightRig', None))
for nm, loc, rot, sx, sy, e in (('StripTop', (0, -1.0, 4.2), (math.radians(20), 0, 0), 9.0, 0.18, 240),
                                ('StripLeft', (-3.8, -2.2, 1.0), (0, math.radians(-68), math.radians(-25)), 0.14, 7.0, 110),
                                ('StripRight', (3.9, -1.6, 2.2), (0, math.radians(62), math.radians(20)), 0.12, 8.0, 95)):
    o = area(nm, loc, rot, sx, e, size_y=sy); o.parent = rig
rig.rotation_euler = (0, 0, math.radians(-14)); rig.keyframe_insert('rotation_euler', frame=1, index=2)
rig.rotation_euler = (0, 0, math.radians(16)); rig.keyframe_insert('rotation_euler', frame=F_SHATTER, index=2)
set_interp(rig, 'SINE', 'EASE_IN_OUT')
rim = area('EmberRim', (0.6, 3.2, 2.0), (math.radians(-60), 0, math.radians(170)), 4.0, 260, color=EMBER)
fill = area('Fill', (0, -6, -1.5), (math.radians(100), 0, 0), 6.0, 20)

# ---------------------------------------------------------------- camera
camd = bpy.data.cameras.new('Cam'); camd.lens = 50; camd.sensor_fit = 'VERTICAL'; camd.sensor_height = 36 * 16 / 9 * 0.5625 * 1.0
camd.sensor_height = 24.0
camd.dof.use_dof = True; camd.dof.aperture_fstop = 2.2
focus = link(bpy.data.objects.new('Focus', None)); camd.dof.focus_object = focus
cam = link(bpy.data.objects.new('Cam', camd)); sc.camera = cam
target = link(bpy.data.objects.new('CamTarget', None))
tr = cam.constraints.new('TRACK_TO'); tr.target = target; tr.track_axis = 'TRACK_NEGATIVE_Z'; tr.up_axis = 'UP_Y'

def cam_key(f, loc, tgt, focus_loc=None, fstop=None):
    cam.location = loc; cam.keyframe_insert('location', frame=f)
    target.location = tgt; target.keyframe_insert('location', frame=f)
    if focus_loc is not None:
        focus.location = focus_loc; focus.keyframe_insert('location', frame=f)
    if fstop is not None:
        camd.dof.aperture_fstop = fstop; camd.dof.keyframe_insert('aperture_fstop', frame=f)

cam_key(1, (0.4, -10.5, 1.4), (0, 0, 0.1), (0, -0.1, 0.2), 2.8)
cam_key(F_SHATTER, (0.15, -7.6, 0.95), (0, 0, 0.0), (0, -0.1, 0.15), 2.8)
cam_key(F_SHATTER + 4, (0.18, -7.8, 1.0), (0.02, 0, 0.0), None, 5.0)
cam_key(66, (2.6, -10.6, 2.6), (0.15, 0.2, 0.5), (0, 0.1, 0.2), 6.0)
cam_key(90, (3.3, -11.4, 3.0), (0.2, 0.2, 0.65), (0, 0.15, 0.3), 6.5)
set_interp(cam, 'BEZIER'); set_interp(target, 'BEZIER'); set_interp(focus, 'BEZIER')
# small shake on the break
for f, off in ((F_SHATTER + 1, (0.05, 0, -0.04)), (F_SHATTER + 2, (-0.04, 0, 0.03)), (F_SHATTER + 3, (0.02, 0, -0.01))):
    sc.frame_set(f); cam.location = cam.location + Vector(off); cam.keyframe_insert('location', frame=f)

# ---------------------------------------------------------------- go
os.makedirs(OUT, exist_ok=True)
if arg('--save'):
    bpy.ops.wm.save_as_mainfile(filepath=os.path.abspath(arg('--save')))
a, b_ = (int(x) for x in FRAMES.split('-')) if '-' in FRAMES else (int(FRAMES), int(FRAMES))
frames = [int(x) for x in arg('--list').split(',')] if arg('--list') else range(a, b_ + 1)
import time
for f in frames:
    t0 = time.time()
    sc.frame_set(f)
    sc.render.filepath = os.path.join(OUT, f'f{f:04d}.hdr')
    bpy.ops.render.render(write_still=True)
    print(f'[frame {f}] {time.time() - t0:.1f}s', flush=True)
