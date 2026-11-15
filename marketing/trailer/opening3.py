"""NEXT reveal trailer — Scenes 1–2, one continuous shot (0–11 s, frames 1–330).

A single orange light flickers in the dark (1–30), then stretches into a 3D sound
wave — nine luminous strands running into the depth of the frame, driven by the
score's real loudness (env.json from music3.py), with particles travelling along
them. The camera drifts in; far beyond, thousands of faint lights (the world of
music, Scene 2) begin to show.

Scene 2 (166–330, with --end 330): the camera flies on through the strands into a
dark world of floating artist profiles (real NEXT Discover cards, demo artists;
cover-art colour variants from make_cards3.py) and thousands of lights.

  blender-venv/bin/python opening3.py -- --assets DIR [--end 165|330|390] [--hook wide] [--preview|--gpu] [--frames a-b|--list ...] [--out DIR]
"""
import json, math, os, random, sys
HERE = os.path.dirname(os.path.abspath(__file__))
for p in (HERE, os.path.join(HERE, '..', 'commercial')):
    if p not in sys.path: sys.path.insert(0, p)
from next3d import *
from mathutils import Vector

random.seed(1)
S1 = 165
S2 = 330
END = int(arg('--end', '390'))           # 165 = Scene 1 only · 330 = + Scene 2 · 390 = + Scene 3a (the convergence)
sc = init(END, samples=64)
WIDE = arg('--hook') == 'wide'                  # 16:9 version: same shots, 1920x1080 (vertical field of view kept)
if WIDE: sc.render.resolution_x, sc.render.resolution_y = 1920, 1080
sc.render.motion_blur_shutter = 0.5
ENV = json.load(open(os.path.join(ASSETS, 'env.json')))
HALF = 6.0                                   # the wave runs along Y from -HALF..HALF (into the frame)

