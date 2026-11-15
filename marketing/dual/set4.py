"""The shared SCOUT×NEXT set: the SCOUT workstation (main monitor, two side monitors with real
SCOUT captures, brushed desk with a cyan edge light), the lattice floor that is cyan by the
workstation and orange toward NEXT, and the two far hazes. Every scene builds this same set, so
the camera can travel between scenes without the world changing (moved here unchanged from
transition.py)."""
from scout3d import *

MW = 4.0; MH = MW * 9 / 16; MZ = 1.35

def build_set(S, main_states):
    # ---------------------------------------------------------------- the SCOUT workstation
    mon, mscr = build_monitor('Monitor', main_states, width=MW, glow=1.2)
    mon.location = (0, 0, MZ)
    for nm, img, x, y, yaw in (('MonL', 's02-queue.png', -4.6, 1.2, 24), ('MonB', 's01-roster.png', -2.2, 5.0, 8)):
        m2, _ = build_monitor(nm, [(S(img), 1, 'cut')], width=3.4, glow=0.75)
        m2.location = (x, y, MZ - 0.15); m2.rotation_euler = (0, 0, math.radians(yaw))
    DESK_Z = MZ - (MH * 0.9 + 0.03) - 0.45 * 0 - 0.705 + 0.0
    desk = rounded_slab('Desk', 13.0, 3.2, 0.12, depth=0.06, bevel=0.02, mat=brushed('DeskMetal', (0.035, 0.037, 0.042), scale=(6.0, 900.0, 6.0)))
    desk.location = (0, -0.2, MZ - MH * 0.9 - 0.03 - 0.47)
    edge_m, edge_e = emissive('DeskEdge', CYAN, 2.2)                     # a thin cyan light line along the desk front edge
    bpy.ops.mesh.primitive_cube_add(size=1, location=(0, -1.81, desk.location.z + 0.02)); de = bpy.context.active_object
    de.scale = (13.0, 0.012, 0.012); de.data.materials.append(edge_m)

    # the floor: dark, with a fine lattice whose light is SCOUT cyan here and NEXT orange over there
    FLOOR_Z = desk.location.z - 0.9
    bpy.ops.mesh.primitive_plane_add(size=80, location=(0, 10, FLOOR_Z)); fl = bpy.context.active_object
    fm = principled('Floor', (0.006, 0.006, 0.007), rough=0.14, coat=0.5); nt = fm.node_tree; fb = nt.nodes['Principled BSDF']
    tc = nt.nodes.new('ShaderNodeTexCoord'); sep = nt.nodes.new('ShaderNodeSeparateXYZ'); nt.links.new(tc.outputs['Object'], sep.inputs[0])
    def node_math(op, a, b=None):
        x = nt.nodes.new('ShaderNodeMath'); x.operation = op
        for i, v in enumerate((a, b)):
            if v is None: continue
            if isinstance(v, (int, float)): x.inputs[i].default_value = v
            else: nt.links.new(v, x.inputs[i])
        return x.outputs[0]
    def line(coord, period=1.2, width=0.012):
        f = node_math('FRACT', node_math('DIVIDE', coord, period))
        d = node_math('MINIMUM', f, node_math('SUBTRACT', 1.0, f))
        return node_math('LESS_THAN', d, width / period)
    grid = node_math('MAXIMUM', line(sep.outputs['X']), line(sep.outputs['Y']))
    fade = node_math('POWER', node_math('MAXIMUM', node_math('SUBTRACT', 1.0, node_math('DIVIDE', node_math('ABSOLUTE', node_math('SUBTRACT', sep.outputs['Y'], 2.0)), 16.0)), 0.0), 2.0)
    mixc = nt.nodes.new('ShaderNodeMix'); mixc.data_type = 'RGBA'
    mixc.inputs['A'].default_value = (*CYAN, 1); mixc.inputs['B'].default_value = (*EMBER_HOT, 1)
    nt.links.new(node_math('MINIMUM', node_math('MAXIMUM', node_math('DIVIDE', node_math('SUBTRACT', sep.outputs['X'], 1.2), 3.4), 0.0), 1.0), mixc.inputs['Factor'])
    nt.links.new(mixc.outputs['Result'], fb.inputs['Emission Color'])
    nt.links.new(node_math('MULTIPLY', node_math('MULTIPLY', grid, fade), 0.55), fb.inputs['Emission Strength'])
    fl.data.materials.append(fm)

    return dict(mon=mon, mscr=mscr, desk=desk, edge=edge_e, floor=fl, floor_mat=fm, FLOOR_Z=FLOOR_Z)

def build_haze():
    """Cool haze far behind the workstation, warm haze far behind the phone; returns their strength sockets."""
    # an orange haze far behind the phone; a cool one behind the monitor
    HAZE = {}
    for nm, loc, col, e in (('HazeS', (0, 9, 1.5), CYAN, 0.05), ('HazeN', (7, 16, 1.5), EMBER, 0.05)):
        bpy.ops.mesh.primitive_plane_add(size=40, location=loc, rotation=(math.radians(90), 0, 0)); hz = bpy.context.active_object
        hm = bpy.data.materials.new(nm); hm.use_nodes = True; hn = hm.node_tree; hn.nodes.clear()
        htc = hn.nodes.new('ShaderNodeTexCoord'); hgr = hn.nodes.new('ShaderNodeTexGradient'); hgr.gradient_type = 'SPHERICAL'
        hmp = hn.nodes.new('ShaderNodeMapping'); hmp.inputs['Scale'].default_value = (0.06, 0.06, 0.06)
        hpw = hn.nodes.new('ShaderNodeMath'); hpw.operation = 'POWER'; hpw.inputs[1].default_value = 3.0
        hmu = hn.nodes.new('ShaderNodeMath'); hmu.operation = 'MULTIPLY'; hmu.inputs[1].default_value = e
        hem = hn.nodes.new('ShaderNodeEmission'); hem.inputs['Color'].default_value = (*col, 1); ho = hn.nodes.new('ShaderNodeOutputMaterial')
        hn.links.new(htc.outputs['Object'], hmp.inputs['Vector']); hn.links.new(hmp.outputs['Vector'], hgr.inputs['Vector'])
        hn.links.new(hgr.outputs['Fac'], hpw.inputs[0]); hn.links.new(hpw.outputs[0], hmu.inputs[0]); hn.links.new(hmu.outputs[0], hem.inputs['Strength'])
        hn.links.new(hem.outputs[0], ho.inputs['Surface']); hz.data.materials.append(hm); HAZE[nm] = hmu.inputs[1]
    return HAZE
