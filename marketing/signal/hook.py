"""NEXT × SCOUT — "THE SIGNAL": Hook A, 0:00–0:03 (frames 1–90, with a handle to 105).

  frame  time
  1      0.00  already moving: the camera rushes low through a huge orange 3D market chart (metal
               tubes with lit nodes over smoked-glass volume bars). Title: THIS ISN'T A STOCK.
  20–40        the chart comes apart: each line lifts off its bars, folds forward and re-forms as a
               strand of an audio waveform; the glass bars swing round and become the waveform's
               bars; thousands of orange particles stream along with them
  40     1.33  the waveform locks (impact). Title: IT'S AN ARTIST. It pulses on the beat.
  50–62        the centre of the waveform opens; the camera goes through it
  58–90  2–3   on the far side the world splits: SCOUT's cyan workstation (left) with the real SCOUT
               queue, NEXT's orange phone (right) with the real NEXT trade panel. Title: SCOUT × NEXT

Everything is procedural (Blender 5 Cycles); the two screens are captures of the real app run on
demo data. Imports the shared toolkit and the dual ad's SCOUT builders read-only.

  blender-venv/bin/python hook.py -- --assets DIR [--hook wide] [--preview|--gpu] [--frames a-b|--list ...] [--out DIR]
"""
import math, os, random, sys
HERE = os.path.dirname(os.path.abspath(__file__))
for p in (HERE, os.path.join(HERE, '..', 'dual'), os.path.join(HERE, '..', 'commercial2'), os.path.join(HERE, '..', 'commercial')):
    if p not in sys.path: sys.path.insert(0, p)
from scout3d import *
from phone2 import build_phone2
from mathutils import Vector

random.seed(60)
END = 105
sc = init(END, samples=96, gpu_samples=160)
sc.cycles.transparent_max_bounces = 16
sc.cycles.glossy_bounces = 6; sc.cycles.transmission_bounces = 8
WIDE = arg('--hook') == 'wide'
if WIDE: sc.render.resolution_x, sc.render.resolution_y = 1920, 1080
S = lambda n: os.path.join(ASSETS, n)

LOCK, OPEN0, OPEN1, CROSS, LIT = 40, 47, 58, 62, 52
BEATS = [8 + 16 * i for i in range(7)]                     # 112.5 BPM grid: 8, 24, 40, 56, 72, 88, 104
YW, ZC = 15.0, 0.6                                         # the waveform's plane and centre line
FLOOR_Z = -1.25

# ---------------------------------------------------------------- materials
def tube_mat(name, strength):
    m = principled(name, (0.9, 0.42, 0.2), metallic=1.0, rough=0.22, emission=EMBER_HOT, estr=strength)
    return m, m.node_tree.nodes['Principled BSDF']
line_m, line_b = tube_mat('ChartTube', 3.2)
key_val(line_b.inputs['Emission Strength'], [(1, 3.2), (LOCK - 2, 3.6), (LOCK, 11.0), (LOCK + 6, 4.2)] +
        [(b, 6.5) for b in BEATS if b > LOCK] + [(b + 5, 4.2) for b in BEATS if b > LOCK] + [(OPEN1, 4.0), (78, 1.6), (90, 0.8)])
node_m, node_e = emissive('ChartNode', (1.0, 0.62, 0.34), 12.0)
key_val(node_e.inputs['Strength'], [(18, 12.0), (30, 0.0)])
glass = principled('SmokedGlass', (0.42, 0.30, 0.26), rough=0.06, transmission=1.0, ior=1.45)
gb = glass.node_tree.nodes['Principled BSDF']
gb.inputs['Coat Weight'].default_value = 0.4
edge_m, edge_e = emissive('BarEdge', EMBER_HOT, 5.0)
key_val(edge_e.inputs['Strength'], [(1, 2.5), (LOCK, 9.0), (LOCK + 8, 3.0)] + [(b, 5.0) for b in BEATS if b > LOCK] +
        [(b + 6, 3.0) for b in BEATS if b > LOCK] + [(78, 1.0)])

