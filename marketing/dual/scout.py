"""SCOUT × NEXT — "BEFORE THE BREAKOUT": THE HOOK + MEET SCOUT (0–10 s, global frames 1–300).
Ends exactly where transition.py (frames 301–540) begins: same set, same camera.

  1–120    a single thin cyan waveform in the dark, moving from frame 1 and driven by the score;
           the camera tracks along it; the line splits into the lattice that becomes the floor of
           the SCOUT workspace, which lights up around it
  121–165  the main monitor turns into frame and wakes on SCOUT's roster (lifecycle stages)
  178–212  New Candidates: Juno Marrow, a fan submission; the cursor clicks Approve (a person does)
  214–265  the scout's rating: 8 categories by hand, with their weights → 86.0
  266–300  her evaluated profile; the camera pulls back to the wide shot transition.py starts on

  blender-venv/bin/python scout.py -- --assets DIR [--hook wide] [--preview|--gpu] [--frames a-b|--list ...] [--out DIR]
"""
import json, math, os, random, sys
HERE = os.path.dirname(os.path.abspath(__file__))
for p in (HERE, os.path.join(HERE, '..', 'commercial2'), os.path.join(HERE, '..', 'commercial')):
    if p not in sys.path: sys.path.insert(0, p)
from scout3d import *
from set4 import build_set, build_haze, MW, MH, MZ
from mathutils import Vector

random.seed(1)
END = 300
sc = init(END, samples=64)
WIDE = arg('--hook') == 'wide'
if WIDE: sc.render.resolution_x, sc.render.resolution_y = 1920, 1080
S = lambda n: os.path.join(ASSETS, n)
ENV = json.load(open(S('env.json')))
WAKE, QUEUE, CLICK, RATE, PROFILE = 150, 178, 210, 218, 266

# ---------------------------------------------------------------- the set (identical to transition.py's)
states = [(S('s01-roster.png'), 1, 'cut'), (S('s02-queue.png'), QUEUE, 'up'),
          (S('scout-scores-screen.png'), RATE, 'up'), (S('scout-profile-screen.png'), PROFILE, 'fade')]
SET = build_set(S, states); mon, mscr = SET['mon'], SET['mscr']
HAZE = build_haze()
key_val(HAZE['HazeS'], [(1, 0.0), (90, 0.0), (150, 0.05)]); key_val(HAZE['HazeN'], [(1, 0.0), (90, 0.0), (150, 0.05)])
msb = next(n for n in mscr.data.materials[0].node_tree.nodes if n.type == 'BSDF_PRINCIPLED')
key_val(msb.inputs['Emission Strength'], [(1, 0.0), (WAKE - 1, 0.0), (WAKE + 3, 1.7), (WAKE + 14, 1.2)])
# the monitor turns into frame as the workspace appears
keys(mon, 'location', [(118, (1.6, 1.4, MZ)), (WAKE + 6, (0, 0, MZ))], interp='SINE', easing='EASE_OUT')
keys(mon, 'rotation_euler', [(118, (0, 0, math.radians(68))), (WAKE + 6, (0, 0, 0))], interp='SINE', easing='EASE_OUT')
# the side monitors and the desk edge come on with the room
for ob in bpy.data.objects:
    if ob.name.startswith(('MonL_screen', 'MonB_screen')):
        b_ = next(n for n in ob.data.materials[0].node_tree.nodes if n.type == 'BSDF_PRINCIPLED')
        key_val(b_.inputs['Emission Strength'], [(1, 0.0), (125, 0.0), (165, 0.75)])
key_val(SET['edge'].inputs['Strength'], [(1, 0.0), (100, 0.0), (130, 2.2)])
fmix = next(n for n in SET['floor_mat'].node_tree.nodes if n.type == 'MATH' and n.operation == 'MULTIPLY' and abs(n.inputs[1].default_value - 0.55) < 1e-6)
key_val(fmix.inputs[1], [(1, 0.0), (78, 0.0), (125, 0.55)])            # the lattice lights up as the line splits into it

