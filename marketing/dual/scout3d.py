"""SCOUT-side 3D assets for "BEFORE THE BREAKOUT" (new; nothing here is in the
earlier ads): a large studio monitor in dark brushed metal, the SCOUT desk,
a thick glass data panel, and data trails that flow along a path.
Built on the shared toolkit (../commercial/next3d.py), imported read-only.
"""
import math, os, sys
HERE = os.path.dirname(os.path.abspath(__file__))
for p in (HERE, os.path.join(HERE, '..', 'commercial2'), os.path.join(HERE, '..', 'commercial')):
    if p not in sys.path: sys.path.insert(0, p)
from next3d import *
from mathutils import Vector

CYAN = (0.20, 0.62, 1.0)              # SCOUT's accent, oklch(78% .13 220), as linear light
CYAN_HOT = (0.42, 0.80, 1.0)
FONT_INTER_B = os.path.join(HERE, 'fonts', 'Inter-700.ttf')
FONT_INTER_M = os.path.join(HERE, 'fonts', 'Inter-500.ttf')

def brushed(name, color=(0.055, 0.058, 0.064), rough=(0.18, 0.32), scale=(900.0, 6.0, 6.0)):
    """Dark brushed metal: anisotropic, with long fine streaks in the roughness."""
    m = principled(name, color, metallic=1.0, rough=0.25, aniso=0.6)
    nt = m.node_tree; b = nt.nodes['Principled BSDF']
    tc = nt.nodes.new('ShaderNodeTexCoord'); nz = nt.nodes.new('ShaderNodeTexNoise'); mp = nt.nodes.new('ShaderNodeMapping')
    mp.inputs['Scale'].default_value = scale
    nt.links.new(tc.outputs['Object'], mp.inputs['Vector']); nt.links.new(mp.outputs['Vector'], nz.inputs['Vector'])
    mr = nt.nodes.new('ShaderNodeMapRange'); mr.inputs['To Min'].default_value, mr.inputs['To Max'].default_value = rough
    nt.links.new(nz.outputs['Fac'], mr.inputs['Value']); nt.links.new(mr.outputs['Result'], b.inputs['Roughness'])
    return m

def build_monitor(name, states, width=4.0, glow=1.25):
    """A large 16:9 studio monitor facing -Y: thin bezel, chamfered chrome lip, matte screen with the
    real SCOUT capture, ribbed back housing, a single brushed arm and a heavy base.
    Returns (root, screen). The screen's centre is at root + (0, 0, 0) local; the base sits below."""
    W, H = width, width * 9 / 16
    B = 0.06                                                           # bezel
    root = link(bpy.data.objects.new(name, None))
    hold = link(bpy.data.objects.new(name + '_hold', None)); hold.parent = root; hold.rotation_euler = (math.radians(90), 0, 0)
    metal = brushed(name + '_metal')
    chrome = principled(name + '_chrome', (0.75, 0.77, 0.8), metallic=1.0, rough=0.12)
    black = principled(name + '_black', (0.006, 0.006, 0.007), rough=0.35)
    def P(ob, z=0.0, loc=None, rot=None, parent=hold):
        ob.parent = parent
        ob.location = loc if loc else (0, 0, z)
        if rot: ob.rotation_euler = rot
        return ob
    P(rounded_slab(name + '_body', W + 2 * B, H + 2 * B, 0.07, depth=0.05, bevel=0.012, mat=metal))
    P(rounded_slab(name + '_lip', W + 2 * B - 0.01, H + 2 * B - 0.01, 0.066, depth=0.003, bevel=0.004, mat=chrome), 0.05)
    P(rounded_slab(name + '_bezel', W + 0.03, H + 0.03, 0.02, depth=0.002, mat=black), 0.06)
    scr = rounded_mesh(name + '_screen', W, H, 0.012, mat=screen_material(name + '_screen', states, glow))
    sb = next(n for n in scr.data.materials[0].node_tree.nodes if n.type == 'BSDF_PRINCIPLED')
    sb.inputs['Roughness'].default_value = 0.32                        # matte anti-glare panel: soft reflections only
    sb.inputs['Coat Weight'].default_value = 0.25; sb.inputs['Coat Roughness'].default_value = 0.2
    P(scr, 0.066)
    # back housing with cooling ribs
    P(rounded_slab(name + '_back', W * 0.62, H * 0.62, 0.12, depth=0.06, bevel=0.02, mat=metal), -0.09)
    for i in range(9):
        P(rounded_slab(name + f'_rib{i}', W * 0.5, 0.018, 0.008, depth=0.01, mat=black), loc=(0, -H * 0.24 + i * H * 0.06, -0.155))
    # arm + base
    arm = rounded_slab(name + '_arm', 0.22, H * 0.9, 0.05, depth=0.04, bevel=0.012, mat=metal)
    P(arm, loc=(0, -H * 0.45, -0.2))
    base = rounded_slab(name + '_base', W * 0.32, 0.9, 0.18, depth=0.025, bevel=0.012, mat=metal)
    P(base, loc=(0, -H * 0.9 - 0.03, -0.45), rot=(math.radians(90), 0, 0))
    return root, scr

