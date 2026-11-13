"""NEXT reveal trailer — Scene 1 "SOMETHING IS CHANGING" (0–5.5 s, frames 1–165).

A single orange light flickers in the dark (1–30), then stretches into a 3D sound
wave — nine luminous strands running into the depth of the frame, driven by the
score's real loudness (env.json from music3.py), with particles travelling along
them. The camera drifts in; far beyond, thousands of faint lights (the world of
music, Scene 2) begin to show.

  blender-venv/bin/python opening3.py -- --assets DIR [--preview|--gpu] [--frames a-b|--list ...] [--out DIR]
"""
import json, math, os, random, sys
HERE = os.path.dirname(os.path.abspath(__file__))
for p in (HERE, os.path.join(HERE, '..', 'commercial')):
    if p not in sys.path: sys.path.insert(0, p)
from next3d import *
from mathutils import Vector

random.seed(1)
END = 165
sc = init(END, samples=64)
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
core_m = emissive('WaveCore', (1.0, 0.6, 0.34), 3.2)[0]
strand_m = emissive('WaveStrand', EMBER_HOT, 1.5)[0]
spark_m = emissive('WaveSpark', (1.0, 0.8, 0.6), 4.5)[0]
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
for f, v in ((1, 0.0), (95, 0.0), (165, 0.9)):
    far_e.inputs['Strength'].default_value = v; far_e.inputs['Strength'].keyframe_insert('default_value', frame=f)

# a faint warm haze far behind (gives the black some depth)
bpy.ops.mesh.primitive_plane_add(size=200, location=(0, 90, 0), rotation=(math.radians(90), 0, 0)); hz = bpy.context.active_object
hm = bpy.data.materials.new('Haze'); hm.use_nodes = True; hn = hm.node_tree; hn.nodes.clear()
htc = hn.nodes.new('ShaderNodeTexCoord'); hgr = hn.nodes.new('ShaderNodeTexGradient'); hgr.gradient_type = 'SPHERICAL'
hmp = hn.nodes.new('ShaderNodeMapping'); hmp.inputs['Scale'].default_value = (0.015, 0.015, 0.015)
hpw = hn.nodes.new('ShaderNodeMath'); hpw.operation = 'POWER'; hpw.inputs[1].default_value = 2.5
hmu = hn.nodes.new('ShaderNodeMath'); hmu.operation = 'MULTIPLY'
for f, v in ((1, 0.0), (40, 0.012), (165, 0.03)):
    hmu.inputs[1].default_value = v; hmu.inputs[1].keyframe_insert('default_value', frame=f)
hem = hn.nodes.new('ShaderNodeEmission'); hem.inputs['Color'].default_value = (*EMBER, 1); ho = hn.nodes.new('ShaderNodeOutputMaterial')
hn.links.new(htc.outputs['Object'], hmp.inputs['Vector']); hn.links.new(hmp.outputs['Vector'], hgr.inputs['Vector'])
hn.links.new(hgr.outputs['Fac'], hpw.inputs[0]); hn.links.new(hpw.outputs[0], hmu.inputs[0]); hn.links.new(hmu.outputs[0], hem.inputs['Strength'])
hn.links.new(hem.outputs[0], ho.inputs['Surface']); hz.data.materials.append(hm)

# ---------------------------------------------------------------- camera: a slow approach, then it starts to fly along the wave
cam = Camera(lens=35, fstop=7.0)
cam.key(1, (0.0, -9.0, 1.15), (0, 0, 0.0), (0, 0, 0))
cam.key(60, (0.15, -8.4, 1.05), (0, 0.2, 0.0), (0, 0, 0))
cam.key(130, (0.35, -6.9, 0.8), (0, 1.0, 0.0), (0, -1.0, 0))
cam.key(END, (0.25, -5.6, 0.6), (0, 3.5, 0.05), (0, 0.0, 0), 5.0)
cam.smooth(); cam.bind(1)
render(os.path.join(HERE, 'frames_s1'))