# ---------------------------------------------------------------- the waveform (cyan, driven by the score)
WY, WZ = -3.2, 1.62
def wave_tree(name):
    ng = bpy.data.node_groups.new(name, 'GeometryNodeTree')
    ng.interface.new_socket('Geometry', in_out='INPUT', socket_type='NodeSocketGeometry')
    ng.interface.new_socket('Geometry', in_out='OUTPUT', socket_type='NodeSocketGeometry')
    for nm in ('Amp', 'Drop', 'Phase', 'Radius'):
        s_ = ng.interface.new_socket(nm, in_out='INPUT', socket_type='NodeSocketFloat'); s_.default_value = 0.0
    N, L = ng.nodes, ng.links; gi, go = N.new('NodeGroupInput'), N.new('NodeGroupOutput')
    def M(op, a, b=None):
        x = N.new('ShaderNodeMath'); x.operation = op
        for i, v in enumerate((a, b)):
            if v is None: continue
            if isinstance(v, (int, float)): x.inputs[i].default_value = v
            else: L.new(v, x.inputs[i])
        return x.outputs[0]
    line = N.new('GeometryNodeCurvePrimitiveLine'); line.inputs['Start'].default_value = (-9, 0, 0); line.inputs['End'].default_value = (9, 0, 0)
    rs = N.new('GeometryNodeResampleCurve'); rs.inputs['Count'].default_value = 900; L.new(line.outputs[0], rs.inputs['Curve'])
    pos = N.new('GeometryNodeInputPosition'); sep = N.new('ShaderNodeSeparateXYZ'); L.new(pos.outputs[0], sep.inputs[0])
    x = sep.outputs['X']; t = N.new('GeometryNodeInputSceneTime').outputs['Seconds']; ph = gi.outputs['Phase']
    w = M('ADD', M('MULTIPLY', M('SINE', M('ADD', M('ADD', M('MULTIPLY', x, 2.1), M('MULTIPLY', t, 3.4)), ph)), 0.6),
          M('MULTIPLY', M('SINE', M('SUBTRACT', M('MULTIPLY', x, 5.3), M('MULTIPLY', t, 5.1))), 0.25))
    nz = N.new('ShaderNodeTexNoise'); nz.noise_dimensions = '2D'; nz.inputs['Scale'].default_value = 1.4
    cv = N.new('ShaderNodeCombineXYZ'); L.new(M('ADD', x, M('MULTIPLY', t, 0.8)), cv.inputs[0]); L.new(ph, cv.inputs[1]); L.new(cv.outputs[0], nz.inputs['Vector'])
    w = M('ADD', w, M('MULTIPLY', M('SUBTRACT', nz.outputs['Fac'], 0.5), 0.9))
    taper = M('POWER', M('MAXIMUM', M('SUBTRACT', 1.0, M('ABSOLUTE', M('DIVIDE', x, 9.0))), 0.0), 0.6)
    z = M('SUBTRACT', M('MULTIPLY', M('MULTIPLY', w, taper), gi.outputs['Amp']), gi.outputs['Drop'])
    cp = N.new('ShaderNodeCombineXYZ'); L.new(x, cp.inputs[0]); L.new(z, cp.inputs[2])
    sp = N.new('GeometryNodeSetPosition'); L.new(rs.outputs[0], sp.inputs['Geometry']); L.new(cp.outputs[0], sp.inputs['Position'])
    circ = N.new('GeometryNodeCurvePrimitiveCircle'); circ.inputs['Resolution'].default_value = 8; L.new(gi.outputs['Radius'], circ.inputs['Radius'])
    c2m = N.new('GeometryNodeCurveToMesh'); L.new(sp.outputs[0], c2m.inputs['Curve']); L.new(circ.outputs[0], c2m.inputs['Profile Curve'])
    sm = N.new('GeometryNodeSetMaterial'); L.new(c2m.outputs[0], sm.inputs['Geometry']); L.new(sm.outputs[0], go.inputs[0])
    return ng, sm
