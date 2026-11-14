"""The one world "THE SIGNAL" happens in, shared by every scene so the camera can travel between
scenes without anything changing: the dark lattice floor (orange, then split SCOUT-cyan / NEXT-orange),
the hazes, SCOUT's ultrawide workstation on its desk, NEXT's phone, and their lights.

Coordinates are the hook's: the waveform stands at y=15; the far side is centred on P0.
"""
import math, os
from scout3d import *
from phone2 import build_phone2
from mathutils import Vector

P0 = Vector((0, 24.0, 0.8))
MON = P0 + Vector((-0.5, 0.6, 0.6))                    # SCOUT's workstation (screen centre)
PHN = P0 + Vector((0.5, -1.55, -0.5))                  # NEXT's phone, on the far side
FLOOR_Z = -1.25
UW_W = 2.8; UW_ASPECT = 4201 / 1800; UW_H = UW_W / UW_ASPECT
# the hook's closing pose (shared by Hook A/B/C and the SCOUT scene, so the cut at frame 90 is exact):
# the two products turn toward the viewer and the camera comes in close
MON_YAW = (math.radians(30), math.radians(8))
PHN_ROT = ((math.radians(4), 0, math.radians(-34)), (math.radians(2), 0, math.radians(-8)))
def hook_cam_keys(wide):
    """(frame, location, target, focus, fstop, lens) for frames 62, 90, 105 of every hook."""
    c62 = ((0.0, 15.2, 0.65), (0.0, 23.0, 0.75), (0.0, 23.0, 0.75), 5.6, 28)
    if wide:
        return [(62,) + c62, (90, (0.1, 19.9, 0.92), tuple(P0 + Vector((0, 0, 0.08))), tuple(P0), 5.6, 30),
                (105, (0.11, 20.1, 0.93), tuple(P0 + Vector((0, 0, 0.08))), tuple(P0), 5.6, 30)]
    return [(62,) + c62, (90, (0.15, 20.0, 0.95), tuple(P0 + Vector((0, 0, 0.12))), tuple(P0), 5.6, 28),
            (105, (0.17, 20.25, 0.96), tuple(P0 + Vector((0, 0, 0.12))), tuple(P0), 5.6, 28)]

def build_uw_monitor(name, states, width=UW_W, aspect=UW_ASPECT, glow=1.2):
    """scout3d.build_monitor, ultrawide (the same parts: thin bezel, chrome lip, matte screen with the
    real SCOUT capture, ribbed back, brushed arm and base). Returns (root, screen)."""
    W, H = width, width / aspect
    B = 0.05
    root = link(bpy.data.objects.new(name, None))
    hold = link(bpy.data.objects.new(name + '_hold', None)); hold.parent = root; hold.rotation_euler = (math.radians(90), 0, 0)
    metal = brushed(name + '_metal')
    chrome = principled(name + '_chrome', (0.75, 0.77, 0.8), metallic=1.0, rough=0.12)
    black = principled(name + '_black', (0.006, 0.006, 0.007), rough=0.35)
    def P(ob, z=0.0, loc=None, rot=None):
        ob.parent = hold; ob.location = loc if loc else (0, 0, z)
        if rot: ob.rotation_euler = rot
        return ob
    P(rounded_slab(name + '_body', W + 2 * B, H + 2 * B, 0.06, depth=0.045, bevel=0.012, mat=metal))
    P(rounded_slab(name + '_lip', W + 2 * B - 0.01, H + 2 * B - 0.01, 0.056, depth=0.003, bevel=0.004, mat=chrome), 0.045)
    P(rounded_slab(name + '_bezel', W + 0.03, H + 0.03, 0.02, depth=0.002, mat=black), 0.055)
    scr = rounded_mesh(name + '_screen', W, H, 0.012, mat=screen_material(name + '_screen', states, glow))
    sb = next(n for n in scr.data.materials[0].node_tree.nodes if n.type == 'BSDF_PRINCIPLED')
    sb.inputs['Roughness'].default_value = 0.32
    sb.inputs['Coat Weight'].default_value = 0.25; sb.inputs['Coat Roughness'].default_value = 0.2
    P(scr, 0.061)
    P(rounded_slab(name + '_back', W * 0.55, H * 0.62, 0.1, depth=0.05, bevel=0.02, mat=metal), -0.08)
    for i in range(9):
        P(rounded_slab(name + f'_rib{i}', W * 0.45, 0.016, 0.007, depth=0.009, mat=black), loc=(0, -H * 0.24 + i * H * 0.06, -0.14))
    P(rounded_slab(name + '_arm', 0.2, H * 0.9, 0.05, depth=0.035, bevel=0.012, mat=metal), loc=(0, -H * 0.45, -0.18))
    P(rounded_slab(name + '_base', W * 0.26, 0.8, 0.16, depth=0.022, bevel=0.012, mat=metal), loc=(0, -H * 0.9 - 0.03, -0.42),
      rot=(math.radians(90), 0, 0))
    return root, scr