def glass_panel(name, image_path, width, depth=0.05, glow=1.15, facing='front'):
    """A thick glass panel with a captured UI on its face: clear glass body (real refraction and
    edges), the image as a thin emissive layer just under the front surface.
    Returns (root, face, height). Panel lies in the root's XZ plane, facing -Y ('front') or +Y ('back')."""
    img = load_image(image_path)
    h = width * img.size[1] / img.size[0]
    root = link(bpy.data.objects.new(name, None))
    hold = link(bpy.data.objects.new(name + '_hold', None)); hold.parent = root
    hold.rotation_euler = (math.radians(90), 0, 0 if facing == 'front' else math.pi)
    glass = principled(name + '_glass', (0.92, 0.96, 1.0), rough=0.04, transmission=1.0, ior=1.45, coat=0.4)
    body = rounded_slab(name + '_body', width + 0.06, h + 0.06, 0.06, depth=depth / 2, bevel=0.012, mat=glass); body.parent = hold
    m = bpy.data.materials.new(name + '_ui'); m.use_nodes = True; nt = m.node_tree; nt.nodes.clear()
    out = nt.nodes.new('ShaderNodeOutputMaterial'); tc = nt.nodes.new('ShaderNodeTexCoord'); tex = nt.nodes.new('ShaderNodeTexImage')
    tex.image = img; tex.extension = 'CLIP'; tex.interpolation = 'Cubic'
    em = nt.nodes.new('ShaderNodeEmission'); em.inputs['Strength'].default_value = glow
    tr = nt.nodes.new('ShaderNodeBsdfTransparent'); mix = nt.nodes.new('ShaderNodeMixShader')
    fade = nt.nodes.new('ShaderNodeMath'); fade.operation = 'MULTIPLY'; fade.inputs[1].default_value = 1.0
    nt.links.new(tc.outputs['UV'], tex.inputs['Vector']); nt.links.new(tex.outputs['Color'], em.inputs['Color'])
    nt.links.new(tex.outputs['Alpha'], fade.inputs[0]); nt.links.new(fade.outputs[0], mix.inputs['Fac'])
    nt.links.new(tr.outputs[0], mix.inputs[1]); nt.links.new(em.outputs[0], mix.inputs[2]); nt.links.new(mix.outputs[0], out.inputs['Surface'])
    face = rounded_mesh(name + '_face', width, h, 0.03, mat=m); face.parent = hold; face.location.z = depth / 2 + 0.004
    m['fade_socket'] = 'Math'                                          # fade.inputs[1] keys the UI in/out
    return root, face, h, fade.inputs[1], em.inputs['Strength']