ng, wsm = wave_tree('Wave')
ident = {it.name: it.identifier for it in ng.interface.items_tree if getattr(it, 'in_out', '') == 'INPUT'}
main_m, main_e = emissive('WaveMain', CYAN_HOT, 7.0); wsm.inputs['Material'].default_value = main_m
def amp_at(f): return 0.05 + 0.38 * ENV[min(f - 1, len(ENV) - 1)]
waves = []
for k in range(13):                                   # k=0: the line; 1..12: the copies that split off and fall into the lattice
    ob = link(bpy.data.objects.new(f'Wave{k}', bpy.data.meshes.new(f'Wave{k}'))); ob.location = (0, WY + (k - 6.5) * 0.0 if k == 0 else WY, WZ)
    md = ob.modifiers.new('Wave', 'NODES'); md.node_group = ng if k == 0 else ng.copy()
    if k:
        for n in md.node_group.nodes:
            if n.type == 'SET_MATERIAL':
                m_, e_ = emissive(f'WaveCopy{k}', CYAN, 0.0); n.inputs['Material'].default_value = m_
                key_val(e_.inputs['Strength'], [(70, 0.0), (76 + k, 3.0), (112 + k, 0.0)])
    md[ident['Phase']] = 0.6 * k; md[ident['Radius']] = 0.009 if k == 0 else 0.004
    for f in range(1, 141):
        md[ident['Amp']] = amp_at(f) * (1.0 if k == 0 else max(0.0, 1 - (f - 72) / 40))
        md[ident['Drop']] = 0.0 if (k == 0 or f < 72) else (WZ - SET['FLOOR_Z']) * min(1.0, ((f - 72 - k) / 40) ** 2) if f > 72 + k else 0.0
        ob.keyframe_insert(f'modifiers["Wave"]["{ident["Amp"]}"]', frame=f)
        ob.keyframe_insert(f'modifiers["Wave"]["{ident["Drop"]}"]', frame=f)
    if k:                                            # each copy fans out in depth while it falls
        keys(ob, 'location', [(72, (0, WY, WZ)), (118, (0, WY + (k - 6.5) * 1.2, WZ))], interp='SINE', easing='EASE_IN_OUT')
    waves.append(ob)
key_val(main_e.inputs['Strength'], [(1, 7.0), (96, 7.0), (128, 0.0)])
visible(waves[0], [(1, 132)])
for w_ in waves[1:]: visible(w_, [(70, 125)])

# ---------------------------------------------------------------- the cursor and the click on Approve
cur_m, cur_e = emissive('Cursor', (1, 1, 1), 2.4)
cu = bpy.data.curves.new('CursorShape', 'CURVE'); cu.dimensions = '2D'; cu.fill_mode = 'BOTH'
spl = cu.splines.new('POLY'); arrow = [(0, 0), (0, -0.115), (0.03, -0.088), (0.052, -0.135), (0.07, -0.127), (0.048, -0.081), (0.085, -0.081)]
spl.points.add(len(arrow) - 1)
for i, (x, y) in enumerate(arrow): spl.points[i].co = (x, y, 0, 1)
spl.use_cyclic_u = True
cursor = link(bpy.data.objects.new('Cursor', cu)); cursor.data.materials.append(cur_m); cursor.parent = mscr
def on_screen(u, v, lift=0.004): return ((u - 0.5) * MW, (0.5 - v) * MH, lift)
APPROVE = (0.828, 0.637)                              # Juno's Approve button on the New Candidates capture
keys(cursor, 'location', [(QUEUE + 8, on_screen(0.62, 0.5)), (CLICK - 3, on_screen(*APPROVE)), (RATE - 1, on_screen(*APPROVE))], interp='SINE', easing='EASE_IN_OUT')
visible(cursor, [(QUEUE + 8, RATE - 1)])
rp_m, rp_e = glow_material('ClickRing', CYAN_HOT, 0.0)
ring = rounded_mesh('ClickRing', 0.09, 0.09, 0.0449, mat=rp_m); ring.parent = mscr; ring.location = on_screen(*APPROVE, 0.005)
for f, s_, st in ((CLICK - 1, 0.3, 0.0), (CLICK, 0.6, 2.5), (CLICK + 8, 1.8, 0.0)):
    ring.scale = (s_, s_, s_); ring.keyframe_insert('scale', frame=f); rp_e.inputs['Strength'].default_value = st; rp_e.inputs['Strength'].keyframe_insert('default_value', frame=f)