# ---------------------------------------------------------------- the wave (geometry nodes)
def strand_tree():
    ng = bpy.data.node_groups.new('Strand', 'GeometryNodeTree')
    ng.interface.new_socket('Geometry', in_out='INPUT', socket_type='NodeSocketGeometry')
    ng.interface.new_socket('Geometry', in_out='OUTPUT', socket_type='NodeSocketGeometry')
    for nm in ('Phase', 'Lateral', 'Amp', 'Grow', 'Radius', 'Lift'):
        ng.interface.new_socket(nm, in_out='INPUT', socket_type='NodeSocketFloat')
    Nn, Lk = ng.nodes, ng.links
    gi, go = Nn.new('NodeGroupInput'), Nn.new('NodeGroupOutput')
    def M(op, a=None, b=None):
        x = Nn.new('ShaderNodeMath'); x.operation = op
        for i, v in enumerate((a, b)):
            if v is None: continue
            if isinstance(v, (int, float)): x.inputs[i].default_value = v
            else: Lk.new(v, x.inputs[i])
        return x.outputs[0]
    line = Nn.new('GeometryNodeCurvePrimitiveLine'); line.inputs['Start'].default_value = (0, -1, 0); line.inputs['End'].default_value = (0, 1, 0)
    rs = Nn.new('GeometryNodeResampleCurve'); rs.inputs['Count'].default_value = 520; Lk.new(line.outputs[0], rs.inputs['Curve'])
    pos = Nn.new('GeometryNodeInputPosition'); sep = Nn.new('ShaderNodeSeparateXYZ'); Lk.new(pos.outputs[0], sep.inputs[0])
    u = sep.outputs['Y']                                            # -1..1 along the wave
    t = Nn.new('GeometryNodeInputSceneTime').outputs['Seconds']
    ph = gi.outputs['Phase']
    taper = M('POWER', M('SUBTRACT', 1.0, M('MULTIPLY', u, u)), 2.0)          # (1-u²)²: thin at both ends
    w1 = M('SINE', M('ADD', M('ADD', M('MULTIPLY', u, 9.0), M('MULTIPLY', t, 2.3)), ph))
    w2 = M('SINE', M('ADD', M('SUBTRACT', M('MULTIPLY', u, 23.0), M('MULTIPLY', t, 3.1)), M('MULTIPLY', ph, 1.7)))
    nz = Nn.new('ShaderNodeTexNoise'); nz.noise_dimensions = '4D'; nz.inputs['Scale'].default_value = 2.5
    cv = Nn.new('ShaderNodeCombineXYZ'); Lk.new(M('MULTIPLY', u, 3.0), cv.inputs[0]); Lk.new(ph, cv.inputs[1]); Lk.new(cv.outputs[0], nz.inputs['Vector'])
    Lk.new(M('MULTIPLY', t, 0.35), nz.inputs['W'])
    wave = M('ADD', M('ADD', M('MULTIPLY', w1, 0.55), M('MULTIPLY', w2, 0.22)), M('MULTIPLY', M('SUBTRACT', nz.outputs['Fac'], 0.5), 0.9))
    z = M('ADD', M('MULTIPLY', M('MULTIPLY', wave, taper), gi.outputs['Amp']), gi.outputs['Lift'])
    x = M('ADD', gi.outputs['Lateral'], M('MULTIPLY', M('SINE', M('ADD', M('MULTIPLY', u, 4.0), M('ADD', t, ph))), M('MULTIPLY', taper, 0.06)))
    y = M('MULTIPLY', M('MULTIPLY', u, HALF), gi.outputs['Grow'])
    spread = M('MINIMUM', gi.outputs['Grow'], 1.0)                 # the whole wave unfolds out of the seed light
    x = M('MULTIPLY', x, spread); z = M('MULTIPLY', z, spread)
    cp = Nn.new('ShaderNodeCombineXYZ'); Lk.new(x, cp.inputs[0]); Lk.new(y, cp.inputs[1]); Lk.new(z, cp.inputs[2])
    sp = Nn.new('GeometryNodeSetPosition'); Lk.new(rs.outputs[0], sp.inputs['Geometry']); Lk.new(cp.outputs[0], sp.inputs['Position'])
    circ = Nn.new('GeometryNodeCurvePrimitiveCircle'); circ.inputs['Resolution'].default_value = 8; Lk.new(gi.outputs['Radius'], circ.inputs['Radius'])
    c2m = Nn.new('GeometryNodeCurveToMesh'); Lk.new(sp.outputs[0], c2m.inputs['Curve']); Lk.new(circ.outputs[0], c2m.inputs['Profile Curve'])
    sm1 = Nn.new('GeometryNodeSetMaterial'); Lk.new(c2m.outputs[0], sm1.inputs['Geometry'])
    # particles riding the strand
    pts = Nn.new('GeometryNodePoints'); pts.inputs['Count'].default_value = 140
    idx = Nn.new('GeometryNodeInputIndex')
    rnd = Nn.new('FunctionNodeRandomValue'); rnd.data_type = 'FLOAT'; Lk.new(idx.outputs[0], rnd.inputs['ID'])
    rv = rnd.outputs[1]
    fac = M('FRACT', M('ADD', rv, M('MULTIPLY', t, M('ADD', 0.06, M('MULTIPLY', rv, 0.08)))))
    samp = Nn.new('GeometryNodeSampleCurve'); samp.mode = 'FACTOR'; Lk.new(sp.outputs[0], samp.inputs['Curves']); Lk.new(fac, samp.inputs['Factor'])
    sp2 = Nn.new('GeometryNodeSetPosition'); Lk.new(pts.outputs[0], sp2.inputs['Geometry']); Lk.new(samp.outputs['Position'], sp2.inputs['Position'])
    rad = Nn.new('GeometryNodeSetPointRadius'); Lk.new(sp2.outputs[0], rad.inputs['Points'])
    Lk.new(M('MULTIPLY', M('ADD', 0.4, rv), M('MULTIPLY', gi.outputs['Radius'], 1.6)), rad.inputs['Radius'])
    sm2 = Nn.new('GeometryNodeSetMaterial'); Lk.new(rad.outputs[0], sm2.inputs['Geometry'])
    j = Nn.new('GeometryNodeJoinGeometry'); Lk.new(sm1.outputs[0], j.inputs[0]); Lk.new(sm2.outputs[0], j.inputs[0])
    Lk.new(j.outputs[0], go.inputs[0])
    return ng, sm1, sm2
ng, sm_line, sm_pts = strand_tree()
ident = {it.name: it.identifier for it in ng.interface.items_tree if getattr(it, 'in_out', '') == 'INPUT'}
core_m, core_e = emissive('WaveCore', (1.0, 0.6, 0.34), 3.2)
strand_m, strand_e = emissive('WaveStrand', EMBER_HOT, 1.5)
spark_m, spark_e = emissive('WaveSpark', (1.0, 0.8, 0.6), 4.5)
GROW0, GROW1 = 28, 96
def amp_at(f):
    e = ENV[min(f - 1, len(ENV) - 1)]
    return 0.07 + 1.25 * e