# ---------------------------------------------------------------- the chart (time runs away from the camera)
LINES_X = [-2.15, -1.5, -0.95, -0.45, 0.45, 0.95, 1.5, 2.15, -1.75, -0.8, 0.8, 1.75]
TIER = [0] * 8 + [1] * 4                                   # 1 = the upper tier, so the chart fills the tall frame

def cam_y(t):
    """The camera's distance along the chart at frame t (matches the camera keys below, roughly)."""
    pts = [(1, -1.8), (24, 6.4), (40, 9.2), (50, 10.2)]
    for (a, ya), (b, yb) in zip(pts, pts[1:]):
        if t <= b: return ya + (yb - ya) * (t - a) / (b - a)
    return pts[-1][1]
N = 120
Y0, Y1 = 3.0, 30.0
wave_x = [-4.4 + 8.8 * i / (N - 1) for i in range(N)]

def envelope(x):
    """An irregular, musical amplitude envelope across the waveform (a phrase: swells and a peak)."""
    g = lambda c, w, a: a * math.exp(-((x - c) / w) ** 2)
    return 0.12 + g(-2.6, 0.9, 0.55) + g(-0.9, 0.6, 0.8) + g(0.35, 0.5, 0.95) + g(1.6, 0.7, 0.6) + g(3.2, 0.8, 0.45)

def wave_z(k, x):
    """Strands in mirrored pairs around the centre line, phase-shifted a little each: one audio waveform
    drawn as a ribbon of lines."""
    side = 1 if k % 2 == 0 else -1; j = k // 2
    return ZC + side * envelope(x) * (1.0 - 0.1 * j) * (0.14 + 0.86 * abs(math.sin(2 * math.pi * x * 0.92 + j * 0.22)))

def open_dz(k, x, amt):
    return (1 if k % 2 == 0 else -1) * amt * math.exp(-(x / 1.15) ** 2)

lines = []
for k, lx in enumerate(LINES_X):
    v, vals = 0.0, []
    for i in range(N):
        v += random.gauss(0.022, 0.09) + (0.05 if random.random() < 0.06 else 0.0)
        vals.append(v)
    lo, hi = min(vals), max(vals)
    pts_c = []
    for i in range(N):
        y = Y0 + (Y1 - Y0) * i / (N - 1)
        z = -0.75 + 0.25 * (k % 3) + (vals[i] - lo) / (hi - lo) * (1.6 + 0.4 * (k % 2)) + TIER[k] * 1.55
        pts_c.append(Vector((lx + 0.06 * math.sin(i * 0.3 + k), y, z)))
    # the strand this line becomes: left-hand lines run left→right, right-hand lines right→left, so no
    # part of any line has to cross in front of the camera on its way
    order = range(N) if lx < 0 else range(N - 1, -1, -1)
    pts_w = [None] * N
    for j, i in enumerate(order):
        x = wave_x[j]; pts_w[i] = Vector((x, YW + 0.05 * (k - 3.5), wave_z(k, x)))
    cu = bpy.data.curves.new(f'Line{k}', 'CURVE'); cu.dimensions = '3D'
    sp = cu.splines.new('POLY'); sp.points.add(N - 1)
    cu.bevel_depth = 0.016; cu.bevel_resolution = 3
    cu.keyframe_insert('bevel_depth', frame=30); cu.bevel_depth = 0.010; cu.keyframe_insert('bevel_depth', frame=LOCK)
    ob = link(bpy.data.objects.new(f'Line{k}', cu)); ob.data.materials.append(line_m)
    for i in range(N):
        pc, pw = pts_c[i], pts_w[i]
        # transformation sweeps from the far end of the chart toward the camera, so the waveform
        # assembles in front of us; each point lifts off, folds forward and lands
        far = i / (N - 1)
        t0 = 19 + (1 - far) * 8 + 0.6 * k
        t1 = min(LOCK - 0.5, t0 + 11)
        mid = pc.lerp(pw, 0.5) + Vector((0.0, 0, 0.45 + 0.25 * TIER[k]))
        if pc.y < cam_y(t0) + 4.0:                         # close to the lens: peel outward, out of frame first
            mid = Vector((pc.x + math.copysign(1.8, lx), pc.y + 3.0, pc.z + 0.5))
        po = pw + Vector((0, 0, open_dz(k, pw.x, 2.3)))
        p = sp.points[i]
        for f, q in ((1, pc), (t0, pc), ((t0 + t1) / 2, mid), (t1, pw), (OPEN0, pw), (OPEN1, po)):
            p.co = (q.x, q.y, q.z, 1); p.keyframe_insert('co', frame=f)
    set_interp(cu, 'BEZIER')
    lines.append((ob, pts_c, pts_w))

