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
from world5 import compact_frames; compact_frames(sc)
WIDE = arg('--hook') == 'wide'
if WIDE: sc.render.resolution_x, sc.render.resolution_y = 1920, 1080
S = lambda n: os.path.join(ASSETS, n)

LOCK, OPEN0, OPEN1, CROSS, LIT = 40, 47, 58, 62, 52
BEATS = [8 + 16 * i for i in range(7)]                     # 112.5 BPM grid: 8, 24, 40, 56, 72, 88, 104
YW, ZC = 15.0, 0.6                                         # the waveform's plane and centre line
FLOOR_Z = -1.25                                            # (world5.FLOOR_Z)

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
glass_dn = principled('SmokedGlassDown', (0.30, 0.10, 0.10), rough=0.08, transmission=1.0, ior=1.45, emission=(0.6, 0.06, 0.04), estr=0.6)
_gdb = glass_dn.node_tree.nodes['Principled BSDF']                        # falling candles warm to the waveform's orange as they join it
key_color(_gdb.inputs['Emission Color'], [(26, (0.6, 0.06, 0.04)), (LOCK - 2, EMBER_HOT)])
key_color(_gdb.inputs['Base Color'], [(26, (0.30, 0.10, 0.10)), (LOCK - 2, (0.42, 0.30, 0.26))])
key_val(_gdb.inputs['Emission Strength'], [(26, 0.6), (LOCK - 2, 0.25)])
gb = glass.node_tree.nodes['Principled BSDF']
gb.inputs['Emission Color'].default_value = (*EMBER_HOT, 1); key_val(gb.inputs['Emission Strength'], [(1, 0.55), (28, 0.55), (LOCK, 0.25)])  # rising candles glow
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
CANDLE = {}
for k, (ob, pts_c, pts_w) in enumerate(lines):
    for b in range(NB):
        i = 4 + b * (N - 8) // (NB - 1)
        pc = pts_c[i]; h = max(0.1, pc.z - FLOOR_Z - 0.05)
        BARS.append((k, i, pc, h))
        move = pts_c[min(N - 1, i + 3)].z - pts_c[max(0, i - 3)].z           # the candle's open → close over its period
        CANDLE[(k, i)] = (move >= 0, max(0.1, min(0.5, abs(move) * 1.4 + 0.08)), 0.06 + 0.12 * random.random(), 0.04 + 0.1 * random.random())
def bar_t0(pc): return 21 + (1 - pc.y / Y1) * 9
NEAR = [b for b in BARS if b[2].y < cam_y(bar_t0(b[2])) + 4.5]
BARS = [b for b in BARS if b not in NEAR]
for n, (k, i, pc, h) in enumerate(NEAR):                  # near the lens: they shatter into the particle stream
    bx = rounded_slab(f'NearBar{n}', 0.05, 1.0, 0.012, depth=0.18, bevel=0.006, mat=glass); bx.rotation_euler = (math.radians(90), 0, 0)
    root = link(bpy.data.objects.new(f'NearRoot{n}', None)); bx.parent = root
    up, hb, wk_u, wk_d = CANDLE[(k, i)]
    if not up: bx.data.materials[0] = glass_dn
    root.location = (pc.x, pc.y, pc.z); t0 = bar_t0(pc)
    keys(root, 'scale', [(1, (2.4, 0.33, hb)), (t0 - 4, (2.4, 0.33, hb)), (t0 + 2, (0.0, 0.0, 0.0))])
    visible(root, [(1, int(t0) + 3)]); visible(bx, [(1, int(t0) + 3)])