def compact_frames(sc):
    """Write each frame as half-float EXR (DWAA, visually lossless; ~10x smaller than Radiance HDR) under
    the same f####.hdr name the toolkit uses; post5.py reads it by content."""
    s_ = sc.render.image_settings
    s_.file_format = 'OPEN_EXR'; s_.color_depth = '16'; s_.exr_codec = 'DWAA'
    sc.render.use_file_extension = False

def screen_bsdf(scr): return next(n for n in scr.data.materials[0].node_tree.nodes if n.type == 'BSDF_PRINCIPLED')

def L_(name, loc, tgt, size, color, pairs, size_y=None):
    ob = look_light(name, tuple(loc), tuple(tgt), size, 0.0, color=color, size_y=size_y); key_energy(ob, pairs); return ob

def group(name, roots):
    g = bpy.data.collections.new(name)
    for r in roots:
        for ob in [r] + list(r.children_recursive):
            if ob.type in ('MESH', 'CURVE'): g.objects.link(ob)
    return g

def haze(name, loc, col, pairs, size=40, radius=8.0):
    bpy.ops.mesh.primitive_plane_add(size=size, location=loc, rotation=(math.radians(90), 0, 0)); hz = bpy.context.active_object
    hm = bpy.data.materials.new(name); hm.use_nodes = True; hn = hm.node_tree; hn.nodes.clear()
    htc = hn.nodes.new('ShaderNodeTexCoord'); hgr = hn.nodes.new('ShaderNodeTexGradient'); hgr.gradient_type = 'SPHERICAL'
    hmp = hn.nodes.new('ShaderNodeMapping'); hmp.inputs['Scale'].default_value = (1.0 / radius,) * 3
    hpw = hn.nodes.new('ShaderNodeMath'); hpw.operation = 'POWER'; hpw.inputs[1].default_value = 3.0
    hmu = hn.nodes.new('ShaderNodeMath'); hmu.operation = 'MULTIPLY'
    hem = hn.nodes.new('ShaderNodeEmission'); hem.inputs['Color'].default_value = (*col, 1); ho = hn.nodes.new('ShaderNodeOutputMaterial')
    hn.links.new(htc.outputs['Object'], hmp.inputs['Vector']); hn.links.new(hmp.outputs['Vector'], hgr.inputs['Vector'])
    hn.links.new(hgr.outputs['Fac'], hpw.inputs[0]); hn.links.new(hpw.outputs[0], hmu.inputs[0]); hn.links.new(hmu.outputs[0], hem.inputs['Strength'])
    hn.links.new(hem.outputs[0], ho.inputs['Surface']); hz.data.materials.append(hm); key_val(hmu.inputs[1], pairs)
    hz.visible_glossy = False
    return hz, hmu.inputs[1]