strands = []
for k in range(9):
    me = bpy.data.meshes.new(f'Strand{k}'); ob = link(bpy.data.objects.new(f'Strand{k}', me))
    md = ob.modifiers.new('Wave', 'NODES'); md.node_group = ng if k == 0 else ng
    off = (k - 4) / 4.0
    vals = {'Phase': 0.73 * k, 'Lateral': off * 0.55, 'Radius': 0.006 if k == 4 else 0.0026, 'Lift': off * off * 0.18 - 0.05}
    for nm, v in vals.items(): md[ident[nm]] = v
    ob['mat'] = 'core' if k == 4 else 'strand'
    for f in range(1, END + 1):                              # amplitude follows the score; length grows from the light
        md[ident['Amp']] = amp_at(f) * (1.0 if k == 4 else 0.55 + 0.45 * abs(math.sin(k * 1.7)))
        g = min(max((f - GROW0) / (GROW1 - GROW0), 0.0), 1.0); md[ident['Grow']] = 0.002 + (1 - (1 - g) ** 3)
        ob.keyframe_insert(f'modifiers["Wave"]["{ident["Amp"]}"]', frame=f)
        ob.keyframe_insert(f'modifiers["Wave"]["{ident["Grow"]}"]', frame=f)
    strands.append(ob)
# materials are set per object through a copy of the tree (core vs strands)
ng_core = ng.copy()
for ob in strands:
    tree = ng_core if ob['mat'] == 'core' else ng
    ob.modifiers['Wave'].node_group = tree
for tree, line_m in ((ng, strand_m), (ng_core, core_m)):
    for n in tree.nodes:
        if n.type == 'SET_MATERIAL':
            n.inputs['Material'].default_value = line_m if n.inputs['Geometry'].links[0].from_node.type == 'CURVE_TO_MESH' else spark_m

# ---------------------------------------------------------------- the single light that becomes the wave
lm, le = emissive('Seed', (1.0, 0.6, 0.32), 0.0)
bpy.ops.mesh.primitive_uv_sphere_add(radius=0.012, segments=32, ring_count=16, location=(0, 0, 0)); seed = bpy.context.active_object
seed.data.materials.append(lm)
for f, v in ((1, 0.0), (4, 6.0), (6, 1.0), (9, 9.0), (11, 2.0), (15, 10.0), (18, 4.0), (22, 12.0), (28, 14.0), (36, 6.0), (48, 0.0)):
    le.inputs['Strength'].default_value = v; le.inputs['Strength'].keyframe_insert('default_value', frame=f)
keys(seed, 'scale', [(1, (0.6, 0.6, 0.6)), (28, (1.0, 1.0, 1.0)), (40, (1.6, 1.6, 1.6)), (48, (0.4, 0.4, 0.4))])
sl = bpy.data.lights.new('SeedLight', 'POINT'); sl.color = EMBER_HOT; sl.shadow_soft_size = 0.05
seed_l = link(bpy.data.objects.new('SeedLight', sl))
for f, v in ((1, 0.0), (9, 4.0), (22, 6.0), (30, 10.0), (60, 3.0)):
    sl.energy = v; sl.keyframe_insert('energy', frame=f)

# ---------------------------------------------------------------- the world of music, far beyond (fades in)
far = [Vector((random.gauss(0, 16), random.uniform(28, 110), random.gauss(0, 10))) for _ in range(1800)]
far_m, far_e = emissive('FarLights', (1.0, 0.72, 0.5), 0.0)
mesh = bpy.data.meshes.new('Far'); mesh.vertices.add(len(far)); mesh.vertices.foreach_set('co', [c for v in far for c in v])
fob = link(bpy.data.objects.new('Far', mesh))
fng = bpy.data.node_groups.new('FarPts', 'GeometryNodeTree')
fng.interface.new_socket('Geometry', in_out='INPUT', socket_type='NodeSocketGeometry'); fng.interface.new_socket('Geometry', in_out='OUTPUT', socket_type='NodeSocketGeometry')
fgi, fgo = fng.nodes.new('NodeGroupInput'), fng.nodes.new('NodeGroupOutput')
m2p = fng.nodes.new('GeometryNodeMeshToPoints'); m2p.inputs['Radius'].default_value = 0.03
fsm = fng.nodes.new('GeometryNodeSetMaterial'); fsm.inputs['Material'].default_value = far_m
fng.links.new(fgi.outputs[0], m2p.inputs['Mesh']); fng.links.new(m2p.outputs[0], fsm.inputs['Geometry']); fng.links.new(fsm.outputs[0], fgo.inputs[0])
fob.modifiers.new('Pts', 'NODES').node_group = fng
for f, v in ((1, 0.0), (95, 0.0), (165, 0.9), (330, 1.3), (360, 1.0), (374, 0.0)):
    far_e.inputs['Strength'].default_value = v; far_e.inputs['Strength'].keyframe_insert('default_value', frame=f)