# lit nodes on the chart: every 6th point (they hand over to the particles)
for k, (ob, pts_c, pts_w) in enumerate(lines):
    for i in range(3, N, 6):
        bpy.ops.mesh.primitive_uv_sphere_add(radius=0.034, segments=16, ring_count=8, location=pts_c[i])
        nd = bpy.context.active_object; nd.data.materials.append(node_m)
        keys(nd, 'scale', [(1, (1, 1, 1)), (20 + (1 - i / (N - 1)) * 9, (1, 1, 1)), (26 + (1 - i / (N - 1)) * 9, (0, 0, 0))])
        visible(nd, [(1, 40)])

# smoked-glass volume bars under the lines → the waveform's bars
BARS = []
NB = 11
for k, (ob, pts_c, pts_w) in enumerate(lines):
    for b in range(NB):
        i = 4 + b * (N - 8) // (NB - 1)
        pc = pts_c[i]; h = max(0.1, pc.z - FLOOR_Z - 0.05)
        BARS.append((k, i, pc, h))
def bar_t0(pc): return 21 + (1 - pc.y / Y1) * 9
NEAR = [b for b in BARS if b[2].y < cam_y(bar_t0(b[2])) + 4.5]
BARS = [b for b in BARS if b not in NEAR]
for n, (k, i, pc, h) in enumerate(NEAR):                  # near the lens: they shatter into the particle stream
    bx = rounded_slab(f'NearBar{n}', 0.05, 1.0, 0.012, depth=0.18, bevel=0.006, mat=glass); bx.rotation_euler = (math.radians(90), 0, 0)
    root = link(bpy.data.objects.new(f'NearRoot{n}', None)); bx.parent = root
    root.location = (pc.x, pc.y, FLOOR_Z + h / 2); t0 = bar_t0(pc)
    keys(root, 'scale', [(1, (1, 1, h)), (t0 - 4, (1, 1, h)), (t0 + 2, (0.0, 0.0, 0.0))])
    visible(root, [(1, int(t0) + 3)]); visible(bx, [(1, int(t0) + 3)])
NBAR = len(BARS)
for n, (k, i, pc, h) in enumerate(sorted(BARS, key=lambda b: b[2].x * 100 + b[2].y)):
    # a fin of smoked glass: 0.05 wide (x), unit height (z, scaled per bar), 0.36 long (y, along the chart);
    # (a curve's extrude goes both ways, so depth=0.18 is 0.36 thick before the stand-up rotation)
    bx = rounded_slab(f'Bar{n}', 0.05, 1.0, 0.012, depth=0.18, bevel=0.006, mat=glass)
    root = link(bpy.data.objects.new(f'BarRoot{n}', None)); bx.parent = root
    bx.rotation_euler = (math.radians(90), 0, 0)
    edge = rounded_slab(f'BarEdge{n}', 0.056, 0.012, 0.004, depth=0.185, mat=edge_m); edge.parent = root
    edge.rotation_euler = (math.radians(90), 0, 0); edge.location = (0, 0, 0.5)
    # chart pose: centre at half height, standing on the floor
    c_chart = Vector((pc.x, pc.y, FLOOR_Z + h / 2))
    # waveform pose: facing the camera, centred on the waveform line, height from the envelope
    x = -4.3 + 8.6 * (n + 0.5) / NBAR
    wh = 2 * envelope(x) * (0.75 + 0.25 * math.sin(n * 2.3)) + 0.08
    c_wave = Vector((x, YW + 0.35, ZC))
    far = pc.y / Y1
    t0 = bar_t0(pc) + 2; t1 = min(LOCK - 1, t0 + 10)
    keys(root, 'location', [(1, tuple(c_chart)), (t0, tuple(c_chart)), ((t0 + t1) / 2, tuple(c_chart.lerp(c_wave, 0.5) + Vector((0, 0, -0.25)))),
                            (t1, tuple(c_wave)), (OPEN0, tuple(c_wave)),
                            (OPEN1, tuple(c_wave + Vector((math.copysign(2.0, x) * math.exp(-(x / 1.3) ** 2), 0, 0))))])
    pulse = [(t1, (1, 1, wh)), (OPEN0, (1, 1, wh))]
    for bt in BEATS:
        if t1 < bt < OPEN0: pulse += [(bt, (1, 1, wh * 1.22)), (bt + 6, (1, 1, wh))]
    keys(root, 'scale', [(1, (1, 1, h)), (t0, (1, 1, h))] + sorted(pulse) + [(OPEN1, (1, 1, wh * (1 - 0.8 * math.exp(-(x / 1.3) ** 2))))])
    visible(root, [(1, 80)]); visible(bx, [(1, 80)]); visible(edge, [(1, 80)])