def build_floor(LIT):
    """The dark glossy lattice: all orange until LIT, then cyan to the left of x≈0, orange to the right."""
    bpy.ops.mesh.primitive_plane_add(size=160, location=(0, 20, FLOOR_Z)); fl = bpy.context.active_object
    fm = principled('Floor', (0.006, 0.006, 0.007), rough=0.16, coat=0.5); nt = fm.node_tree; fb = nt.nodes['Principled BSDF']
    tc = nt.nodes.new('ShaderNodeTexCoord'); sep = nt.nodes.new('ShaderNodeSeparateXYZ'); nt.links.new(tc.outputs['Object'], sep.inputs[0])
    def nm_(op, a, b=None):
        x = nt.nodes.new('ShaderNodeMath'); x.operation = op
        for i, v in enumerate((a, b)):
            if v is None: continue
            if isinstance(v, (int, float)): x.inputs[i].default_value = v
            else: nt.links.new(v, x.inputs[i])
        return x.outputs[0]
    def gline(coord, period=1.0, width=0.01):
        f = nm_('FRACT', nm_('DIVIDE', coord, period)); d = nm_('MINIMUM', f, nm_('SUBTRACT', 1.0, f))
        return nm_('LESS_THAN', d, width / period)
    grid = nm_('MAXIMUM', gline(sep.outputs['X']), gline(sep.outputs['Y']))
    fade = nm_('POWER', nm_('MAXIMUM', nm_('SUBTRACT', 1.0, nm_('DIVIDE', nm_('ABSOLUTE', sep.outputs['Y']), 30.0)), 0.0), 2.0)
    mixc = nt.nodes.new('ShaderNodeMix'); mixc.data_type = 'RGBA'
    mixc.inputs['B'].default_value = (*EMBER_HOT, 1)
    key_color(mixc.inputs['A'], [(LIT - 4, EMBER_HOT), (LIT + 14, CYAN)])
    nt.links.new(nm_('MINIMUM', nm_('MAXIMUM', nm_('DIVIDE', nm_('ADD', sep.outputs['X'], 0.35), 0.7), 0.0), 1.0), mixc.inputs['Factor'])
    nt.links.new(mixc.outputs['Result'], fb.inputs['Emission Color'])
    gs = nm_('MULTIPLY', grid, fade); gmul = nt.nodes.new('ShaderNodeMath'); gmul.operation = 'MULTIPLY'
    nt.links.new(gs, gmul.inputs[0]); key_val(gmul.inputs[1], [(1, 0.35), (LIT - 4, 0.25), (LIT + 14, 0.6)])
    nt.links.new(gmul.outputs[0], fb.inputs['Emission Strength'])
    fl.data.materials.append(fm)
    return fl, gmul.inputs[1], mixc

def build_world(S, LIT, appear, mon_states, phone_states):
    """Everything on the far side. LIT: the frame the two products light up; appear: the first frame
    they are rendered (they are hidden while the chart fills the frame)."""
    fl, floor_glow, floor_mix = build_floor(LIT)
    hz_s, hz_s_v = haze('HazeS', (-3.2, 33, 1.2), CYAN, [(LIT - 6, 0.0), (LIT + 14, 0.45)], size=30, radius=5.0)
    hz_n, hz_n_v = haze('HazeN', (3.2, 33, 0.2), EMBER, [(LIT - 6, 0.0), (LIT + 14, 0.16)], size=30, radius=5.0)
    # SCOUT: the ultrawide on a brushed desk with a cyan edge light, a dark pedestal under it
    mon, mscr = build_uw_monitor('Workstation', mon_states, glow=0.0)
    mon.location = MON
    keys(mon, 'rotation_euler', [(LIT - 6, (0, 0, MON_YAW[0])), (105, (0, 0, MON_YAW[1]))], interp='SINE', easing='EASE_OUT')
    key_val(screen_bsdf(mscr).inputs['Emission Strength'], [(LIT - 6, 0.0), (LIT + 10, 1.15)])
    DESK_Z = MON.z - UW_H * 0.9 - 0.03 - 0.03
    desk = rounded_slab('Desk', 4.4, 1.5, 0.08, depth=0.03, bevel=0.012, mat=brushed('DeskMetal', (0.035, 0.037, 0.042), scale=(6.0, 900.0, 6.0)))
    desk.location = (MON.x, MON.y + 0.3, DESK_Z)
    ped = rounded_slab('Pedestal', 3.2, 0.9, 0.05, depth=(DESK_Z - FLOOR_Z) / 2, mat=principled('PedestalBlack', (0.01, 0.011, 0.013), rough=0.3, coat=0.4))
    ped.location = (MON.x, MON.y + 0.45, (DESK_Z + FLOOR_Z) / 2)
    edge_m, edge_e = emissive('DeskEdge', CYAN, 0.0); key_val(edge_e.inputs['Strength'], [(LIT - 2, 0.0), (LIT + 14, 2.4)])
    bpy.ops.mesh.primitive_cube_add(size=1, location=(MON.x, MON.y + 0.3 - 0.75, DESK_Z + 0.005)); de = bpy.context.active_object
    de.scale = (4.3, 0.01, 0.01); de.data.materials.append(edge_m)
    station = [mon, desk, ped, de]
    # NEXT: the phone
    phone, pscr = build_phone2('Phone', phone_states, screen_glow=0.0)
    phone.location = PHN; phone.scale = (0.72, 0.72, 0.72)
    keys(phone, 'rotation_euler', [(LIT - 6, PHN_ROT[0]), (105, PHN_ROT[1])], interp='SINE', easing='EASE_OUT')
    key_val(screen_bsdf(pscr).inputs['Emission Strength'], [(LIT - 6, 0.0), (LIT + 10, 1.0)])
    for r in station + [phone]:
        visible(r, [(appear, 100000)])
        for ob in r.children_recursive: visible(ob, [(appear, 100000)])
    # lights
    lights = dict(
        ScoutKey=L_('ScoutKey', MON + Vector((-1.8, -2.6, 2.2)), MON, 1.8, (0.72, 0.88, 1.0), [(LIT - 4, 0.0), (LIT + 12, 120.0)]),
        ScoutRim=L_('ScoutRim', MON + Vector((-1.2, 1.6, 1.0)), MON, 0.2, CYAN, [(LIT - 4, 0.0), (LIT + 12, 420.0)], size_y=3.0),
        NextKey=L_('NextKey', PHN + Vector((1.4, -2.2, 1.6)), PHN, 1.2, (1.0, 0.9, 0.8), [(LIT - 4, 0.0), (LIT + 12, 45.0)]),
        NextRim=L_('NextRim', PHN + Vector((1.2, 1.4, 0.5)), PHN, 0.2, EMBER, [(LIT - 4, 0.0), (LIT + 12, 240.0)], size_y=3.0),
    )
    for nm, loc, col in (('PoolS', MON, CYAN), ('PoolN', PHN, EMBER)):
        sp_d = bpy.data.lights.new(nm, 'SPOT'); sp_d.spot_size = math.radians(34); sp_d.spot_blend = 0.7; sp_d.color = col
        spo = link(bpy.data.objects.new(nm, sp_d)); spo.location = (loc.x, loc.y, 4.5)
        key_energy(spo, [(LIT - 4, 0.0), (LIT + 14, 900.0)]); lights[nm] = spo
    return dict(fl=fl, floor_glow=floor_glow, floor_mix=floor_mix, hz_s=hz_s_v, hz_n=hz_n_v, mon=mon, mscr=mscr, desk=desk, ped=ped,
                desk_edge=edge_e, station=station, phone=phone, pscr=pscr, lights=lights)