# a faint warm haze far behind (gives the black some depth)
bpy.ops.mesh.primitive_plane_add(size=200, location=(0, 90, 0), rotation=(math.radians(90), 0, 0)); hz = bpy.context.active_object
hm = bpy.data.materials.new('Haze'); hm.use_nodes = True; hn = hm.node_tree; hn.nodes.clear()
htc = hn.nodes.new('ShaderNodeTexCoord'); hgr = hn.nodes.new('ShaderNodeTexGradient'); hgr.gradient_type = 'SPHERICAL'
hmp = hn.nodes.new('ShaderNodeMapping'); hmp.inputs['Scale'].default_value = (0.015, 0.015, 0.015)
hpw = hn.nodes.new('ShaderNodeMath'); hpw.operation = 'POWER'; hpw.inputs[1].default_value = 2.5
hmu = hn.nodes.new('ShaderNodeMath'); hmu.operation = 'MULTIPLY'
for f, v in ((1, 0.0), (40, 0.012), (165, 0.03), (230, 0.008)):
    hmu.inputs[1].default_value = v; hmu.inputs[1].keyframe_insert('default_value', frame=f)
hem = hn.nodes.new('ShaderNodeEmission'); hem.inputs['Color'].default_value = (*EMBER, 1); ho = hn.nodes.new('ShaderNodeOutputMaterial')
hn.links.new(htc.outputs['Object'], hmp.inputs['Vector']); hn.links.new(hmp.outputs['Vector'], hgr.inputs['Vector'])
hn.links.new(hgr.outputs['Fac'], hpw.inputs[0]); hn.links.new(hpw.outputs[0], hmu.inputs[0]); hn.links.new(hmu.outputs[0], hem.inputs['Strength'])
hn.links.new(hem.outputs[0], ho.inputs['Surface']); hz.data.materials.append(hm)