# particles: from the chart lines to the waveform, with the transformation
starts, targets, bursts, delays = [], [], [], []
for _ in range(3200):
    k = random.randrange(len(lines)); _, pc_, pw_ = lines[k]; i = random.randrange(N - 1); u = random.random()
    a = pc_[i].lerp(pc_[i + 1], u); b = pw_[i].lerp(pw_[i + 1], u)
    starts.append(tuple(a + Vector([random.gauss(0, 0.05) for _ in range(3)])))
    targets.append(tuple(b + Vector((random.gauss(0, 0.04), random.gauss(0, 0.25), random.gauss(0, 0.06)))))
    bursts.append((random.gauss(0, 0.4), random.gauss(0, 0.4), random.uniform(0.2, 1.0)))
    delays.append(20 + (1 - i / (N - 1)) * 9 + random.uniform(0, 8))
parts = particles('Sparks', starts, targets, bursts, delays, 20, settle=12.0, base=0.0, fly=0.012, noise_amp=0.5,
                  appear=20, vanish=(48, 64), glow=0.7)

# ---------------------------------------------------------------- the floor: a dark glossy lattice, all orange,
# then split cyan (SCOUT, left) / orange (NEXT, right) on the far side of the waveform
bpy.ops.mesh.primitive_plane_add(size=120, location=(0, 20, FLOOR_Z)); fl = bpy.context.active_object
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
# the plane is centred at y=20: local y=0 is world y=20
fade = nm_('POWER', nm_('MAXIMUM', nm_('SUBTRACT', 1.0, nm_('DIVIDE', nm_('ABSOLUTE', nm_('SUBTRACT', sep.outputs['Y'], 0.0)), 26.0)), 0.0), 2.0)
mixc = nt.nodes.new('ShaderNodeMix'); mixc.data_type = 'RGBA'
mixc.inputs['B'].default_value = (*EMBER_HOT, 1)
key_color(mixc.inputs["A"], [(LIT - 4, EMBER_HOT), (LIT + 14, CYAN)])
nt.links.new(nm_('MINIMUM', nm_('MAXIMUM', nm_('DIVIDE', nm_('ADD', sep.outputs['X'], 0.35), 0.7), 0.0), 1.0), mixc.inputs['Factor'])
nt.links.new(mixc.outputs['Result'], fb.inputs['Emission Color'])
gs = nm_('MULTIPLY', grid, fade); gmul = nt.nodes.new('ShaderNodeMath'); gmul.operation = 'MULTIPLY'
nt.links.new(gs, gmul.inputs[0]); key_val(gmul.inputs[1], [(1, 0.35), (LIT - 4, 0.25), (LIT + 14, 0.6)])
nt.links.new(gmul.outputs[0], fb.inputs['Emission Strength'])
fl.data.materials.append(fm)