visible(ring, [(CLICK - 1, CLICK + 9)])

# ---------------------------------------------------------------- light (the room comes up after the hook)
skey = look_light('ScoutKey', (-3.2, -3.4, 4.6), (0, 0, MZ), 3.0, 0.0, color=(0.78, 0.9, 1.0))
srim = look_light('ScoutRim', (2.6, 2.2, 3.4), (0, 0, MZ), 1.2, 0.0, color=CYAN, size_y=4.0)
sfill = look_light('ScoutFill', (3.8, -3.0, 1.0), (0, 0, MZ), 2.0, 0.0, color=(0.6, 0.8, 1.0))
for l, e in ((skey, 260), (srim, 340), (sfill, 40)): key_energy(l, [(1, 0.0), (100, 0.0), (150, e)])
wl = bpy.data.lights.new('WaveGlow', 'AREA'); wl.shape = 'RECTANGLE'; wl.size, wl.size_y = 12.0, 0.1; wl.color = CYAN
wgl = link(bpy.data.objects.new('WaveGlow', wl)); wgl.location = (0, WY, WZ - 0.05); wgl.rotation_euler = (math.pi, 0, 0)
key_energy(wgl, [(1, 30.0), (100, 30.0), (130, 0.0)])
for ob in bpy.data.objects:
    if ob.type == 'LIGHT': ob.visible_camera = False

# ---------------------------------------------------------------- camera (lens and end pose match transition.py frame 1)
cam = Camera(lens=35, fstop=2.8)
cam.key(1, (-6.4, -4.9, 1.72), (-3.6, WY, WZ), (-4.2, WY, WZ), 2.0)
cam.key(60, (-2.6, -4.8, 1.76), (0.4, WY, WZ), (-1.2, WY, WZ))
cam.key(112, (0.8, -9.2, 2.9), (0, -1.6, 1.0), (0, WY, WZ), 2.8)
cam.key(WAKE, (1.5, -7.2, 1.95), (0, 0, MZ), (0, -0.07, MZ), 2.8)
cam.key(172, (0.6, -4.7, 1.75), (-0.1, 0, MZ + 0.22), (-0.1, -0.07, MZ + 0.22), 6.0)       # the roster: stages
JZ = MZ + (0.5 - 0.66) * MH                                                                    # Juno's row in the queue
cam.key(188, (-0.55, -2.95, JZ + 0.12), (-0.75, 0, JZ), (-0.75, -0.07, JZ))                 # her name, 'Fan submission', the pitch
cam.key(197, (-0.45, -2.9, JZ + 0.11), (-0.62, 0, JZ), (-0.62, -0.07, JZ))
cam.key(CLICK - 3, (1.2, -2.9, JZ + 0.1), (1.05, 0, JZ), (1.05, -0.07, JZ))                 # Pass · Watch · Approve
cam.key(CLICK + 5, (1.25, -2.85, JZ + 0.1), (1.08, 0, JZ), (1.08, -0.07, JZ))
cam.key(RATE + 8, (0.25, -3.6, MZ + 0.12), (0, 0, MZ + 0.02), (0, -0.07, MZ))               # the rating, held
cam.key(PROFILE - 2, (-0.1, -3.3, MZ + 0.08), (0, 0, MZ), (0, -0.07, MZ))
cam.key(PROFILE + 10, (0.2, -4.6, MZ + 0.25), (0, 0, MZ + 0.1), (0, -0.07, MZ), 4.0)
cam.key(END, (2.2, -11.0, 2.3), (0, 0, MZ + 0.05), (0, -0.07, MZ), 2.8)
cam.smooth(); cam.bind(1)
if arg('--save'): bpy.ops.file.pack_all()             # editable .blend: images packed inside, opens anywhere
render(os.path.join(HERE, 'frames_scout'))