NBAR = len(BARS)
for n, (k, i, pc, h) in enumerate(sorted(BARS, key=lambda b: b[2].x * 100 + b[2].y)):
    # a fin of smoked glass: 0.05 wide (x), unit height (z, scaled per bar), 0.36 long (y, along the chart);
    # (a curve's extrude goes both ways, so depth=0.18 is 0.36 thick before the stand-up rotation)
    up, hb, wk_u, wk_d = CANDLE[(k, i)]
    bx = rounded_slab(f'Bar{n}', 0.05, 1.0, 0.012, depth=0.18, bevel=0.006, mat=glass if up else glass_dn)
    root = link(bpy.data.objects.new(f'BarRoot{n}', None)); bx.parent = root
    bx.rotation_euler = (math.radians(90), 0, 0)
    edge = rounded_slab(f'BarEdge{n}', 0.056, 0.012, 0.004, depth=0.185, mat=edge_m); edge.parent = root
    edge.rotation_euler = (math.radians(90), 0, 0); edge.location = (0, 0, 0.5)
    # chart pose: a candlestick — the body centred on the price line, square in plan like a real candle
    c_chart = Vector((pc.x, pc.y, pc.z))
    wm_, we_ = emissive(f'Wick{n}', EMBER_HOT if up else (0.9, 0.12, 0.08), 6.0 if up else 4.0)
    wc = bpy.data.curves.new(f'Wick{n}', 'CURVE'); wc.dimensions = '3D'; ws = wc.splines.new('POLY'); ws.points.add(1)
    ws.points[0].co = (pc.x, pc.y, pc.z - hb / 2 - wk_d, 1); ws.points[1].co = (pc.x, pc.y, pc.z + hb / 2 + wk_u, 1); wc.bevel_depth = 0.006
    wick = link(bpy.data.objects.new(f'Wick{n}', wc)); wick.data.materials.append(wm_)
    vh = 0.06 + 0.22 * random.random()                                     # traded volume, at the foot of the chart
    vol = rounded_slab(f'Vol{n}', 0.11, 1.0, 0.01, depth=0.05, mat=glass if up else glass_dn); vol.rotation_euler = (math.radians(90), 0, 0)
    vol.location = (pc.x, pc.y, FLOOR_Z + 0.02); vol.scale = (1, vh, 1)
    for v in vol.data.splines[0].points: v.co.y += 0.5
    t_off = bar_t0(pc) + 2
    keys(wick, 'scale', [(t_off - 2, (1, 1, 1)), (t_off + 3, (1, 1, 0.0))]); visible(wick, [(1, int(t_off) + 4)])
    keys(vol, 'scale', [(t_off - 4, (1, vh, 1)), (t_off + 2, (1, 0.0, 1))]); visible(vol, [(1, int(t_off) + 3)])
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
    keys(root, 'scale', [(1, (2.4, 0.33, hb)), (t0, (2.4, 0.33, hb))] + sorted(pulse) + [(OPEN1, (1, 1, wh * (1 - 0.8 * math.exp(-(x / 1.3) ** 2))))])
    visible(root, [(1, 80)]); visible(bx, [(1, 80)]); visible(edge, [(1, 80)])

grid_m, grid_e = emissive('PriceGrid', (1.0, 0.72, 0.55), 0.0)
key_val(grid_e.inputs['Strength'], [(1, 0.9), (22, 0.9), (34, 0.0)])
for zl in [-0.6 + 0.45 * j for j in range(9)]:
    for side in (-2.75, 2.75):
        gc = bpy.data.curves.new('Grid', 'CURVE'); gc.dimensions = '3D'; gs = gc.splines.new('POLY'); gs.points.add(1)
        gs.points[0].co = (side, Y0 - 1.0, zl, 1); gs.points[1].co = (side, Y1 + 2.0, zl, 1); gc.bevel_depth = 0.0035
        g_ = link(bpy.data.objects.new('Grid', gc)); g_.data.materials.append(grid_m); visible(g_, [(1, 36)])
        for t_ in range(int(Y0), int(Y1) + 1, 3):                         # tick marks along each price level
            tc_ = bpy.data.curves.new('Tick', 'CURVE'); tc_.dimensions = '3D'; ts_ = tc_.splines.new('POLY'); ts_.points.add(1)
            ts_.points[0].co = (side, t_, zl - 0.05, 1); ts_.points[1].co = (side, t_, zl + 0.05, 1); tc_.bevel_depth = 0.003
            t_o = link(bpy.data.objects.new('Tick', tc_)); t_o.data.materials.append(grid_m); visible(t_o, [(1, 36)])