def build_architecture(floor_z, y0, y1, scout_xs, next_xs, back_y, on_pairs, ceil_z=8.5, appear=1, back_span=(-15.0, 17.0), split_x=1.0,
                       extra=(), wall_gain=0.45):
    """The space the products live in: a hall of brushed-metal monoliths with light strips — cyan in SCOUT's
    half, orange in NEXT's — a data wall at the far end in each colour, and light rails overhead.
    on_pairs keys the strips' brightness (0 = dark). Returns the emission sockets so a scene can retime them."""
    metal = brushed('MonolithMetal', (0.012, 0.013, 0.015), rough=(0.34, 0.5), scale=(6.0, 6.0, 900.0))   # dark satin: it frames, never glares
    sock = {}
    for side, xs, col, nm in (('S', scout_xs, CYAN, 'Scout'), ('N', next_xs, EMBER_HOT, 'Next')):
        sm, se = emissive(f'{nm}Strip', col, 0.0); key_val(se.inputs['Strength'], [(f, v * (1.0 if side == 'S' else 0.9)) for f, v in on_pairs]); sock[side] = se
        h = ceil_z - floor_z
        for x in xs:
            face = 1 if x < split_x else -1                      # strips face the middle of the space
            y = y0
            while y <= y1:
                bpy.ops.mesh.primitive_cube_add(size=1, location=(x, y, floor_z + h / 2)); pl = bpy.context.active_object
                pl.scale = (0.5, 0.5, h); pl.data.materials.append(metal)
                bpy.ops.mesh.primitive_cube_add(size=1, location=(x + face * 0.252, y, floor_z + h / 2)); st = bpy.context.active_object
                st.scale = (0.004, 0.035, h * 0.92); st.data.materials.append(sm)
                for ob in (pl, st): visible(ob, [(appear, 100000)])
                y += 3.6
        for (ex, ey, es) in extra:                                # rows facing the cameras: behind each product
            if es != side: continue
            bpy.ops.mesh.primitive_cube_add(size=1, location=(ex, ey, floor_z + h / 2)); pl = bpy.context.active_object
            pl.scale = (0.5, 0.5, h); pl.data.materials.append(metal)
            bpy.ops.mesh.primitive_cube_add(size=1, location=(ex, ey - 0.252, floor_z + h / 2)); st = bpy.context.active_object
            st.scale = (0.035, 0.004, h * 0.92); st.data.materials.append(sm)
            for ob in (pl, st): visible(ob, [(appear, 100000)])
        # the data wall: horizontal light lines at the far end of this half
        x_a, x_b = (back_span[0], split_x - 0.5) if side == 'S' else (split_x + 0.5, back_span[1])
        bpy.ops.mesh.primitive_plane_add(size=1, location=((x_a + x_b) / 2, back_y, floor_z + (ceil_z - floor_z) / 2), rotation=(math.radians(90), 0, 0))
        wl = bpy.context.active_object; wl.scale = (x_b - x_a, ceil_z - floor_z, 1)
        wm = bpy.data.materials.new(f'{nm}DataWall'); wm.use_nodes = True; wn = wm.node_tree; wn.nodes.clear()
        tc = wn.nodes.new('ShaderNodeTexCoord'); wave = wn.nodes.new('ShaderNodeTexWave'); wave.wave_type = 'BANDS'; wave.bands_direction = 'Y'
        wave.inputs['Scale'].default_value = 34.0; wave.inputs['Distortion'].default_value = 0.0
        ramp = wn.nodes.new('ShaderNodeValToRGB'); ramp.color_ramp.elements[0].position = 0.9; ramp.color_ramp.elements[0].color = (0, 0, 0, 1)
        ramp.color_ramp.elements[1].position = 0.97; ramp.color_ramp.elements[1].color = (1, 1, 1, 1)
        noise = wn.nodes.new('ShaderNodeTexNoise'); noise.inputs['Scale'].default_value = 3.0
        mul = wn.nodes.new('ShaderNodeMath'); mul.operation = 'MULTIPLY'
        em = wn.nodes.new('ShaderNodeEmission'); em.inputs['Color'].default_value = (*col, 1)
        k_ = wn.nodes.new('ShaderNodeMath'); k_.operation = 'MULTIPLY'
        out = wn.nodes.new('ShaderNodeOutputMaterial')
        wn.links.new(tc.outputs['Generated'], wave.inputs['Vector']); wn.links.new(wave.outputs['Fac'], ramp.inputs['Fac'])
        wn.links.new(tc.outputs['Generated'], noise.inputs['Vector'])
        wn.links.new(ramp.outputs['Color'], mul.inputs[0]); wn.links.new(noise.outputs['Fac'], mul.inputs[1])
        wn.links.new(mul.outputs[0], k_.inputs[0]); key_val(k_.inputs[1], [(f, v * wall_gain) for f, v in on_pairs])
        wn.links.new(k_.outputs[0], em.inputs['Strength']); wn.links.new(em.outputs[0], out.inputs['Surface'])
        wl.data.materials.append(wm); wl.visible_glossy = False; visible(wl, [(appear, 100000)])
        sock['wall' + side] = k_.inputs[1]
        # overhead light rails running the length of the hall
        for i, x in enumerate((x_a + (x_b - x_a) * f for f in (0.25, 0.5, 0.75))):
            bpy.ops.mesh.primitive_cube_add(size=1, location=(x, (y0 + y1) / 2 + 4, ceil_z - 0.2)); rl = bpy.context.active_object
            rl.scale = (0.05, (y1 - y0) + 14, 0.03); rl.data.materials.append(sm); visible(rl, [(appear, 100000)])
    return sock