# far hazes: warm ahead from the start; on the far side, cool behind SCOUT, warm behind NEXT
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
    return hz
haze('HazeAhead', (0, 44, 2.0), EMBER, [(1, 0.35), (LIT - 6, 0.35), (LIT + 4, 0.0)], size=60, radius=16.0)
haze('HazeS', (-3.2, 33, 1.2), CYAN, [(LIT - 6, 0.0), (LIT + 14, 0.45)], size=30, radius=5.0)
haze('HazeN', (3.2, 33, 0.2), EMBER, [(LIT - 6, 0.0), (LIT + 14, 0.16)], size=30, radius=5.0)

# ---------------------------------------------------------------- the two worlds beyond the waveform
P0 = Vector((0, 24.0, 0.8))                                # the middle of the far side
MON = P0 + Vector((-0.5, 0.6, 0.6))
mon, mscr = build_monitor('Workstation', [(S('s02-queue.png'), 1, 'cut')], width=2.35, glow=0.0)
mon.location = MON
keys(mon, 'rotation_euler', [(LIT - 6, (0, 0, math.radians(30))), (END, (0, 0, math.radians(17)))], interp='SINE', easing='EASE_OUT')
msb = next(n for n in mscr.data.materials[0].node_tree.nodes if n.type == 'BSDF_PRINCIPLED')
key_val(msb.inputs['Emission Strength'], [(LIT - 6, 0.0), (LIT + 10, 1.15)])
PHN = P0 + Vector((0.5, -1.55, -0.5))
phone, pscr = build_phone2('Phone', [(S('n04-back-amount.png'), 1, 'cut')], screen_glow=0.0)
phone.location = PHN; phone.scale = (0.72, 0.72, 0.72)
keys(phone, 'rotation_euler', [(LIT - 6, (math.radians(4), 0, math.radians(-34))), (END, (math.radians(2), 0, math.radians(-16)))], interp='SINE', easing='EASE_OUT')
psb = next(n for n in pscr.data.materials[0].node_tree.nodes if n.type == 'BSDF_PRINCIPLED')
key_val(psb.inputs['Emission Strength'], [(LIT - 6, 0.0), (LIT + 10, 1.0)])
for ob in (mon, phone): visible(ob, [(OPEN0, END)])
for ob in list(mon.children_recursive) + list(phone.children_recursive): visible(ob, [(OPEN0, END)])

def L_(name, loc, tgt, size, color, pairs, size_y=None):
    ob = look_light(name, tuple(loc), tuple(tgt), size, 0.0, color=color, size_y=size_y); key_energy(ob, pairs); return ob
L_('ScoutKey', MON + Vector((-1.8, -2.6, 2.2)), MON, 1.8, (0.72, 0.88, 1.0), [(LIT - 4, 0.0), (LIT + 12, 120.0)])
L_('ScoutRim', MON + Vector((-1.2, 1.6, 1.0)), MON, 0.2, CYAN, [(LIT - 4, 0.0), (LIT + 12, 420.0)], size_y=3.0)
L_('NextKey', PHN + Vector((1.4, -2.2, 1.6)), PHN, 1.2, (1.0, 0.9, 0.8), [(LIT - 4, 0.0), (LIT + 12, 45.0)])
L_('NextRim', PHN + Vector((1.2, 1.4, 0.5)), PHN, 0.2, EMBER, [(LIT - 4, 0.0), (LIT + 12, 240.0)], size_y=3.0)
for nm, loc, col in (('PoolS', MON, CYAN), ('PoolN', PHN, EMBER)):
    sp_d = bpy.data.lights.new(nm, 'SPOT'); sp_d.spot_size = math.radians(34); sp_d.spot_blend = 0.7; sp_d.color = col
    spo = link(bpy.data.objects.new(nm, sp_d)); spo.location = (loc.x, loc.y, 4.5)
    key_energy(spo, [(LIT - 4, 0.0), (LIT + 14, 900.0)])