# ================================================================ Scene 2: the world of artists
CONV = (0.4, 44.0, 0.85)
if END > S1:
    import glob
    sc.cycles.transparent_max_bounces = 32
    # the wave has done its job once the camera is through it
    for node, v in ((core_e, 3.2), (strand_e, 1.5), (spark_e, 4.5)):
        for f, x in ((215, v), (265, 0.0)):
            node.inputs['Strength'].default_value = x; node.inputs['Strength'].keyframe_insert('default_value', frame=f)
    def card_material(name, path):
        """The captured card image as a glowing glass face; it fades with distance into the dark."""
        img = load_image(path)
        m = bpy.data.materials.new(name); m.use_nodes = True; nt = m.node_tree; b = nt.nodes['Principled BSDF']
        tc = nt.nodes.new('ShaderNodeTexCoord'); tex = nt.nodes.new('ShaderNodeTexImage'); tex.image = img; tex.extension = 'CLIP'
        nt.links.new(tc.outputs['UV'], tex.inputs['Vector'])
        cd = nt.nodes.new('ShaderNodeCameraData'); mr = nt.nodes.new('ShaderNodeMapRange')
        mr.inputs['From Min'].default_value, mr.inputs['From Max'].default_value = 9.0, 50.0
        mr.inputs['To Min'].default_value, mr.inputs['To Max'].default_value = 1.0, 0.0
        nt.links.new(cd.outputs['View Distance'], mr.inputs['Value'])
        mul = nt.nodes.new('ShaderNodeMath'); mul.operation = 'MULTIPLY'; nt.links.new(mr.outputs[0], mul.inputs[0])
        for f, v in ((S1, 0.0), (178, 0.0), (225, 0.85), (S2, 0.85), (362, 2.4), (376, 0.0)):
            mul.inputs[1].default_value = v; mul.inputs[1].keyframe_insert('default_value', frame=f)
        b.inputs['Base Color'].default_value = (0, 0, 0, 1); b.inputs['Roughness'].default_value = 0.1
        b.inputs['Coat Weight'].default_value = 0.25
        hs = nt.nodes.new('ShaderNodeHueSaturation'); hs.inputs['Saturation'].default_value = 0.78
        nt.links.new(tex.outputs['Color'], hs.inputs['Color']); nt.links.new(hs.outputs['Color'], b.inputs['Emission Color']); nt.links.new(mul.outputs[0], b.inputs['Emission Strength'])
        fade_in(m)
        return m, img.size[1] / img.size[0]
    def fade_in(m):
        """Cards emerge from nothing (transparent -> solid) instead of showing as silhouettes."""
        nt = m.node_tree; out = [n for n in nt.nodes if n.type == 'OUTPUT_MATERIAL'][0]
        src = out.inputs['Surface'].links[0].from_socket
        tr = nt.nodes.new('ShaderNodeBsdfTransparent'); mx = nt.nodes.new('ShaderNodeMixShader')
        nt.links.new(tr.outputs[0], mx.inputs[1]); nt.links.new(src, mx.inputs[2]); nt.links.new(mx.outputs[0], out.inputs['Surface'])
        for f, v in ((S1, 0.0), (180, 0.0), (218, 1.0)):
            mx.inputs['Fac'].default_value = v; mx.inputs['Fac'].keyframe_insert('default_value', frame=f)
    edge_mat = principled('CardEdge', (0.5, 0.5, 0.52), metallic=1.0, rough=0.2); fade_in(edge_mat)
    protos = []
    for i, path in enumerate(sorted(glob.glob(os.path.join(ASSETS, 'cards', 'c*.png')))):
        m, aspect = card_material(f'CardTex{i}', path)
        w, h = 1.0, aspect
        face = rounded_mesh(f'CardFace{i}', w, h, 0.04, mat=m)
        edge = rounded_slab(f'CardEdge{i}', w + 0.012, h + 0.012, 0.046, depth=0.007, bevel=0.003, mat=edge_mat)
        protos.append((face.data, edge.data))
        for ob in (face, edge): bpy.data.objects.remove(ob)
    rng = random.Random(7)
    placed = []
    while len(placed) < 170:
        y = rng.uniform(9.0, 78.0)
        r = rng.uniform(1.5, 1.5 + 4.0 + (y - 9.0) * 0.17) * (1 if rng.random() < 0.85 else 1.8)
        ph = rng.uniform(0, 2 * math.pi)
        p = Vector((r * math.cos(ph) * (1.7 if WIDE else 0.85), y, 0.55 + r * math.sin(ph) * 1.25))
        if abs(p.x) < 1.25 and abs(p.z - 0.55) < 1.0: continue          # keep the flight path clear
        if any((p - q).length < 2.2 for q in placed): continue
        placed.append(p)
    for n, p in enumerate(placed):
        fd, ed = protos[n % len(protos)]
        edge = link(bpy.data.objects.new(f'Card{n}', ed)); face = link(bpy.data.objects.new(f'Card{n}_face', fd))
        face.parent = edge; face.location.z = 0.0115
        edge.location = p
        rot0 = (math.radians(90 + rng.uniform(-14, 14)), math.radians(rng.uniform(-12, 12)), math.radians(rng.uniform(-24, 24)))
        drift = Vector((rng.uniform(-0.25, 0.25), rng.uniform(-0.3, 0.3), rng.uniform(-0.2, 0.35)))
        edge.rotation_euler = rot0; edge.keyframe_insert('rotation_euler', frame=S1)
        edge.keyframe_insert('location', frame=S1)
        edge.location = p + drift; edge.rotation_euler = (rot0[0] + rng.uniform(-0.12, 0.12), rot0[1] + rng.uniform(-0.15, 0.15), rot0[2] + rng.uniform(-0.2, 0.2))
        edge.keyframe_insert('location', frame=S2); edge.keyframe_insert('rotation_euler', frame=S2)
        set_interp(edge, 'LINEAR')
        if END > S2:                                     # Scene 3a: every card streams into one point ahead
            d = rng.uniform(0, 12) + (p.y - 9.0) * 0.08; t0, t1 = int(S2 + 2 + d), int(S2 + 30 + d * 0.5)
            edge.keyframe_insert('location', frame=t0); edge.keyframe_insert('scale', frame=t0)
            edge.location = CONV; edge.scale = (0.02, 0.02, 0.02)
            edge.keyframe_insert('location', frame=t1); edge.keyframe_insert('scale', frame=t1)
            for fc in iter_fcurves(edge.animation_data.action):
                for kp in fc.keyframe_points:
                    if round(kp.co.x) == t0: kp.interpolation = 'EXPO'; kp.easing = 'EASE_IN'
        for ob in (edge, face):                          # not in the render at all until they start to appear
            ob.hide_render = True; ob.keyframe_insert('hide_render', frame=1)
            ob.hide_render = False; ob.keyframe_insert('hide_render', frame=180)
    # thousands of lights among the cards
    near = [Vector((rng.gauss(0, 9), rng.uniform(6, 95), rng.gauss(0.5, 7))) for _ in range(4200)]
    near = [v for v in near if not (abs(v.x) < 0.6 and abs(v.z - 0.55) < 0.5)]
    near_m, near_e = emissive('NearLights', (1.0, 0.7, 0.46), 0.0)
    nmesh = bpy.data.meshes.new('Near'); nmesh.vertices.add(len(near)); nmesh.vertices.foreach_set('co', [c for v in near for c in v])
    nob = link(bpy.data.objects.new('Near', nmesh))
    nng = fng.copy(); [n_ for n_ in nng.nodes if n_.type == 'SET_MATERIAL'][0].inputs['Material'].default_value = near_m
    [n_ for n_ in nng.nodes if n_.type == 'MESH_TO_POINTS'][0].inputs['Radius'].default_value = 0.014
    nob.modifiers.new('Pts', 'NODES').node_group = nng
    for f, v in ((1, 0.0), (175, 0.0), (235, 2.2), (S2, 2.6), (358, 2.0), (374, 0.0)):
        near_e.inputs['Strength'].default_value = v; near_e.inputs['Strength'].keyframe_insert('default_value', frame=f)
    if END > S2:
        fm, fe = emissive('ConvFlash', (1.0, 0.75, 0.55), 0.0)
        bpy.ops.mesh.primitive_uv_sphere_add(radius=0.06, segments=24, ring_count=12, location=CONV); fl_ = bpy.context.active_object
        fl_.data.materials.append(fm)
        for f, v in ((1, 0.0), (350, 0.0), (366, 40.0), (370, 120.0), (375, 0.0)):
            fe.inputs['Strength'].default_value = v; fe.inputs['Strength'].keyframe_insert('default_value', frame=f)
    # a soft warm key from above so the card edges catch light
    key_l = look_light('CardKey', (6, 30, 16), (0, 30, 0), 14, 900, (1.0, 0.72, 0.52)); key_l.visible_camera = False