last_z = max(pc_[-1].z for _, pc_, _ in lines)
lp_m, lp_e = emissive('LastPrice', EMBER_HOT, 0.0); key_val(lp_e.inputs['Strength'], [(1, 4.0), (22, 4.0), (32, 0.0)])
for j in range(22):                                                         # the dashed last-price line across the chart
    x0_ = -2.7 + j * 0.25
    lc_ = bpy.data.curves.new('Last', 'CURVE'); lc_.dimensions = '3D'; ls_ = lc_.splines.new('POLY'); ls_.points.add(1)
    ls_.points[0].co = (x0_, Y1 + 0.5, last_z, 1); ls_.points[1].co = (x0_ + 0.14, Y1 + 0.5, last_z, 1); lc_.bevel_depth = 0.008
    lo_ = link(bpy.data.objects.new('Last', lc_)); lo_.data.materials.append(lp_m); visible(lo_, [(1, 34)])
tag = rounded_slab('PriceTag', 0.5, 0.18, 0.05, depth=0.01, mat=lp_m); tag.rotation_euler = (math.radians(90), 0, 0)
tag.location = (2.95, Y1 + 0.5, last_z); visible(tag, [(1, 34)])

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

# ---------------------------------------------------------------- the world beyond the waveform (shared with every scene)
from world5 import build_world, link_lights, haze, L_, P0, MON, PHN, build_architecture, hook_cam_keys, BEHIND
W = build_world(S, LIT, OPEN0, [(S('scout-queue-before.png'), 1, 'cut')], [(S('n04-back-amount.png'), 1, 'cut')])
haze('HazeAhead', (0, 44, 2.0), EMBER, [(1, 0.35), (LIT - 6, 0.35), (LIT + 4, 0.0)], size=60, radius=16.0)
# the chart's own light: a broad warm wash from above-ahead, for the glass and the metal tubes
L_('ChartTop', (0, 14, 6.0), (0, 10, 0), 6.0, (1.0, 0.62, 0.38), [(1, 60.0), (LIT - 6, 60.0), (LIT + 6, 0.0)])
L_('ChartRimL', (-4.0, 22, 1.0), (0, 10, 0.3), 0.4, EMBER, [(1, 120.0), (LIT - 6, 120.0), (LIT + 6, 0.0)], size_y=8.0)
L_('ChartRimR', (4.0, 22, 1.0), (0, 10, 0.3), 0.4, (1.0, 0.7, 0.45), [(1, 90.0), (LIT - 6, 90.0), (LIT + 6, 0.0)], size_y=8.0)
link_lights(W, extra_floor_only=('ChartRimL', 'ChartRimR'))
build_architecture(FLOOR_Z, 14.0, 46.0, (-4.6, -7.6), (10.8, 13.8), 48.0, [(LIT - 4, 0.0), (LIT + 14, 1.6)], appear=OPEN0, extra=BEHIND)

# ---------------------------------------------------------------- camera
cam = Camera(lens=24, fstop=2.8)
if WIDE:
    cam.key(1, (0.0, -1.8, 0.25), (0.0, 8.0, 0.55), (0, 6, 0.4), 4.0, 24)
    cam.key(24, (0.05, 6.2, 0.4), (0.0, 15.0, 0.6), (0, 12, 0.5))
    cam.key(LOCK, (0.0, 8.0, ZC), (0.0, YW, ZC), (0, YW, ZC), 5.6, 26)
    cam.key(OPEN0, (0.0, 9.0, ZC), (0.0, YW, ZC), (0, YW, ZC))
    for k_ in hook_cam_keys(WIDE): cam.key(*k_)                   # the shared closing pose (frames 62, 90, 105)
else:
    cam.key(1, (0.0, -1.8, 0.25), (0.0, 8.0, 0.55), (0, 6, 0.4), 4.0, 24)
    cam.key(24, (0.05, 6.4, 0.4), (0.0, 15.0, 0.6), (0, 12, 0.5))
    cam.key(LOCK, (0.0, 9.2, ZC), (0.0, YW, ZC), (0, YW, ZC), 5.6, 28)
    cam.key(OPEN0, (0.0, 10.2, ZC), (0.0, YW, ZC), (0, YW, ZC))
    for k_ in hook_cam_keys(WIDE): cam.key(*k_)                   # the shared closing pose (frames 62, 90, 105)
cam.smooth()

if arg('--save'): bpy.ops.file.pack_all()             # editable .blend: images packed inside
render(os.path.join(HERE, 'frames', 'hook'))