def flow_trail(name, points, count=600, radius=0.0035, spread=0.12, speed=0.22, color=CYAN_HOT, strength=0.0):
    """Data trails: points stream along a smooth path (a curve through `points`), each with its own
    lateral offset, so the stream reads as fine light filaments rather than a tube.
    Returns (object, emission node) — key the node's Color and Strength."""
    cu = bpy.data.curves.new(name + 'Path', 'CURVE'); cu.dimensions = '3D'
    sp = cu.splines.new('BEZIER'); sp.bezier_points.add(len(points) - 1)
    for bp, p in zip(sp.bezier_points, points):
        bp.co = p; bp.handle_left_type = bp.handle_right_type = 'AUTO'
    path = link(bpy.data.objects.new(name + 'Path', cu)); path.hide_render = True
    mat, em = emissive(name + 'Mat', color, strength)
    holder = link(bpy.data.objects.new(name, bpy.data.meshes.new(name)))
    ng = bpy.data.node_groups.new(name + 'Flow', 'GeometryNodeTree')
    ng.interface.new_socket('Geometry', in_out='INPUT', socket_type='NodeSocketGeometry')
    ng.interface.new_socket('Geometry', in_out='OUTPUT', socket_type='NodeSocketGeometry')
    N, L = ng.nodes, ng.links
    gi, go = N.new('NodeGroupInput'), N.new('NodeGroupOutput')
    oi = N.new('GeometryNodeObjectInfo'); oi.inputs['Object'].default_value = path; oi.transform_space = 'RELATIVE'
    pts = N.new('GeometryNodePoints'); pts.inputs['Count'].default_value = count
    idx = N.new('GeometryNodeInputIndex')
    def R(seed):
        r = N.new('FunctionNodeRandomValue'); r.data_type = 'FLOAT'; L.new(idx.outputs[0], r.inputs['ID']); r.inputs['Seed'].default_value = seed; return r.outputs[1]
    def M(op, a, b):
        x = N.new('ShaderNodeMath'); x.operation = op
        for i, v in enumerate((a, b)):
            if isinstance(v, (int, float)): x.inputs[i].default_value = v
            else: L.new(v, x.inputs[i])
        return x.outputs[0]
    t = N.new('GeometryNodeInputSceneTime').outputs['Seconds']
    fac = M('FRACT', M('ADD', R(1), M('MULTIPLY', t, M('ADD', speed * 0.6, M('MULTIPLY', R(2), speed * 0.8)))), 0)
    smp = N.new('GeometryNodeSampleCurve'); smp.mode = 'FACTOR'; L.new(oi.outputs['Geometry'], smp.inputs['Curves']); L.new(fac, smp.inputs['Factor'])
    off = N.new('ShaderNodeCombineXYZ')
    for i, s in enumerate((3, 4, 5)): L.new(M('MULTIPLY', M('SUBTRACT', R(s), 0.5), spread * 2), off.inputs[i])
    pos = N.new('ShaderNodeVectorMath'); pos.operation = 'ADD'; L.new(smp.outputs['Position'], pos.inputs[0]); L.new(off.outputs[0], pos.inputs[1])
    setp = N.new('GeometryNodeSetPosition'); L.new(pts.outputs[0], setp.inputs['Geometry']); L.new(pos.outputs[0], setp.inputs['Position'])
    rad = N.new('GeometryNodeSetPointRadius'); L.new(setp.outputs[0], rad.inputs['Points'])
    L.new(M('MULTIPLY', M('ADD', 0.35, R(6)), radius), rad.inputs['Radius'])
    sm = N.new('GeometryNodeSetMaterial'); sm.inputs['Material'].default_value = mat; L.new(rad.outputs[0], sm.inputs['Geometry'])
    L.new(sm.outputs[0], go.inputs[0])
    holder.modifiers.new('Flow', 'NODES').node_group = ng
    return holder, em

def key_color(socket, pairs):
    for f, c in pairs:
        socket.default_value = (*c, 1.0); socket.keyframe_insert('default_value', frame=f)

def key_val(socket, pairs):
    for f, v in pairs:
        socket.default_value = v; socket.keyframe_insert('default_value', frame=f)

def key_energy(ob, pairs):
    for f, v in pairs:
        ob.data.energy = v; ob.data.keyframe_insert('energy', frame=f)

def key_light_color(ob, pairs):
    for f, c in pairs:
        ob.data.color = c; ob.data.keyframe_insert('color', frame=f)