# ---------------------------------------------------------------- camera: a slow approach, then it starts to fly along the wave
cam = Camera(lens=35, fstop=7.0)
cam.key(1, (0.0, -9.0, 1.15), (0, 0, 0.0), (0, 0, 0))
cam.key(60, (0.15, -8.4, 1.05), (0, 0.2, 0.0), (0, 0, 0))
cam.key(130, (0.35, -6.9, 0.8), (0, 1.0, 0.0), (0, -1.0, 0))
cam.key(S1, (0.25, -5.6, 0.6), (0, 3.5, 0.05), (0, 0.0, 0), 5.0)
if END > S1:                       # Scene 2: on through the strands, into the world of artists
    cam.key(210, (0.12, -0.6, 0.75), (0.0, 10.0, 0.55), (0.0, 6.0, 0.6), 4.0)
    cam.key(260, (-0.1, 8.0, 0.6), (0.2, 22.0, 0.6), (0.0, 15.0, 0.6))
    cam.key(S2, (0.2, 19.5, 0.5), (0.4, 36.0, 0.8), (0.2, 27.0, 0.6))
if END > S2:                       # Scene 3a: rush toward the point where everything converges, then black
    cam.key(372, (0.3, 31.0, 0.75), CONV, CONV, 3.0)
    cam.key(END, (0.3, 33.5, 0.78), CONV, CONV)
cam.smooth(); cam.bind(1)
if arg('--save'): bpy.ops.file.pack_all()             # editable .blend: images packed inside, opens anywhere
render(os.path.join(HERE, 'frames_s1'))