# the chart's own light: a broad warm wash from above-ahead, for the glass and the metal tubes
L_('ChartTop', (0, 14, 6.0), (0, 10, 0), 6.0, (1.0, 0.62, 0.38), [(1, 60.0), (LIT - 6, 60.0), (LIT + 6, 0.0)])
L_('ChartRimL', (-4.0, 22, 1.0), (0, 10, 0.3), 0.4, EMBER, [(1, 120.0), (LIT - 6, 120.0), (LIT + 6, 0.0)], size_y=8.0)
L_('ChartRimR', (4.0, 22, 1.0), (0, 10, 0.3), 0.4, (1.0, 0.7, 0.45), [(1, 90.0), (LIT - 6, 90.0), (LIT + 6, 0.0)], size_y=8.0)
for ob in bpy.data.objects:
    if ob.type == 'LIGHT': ob.visible_camera = False
# each product takes only its own colour
def group(name, roots):
    g = bpy.data.collections.new(name)
    for r in roots:
        for ob in [r] + list(r.children_recursive):
            if ob.type in ('MESH', 'CURVE'): g.objects.link(ob)
    return g
scout_g, next_g = group('ScoutObjs', [mon]), group('NextObjs', [phone])
# each product takes only its own colour; the keys and rims also skip the glossy floor (no light-shaped glints)
scout_fx, next_fx = group('NotScout', [phone]), group('NotNext', [mon])
for g in (scout_fx, next_fx): g.objects.link(fl)
floor_g = bpy.data.collections.new('FloorOnly'); floor_g.objects.link(fl)
for nm, g in (('ChartRimL', floor_g), ('ChartRimR', floor_g), ('ScoutKey', scout_fx), ('ScoutRim', scout_fx), ('PoolS', next_g),
              ('NextKey', next_fx), ('NextRim', next_fx), ('PoolN', scout_g)):
    bpy.data.objects[nm].light_linking.receiver_collection = g
    for co in g.collection_objects: co.light_linking.link_state = 'EXCLUDE'

# ---------------------------------------------------------------- camera
cam = Camera(lens=24, fstop=2.8)
if WIDE:
    cam.key(1, (0.0, -1.8, 0.25), (0.0, 8.0, 0.55), (0, 6, 0.4), 4.0, 24)
    cam.key(24, (0.05, 6.2, 0.4), (0.0, 15.0, 0.6), (0, 12, 0.5))
    cam.key(LOCK, (0.0, 8.0, ZC), (0.0, YW, ZC), (0, YW, ZC), 5.6, 26)
    cam.key(OPEN0, (0.0, 9.0, ZC), (0.0, YW, ZC), (0, YW, ZC))
    cam.key(CROSS, (0.0, YW + 0.2, ZC + 0.05), (0.0, 23.0, 0.75), (0, 23, 0.75), 5.6, 28)
    cam.key(90, (0.0, 19.0, 0.85), P0 + Vector((0.0, 0, 0.0)), P0, 5.6, 30)
    cam.key(END, (0.0, 19.4, 0.86), P0 + Vector((0.0, 0, 0.0)), P0)
else:
    cam.key(1, (0.0, -1.8, 0.25), (0.0, 8.0, 0.55), (0, 6, 0.4), 4.0, 24)
    cam.key(24, (0.05, 6.4, 0.4), (0.0, 15.0, 0.6), (0, 12, 0.5))
    cam.key(LOCK, (0.0, 9.2, ZC), (0.0, YW, ZC), (0, YW, ZC), 5.6, 28)
    cam.key(OPEN0, (0.0, 10.2, ZC), (0.0, YW, ZC), (0, YW, ZC))
    cam.key(CROSS, (0.0, YW + 0.2, ZC + 0.05), (0.0, 23.0, 0.75), (0, 23, 0.75), 5.6, 28)
    cam.key(90, (0.0, 18.7, 0.82), P0 + Vector((0.0, 0, 0.1)), P0, 5.6, 28)
    cam.key(END, (0.0, 19.1, 0.84), P0 + Vector((0.0, 0, 0.1)), P0)
cam.smooth()

render(os.path.join(HERE, 'frames', 'hook'))