# monolith rows behind the products, where the cameras look (clear of the corridor and the chart)
BEHIND = [(x, y, 'S') for x in (-3.6, -1.8, 0.0) for y in (32.5, 36.1)] + [(x, y, 'N') for x in (4.6, 6.4, 8.2, 10.0) for y in (35.4, 39.0)]

def link_lights(W, extra_floor_only=()):
    """Each product takes only its own colour; keys and rims skip the glossy floor (no light-shaped glints)."""
    for ob in bpy.data.objects:
        if ob.type == 'LIGHT': ob.visible_camera = False
    scout_g, next_g = group('ScoutObjs', W['station']), group('NextObjs', [W['phone']])
    scout_fx, next_fx = group('NotScout', [W['phone']]), group('NotNext', W['station'])
    for g in (scout_fx, next_fx): g.objects.link(W['fl'])
    floor_g = bpy.data.collections.new('FloorOnly'); floor_g.objects.link(W['fl'])
    for nm, g in [(n, floor_g) for n in extra_floor_only] + [('ScoutKey', scout_fx), ('ScoutRim', scout_fx), ('PoolS', next_g),
                                                             ('NextKey', next_fx), ('NextRim', next_fx), ('PoolN', scout_g)]:
        bpy.data.objects[nm].light_linking.receiver_collection = g
        for co in g.collection_objects: co.light_linking.link_state = 'EXCLUDE'
    return floor_g
