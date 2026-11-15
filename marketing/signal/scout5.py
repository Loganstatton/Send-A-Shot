"""NEXT × SCOUT — "THE SIGNAL": ACT I and the transfer, 0:03–0:22 (global frames 90–660; frame 90
is the hook's last frame, so the cut is invisible).

  frames   time   picture
  90–150   3.0    the camera turns into SCOUT's cyan side; the ultrawide workstation turns to face it;
                  NEXT's phone slips away into the orange dark
  118–186         Juno Marrow's identity tile (abstract cover + waveform) flies in and lands in the real
                  New Candidates queue, which now shows her fan submission
  190–262         her candidate record, read left to right
  262–300  ~10.0  the Approve button: hover, a pulse, the click (frame 298)
  300–342         the Discovery dashboard: Candidate Queue "1 approved"
  345–430         the rating panel, one column of four categories at a time; each set by hand (left
                  column at 372, right at 418)
  446–515         the saved rating: 86.0, then the evaluated profile
  518–545  17.3   THE TRANSFER: the profile lifts off the monitor as a thick glass tile, cyan light on it
  545–600         a dark corridor of interconnected light; cyan turns to orange; the tile turns edge-on and
                  its back is Juno's real NEXT card
  600–631  21.0   a phone rises out of the orange dark; the card lands in its Discover screen (impact)
  631–660         settle on the phone

  blender-venv/bin/python scout5.py -- --assets DIR [--hook wide] [--preview|--gpu] [--frames a-b|--list ...] [--out DIR]
"""
import json, math, os, random, sys
HERE = os.path.dirname(os.path.abspath(__file__))
for p in (HERE, os.path.join(HERE, '..', 'dual'), os.path.join(HERE, '..', 'commercial2'), os.path.join(HERE, '..', 'commercial')):
    if p not in sys.path: sys.path.insert(0, p)
from scout3d import *
from phone2 import build_phone2
from world5 import *
from mathutils import Vector, Matrix

random.seed(90)
END = 660
sc = init(END, samples=96, gpu_samples=128)
sc.frame_start = 90
sc.cycles.transparent_max_bounces = 16
from world5 import compact_frames; compact_frames(sc)

WIDE = arg('--hook') == 'wide'
if WIDE: sc.render.resolution_x, sc.render.resolution_y = 1920, 1080
S = lambda n: os.path.join(ASSETS, n)
LIT = 52                                            # the hook's: the far side lit up at frame 52
TILE0, TILE1, HOVER, CLICK, DASH, RATE0, SET1, SET2, RATED = 118, 186, 262, 298, 300, 345, 372, 418, 446
LIFT, FLY, FLIP0, FLIP1, RISE, LAND = 518, 545, 578, 600, 600, 631
ROW = json.load(open(S('scout-slots.json')))['juno_row']
GRID = json.load(open(S('rate-slots.json')))['grid']
PNL = json.load(open(S('panel-slot.json')))

W = build_world(S, LIT, 1, [(S('scout-queue-before.png'), 1, 'cut'), (S('scout-queue.png'), TILE1, 'fade'),
                            (S('scout-queue-approve.png'), HOVER, 'cut'), (S('scout-dash-after.png'), DASH + 2, 'fade'),
                            (S('scout-rate-a.png'), RATE0, 'fade'), (S('scout-rate-b.png'), SET1, 'fade'),
                            (S('scout-rate-c.png'), SET2, 'fade'), (S('scout-rated.png'), RATED, 'fade')],
                [(S('n04-back-amount.png'), 1, 'cut')])
mon, mscr, phone = W['mon'], W['mscr'], W['phone']
keys(mon, 'rotation_euler', [(105, (0, 0, MON_YAW[1])), (150, (0, 0, 0))], interp='SINE', easing='EASE_IN_OUT')
build_architecture(FLOOR_Z, 14.0, 46.0, (-4.6, -7.6), (10.8, 13.8), 48.0, [(1, 1.6)], extra=BEHIND)
key_val(screen_bsdf(mscr).inputs['Emission Strength'], [(LIFT, 1.15), (FLY, 0.45)])     # the screen dims as the profile leaves it
# NEXT's phone slips away into the orange dark (the transfer brings a phone back later)
keys(phone, 'location', [(105, tuple(PHN)), (140, tuple(PHN + Vector((2.8, 3.2, 0.0))))], interp='SINE', easing='EASE_IN')
visible(phone, [(1, 141)])
for ob in phone.children_recursive: visible(ob, [(1, 141)])
for nm in ('NextKey', 'NextRim', 'PoolN'):
    L = W['lights'][nm]; key_energy(L, [(105, L.data.energy), (135, 0.0)])
key_val(W['hz_n'], [(105, 0.16), (140, 0.05)])

sc.frame_set(200); bpy.context.view_layer.update()
def spt(px, py, lift=0.0):
    """World point of a pixel (px, py) on the 4201x1800 SCOUT screen texture."""
    u, v = px / ROW['W'], py / ROW['H']
    return mscr.matrix_world @ Vector(((u - 0.5) * UW_W, (0.5 - v) * UW_H, lift))
NRM = (mscr.matrix_world.to_3x3() @ Vector((0, 0, 1))).normalized()          # out of the screen, toward the viewer
def front(p, d, dx=0.0, dz=0.0): return tuple(p + NRM * d + Vector((dx, 0, dz)))
AV = spt(ROW['x'] + 0.036 * ROW['w'], ROW['y'] + 0.22 * ROW['h'])            # the "J" avatar on her row
ROWL = spt(ROW['x'] + 0.2 * ROW['w'], ROW['y'] + 0.45 * ROW['h'])
APP = spt(ROW['x'] + 0.90 * ROW['w'], ROW['y'] + 0.22 * ROW['h'])            # Approve
DQ = spt(0.47 * ROW['W'], 0.80 * ROW['H'])                                   # Candidate Queue: "1 approved"
LC = spt(GRID['x'] + 0.25 * GRID['w'], GRID['y'] + 0.5 * GRID['h'])          # the left column of the rating panel
RC = spt(GRID['x'] + 0.75 * GRID['w'], GRID['y'] + 0.5 * GRID['h'])
BADGE = spt(PNL['badge_x'], PNL['badge_y'])
PC = spt(PNL['x'] + PNL['w'] / 2, PNL['y'] + PNL['h'] / 2)
PANEL_W = PNL['w'] / ROW['W'] * UW_W

# ---------------------------------------------------------------- the identity tile flies into the queue
tile, tface, th, t_fade, t_glow = glass_panel('JunoTile', S('juno-tile.png'), 0.62, depth=0.05, glow=1.2)
keys(tile, 'location', [(TILE0, tuple(MON + Vector((-2.4, -2.6, 0.9)))), (150, tuple(MON + Vector((-1.25, -1.7, 0.35)))),
                        (176, front(AV, 0.32)), (TILE1, front(AV, 0.02))])
keys(tile, 'rotation_euler', [(TILE0, (math.radians(-8), math.radians(10), math.radians(40))), (150, (math.radians(-3), 0, math.radians(18))),
                              (176, (0, 0, 0))])
keys(tile, 'scale', [(TILE0, (1, 1, 1)), (165, (0.55, 0.55, 0.55)), (TILE1, (0.05, 0.05, 0.05))])
key_val(t_fade, [(TILE1 - 3, 1.0), (TILE1, 0.0)])
visible(tile, [(TILE0, TILE1)])
for ob in tile.children_recursive: visible(ob, [(TILE0, TILE1)])
tl = bpy.data.lights.new('TileLight', 'POINT'); tl.color = (1.0, 0.55, 0.6); tl.shadow_soft_size = 0.3
tlo = link(bpy.data.objects.new('TileLight', tl)); tlo.parent = tile; tlo.location = (0, -0.6, 0.2); tlo.visible_glossy = False
key_energy(tlo, [(TILE0, 0.0), (TILE0 + 8, 8.0), (TILE1, 0.0)])
# where it lands: a soft ring on her avatar, then a thin outline round her row
def screen_ring(name, p, r, frame, color=CYAN_HOT):
    m, e = emissive(name, color, 0.0)
    rc = bpy.data.curves.new(name, 'CURVE'); rc.dimensions = '3D'; rs = rc.splines.new('POLY'); rs.points.add(47)
    for i in range(48): a_ = 2 * math.pi * i / 48; rs.points[i].co = (r * math.cos(a_), r * math.sin(a_), 0, 1)
    rs.use_cyclic_u = True; rc.bevel_depth = 0.0022
    ring = link(bpy.data.objects.new(name, rc)); ring.data.materials.append(m)
    ring.matrix_world = Matrix.Translation(p + NRM * 0.004) @ mscr.matrix_world.to_3x3().to_4x4()
    for f, s_, st in ((frame - 2, 0.5, 0.0), (frame, 0.9, 2.2), (frame + 12, 2.2, 0.0)):
        ring.scale = (s_, s_, s_); ring.keyframe_insert('scale', frame=f)
        e.inputs['Strength'].default_value = st; e.inputs['Strength'].keyframe_insert('default_value', frame=f)
    visible(ring, [(frame - 2, frame + 10)])
screen_ring('LandRing', AV, 0.05, TILE1)
screen_ring('ClickRing', APP, 0.04, CLICK, color=(0.85, 0.95, 1.0))
def outline(name, center, w, h, pairs, color=CYAN_HOT):
    oc = bpy.data.curves.new(name, 'CURVE'); oc.dimensions = '3D'; osp = oc.splines.new('POLY')
    rp = rounded_rect_points(w, h, 0.02, 6); osp.points.add(len(rp) - 1)
    for i, (x, y) in enumerate(rp): osp.points[i].co = (x, y, 0, 1)
    osp.use_cyclic_u = True; oc.bevel_depth = 0.0025
    ob = link(bpy.data.objects.new(name, oc)); m, e = emissive(name + 'M', color, 0.0); ob.data.materials.append(m)
    ob.matrix_world = Matrix.Translation(center + NRM * 0.005) @ mscr.matrix_world.to_3x3().to_4x4()
    key_val(e.inputs['Strength'], pairs); visible(ob, [(pairs[0][0], pairs[-1][0])])
    return ob
ROWC = spt(ROW['x'] + 0.5 * ROW['w'], ROW['y'] + 0.5 * ROW['h'])
outline('RowGlow', ROWC, ROW['w'] / ROW['W'] * UW_W + 0.01, ROW['h'] / ROW['H'] * UW_H + 0.01, [(TILE1, 0.0), (TILE1 + 4, 4.0), (TILE1 + 30, 1.2), (CLICK + 6, 1.2), (CLICK + 14, 0.0)])
# the scout's hand-set rating, shown as a highlight running down each column as the values change
def sweep(name, col, f0, f1):
    m, e = emissive(name, CYAN_HOT, 0.0)
    bar = rounded_mesh(name, GRID['w'] / 2 / ROW['W'] * UW_W * 0.96, 0.006, 0.0029, mat=m)
    top = spt(col.x, 0, 0) if False else None
    p0 = spt(GRID['x'] + (0.25 if col == 'L' else 0.75) * GRID['w'], GRID['y'] + 0.02 * GRID['h'])
    p1 = spt(GRID['x'] + (0.25 if col == 'L' else 0.75) * GRID['w'], GRID['y'] + 0.98 * GRID['h'])
    rot = mscr.matrix_world.to_3x3().to_4x4()
    for f, p in ((f0, p0), (f1, p1)):
        bar.matrix_world = Matrix.Translation(p + NRM * 0.005) @ rot; bar.keyframe_insert('location', frame=f)
    key_val(e.inputs['Strength'], [(f0, 0.0), (f0 + 3, 6.0), (f1 - 3, 6.0), (f1, 0.0)]); visible(bar, [(f0, f1)])
sweep('SweepL', 'L', SET1 - 12, SET1 + 8)
sweep('SweepR', 'R', SET2 - 12, SET2 + 8)

# ---------------------------------------------------------------- THE TRANSFER
PH2 = Vector((7.2, 30.2, 1.15))
phone2, pscr2 = build_phone2('NextPhone', [(S('n02-discover-grid.png'), 1, 'cut')], screen_glow=1.05)
keys(phone2, 'location', [(RISE - 34, tuple(PH2 + Vector((0.3, 0.6, -2.8)))), (RISE + 6, tuple(PH2)), (END, tuple(PH2 + Vector((0, 0, 0.03))))], interp='SINE', easing='EASE_OUT')
keys(phone2, 'rotation_euler', [(RISE - 34, (math.radians(-20), 0, math.radians(25))), (LAND - 4, (0, 0, math.radians(-4))), (END, (0, 0, math.radians(-6)))])
visible(phone2, [(RISE - 34, 100000)])
for ob in phone2.children_recursive: visible(ob, [(RISE - 34, 100000)])
SLOT = json.load(open(S('slots.json')))['featured_card']
sc.frame_set(LAND); bpy.context.view_layer.update()
LANDING = pscr2.matrix_world @ Vector(((SLOT['u'] - 0.5) * SCREEN_W, (0.5 - SLOT['v']) * SCREEN_H, 0.012))
flight = link(bpy.data.objects.new('Flight', None))
scout_p, sface, sh, s_fade, s_glow = glass_panel('ScoutPanel', S('scout-panel.png'), PANEL_W, depth=0.06, glow=1.2, facing='front')
scout_p.parent = flight
NW = 1.3
nextp, nface, nh, n_fade, n_glow = glass_panel('NextPanel', S('next-card.png'), NW, depth=0.05, glow=1.15, facing='back')
nextp.parent = flight
land_scale = SLOT['w'] * SCREEN_W / NW
P1 = PC + Vector((0.5, -1.5, 0.15)); P2 = Vector((2.2, 22.6, 1.45)); P3 = Vector((4.2, 25.0, 1.5)); P4 = Vector((6.1, 27.9, 1.35))
keys(flight, 'location', [(LIFT, tuple(PC + NRM * 0.03)), (FLY, tuple(P1)), (FLIP0, tuple(P2)), (FLIP1, tuple(P3)), (RISE + 18, tuple(P4)), (LAND, tuple(LANDING))])
keys(flight, 'scale', [(LIFT, (1, 1, 1)), (FLY, (0.62, 0.62, 0.62)), (FLIP0, (0.5, 0.5, 0.5)), (RISE + 18, (0.5, 0.5, 0.5)), (LAND, (land_scale,) * 3)])
keys(flight, 'rotation_euler', [(LIFT, (0, 0, 0)), (FLY, (math.radians(4), 0, math.radians(-14))), (FLIP0, (math.radians(2), 0, math.radians(-30))),
                                (FLIP1, (0, 0, math.pi - math.radians(30))), (RISE + 18, (0, 0, math.pi - math.radians(10))), (LAND, (0, 0, math.pi + math.radians(-4)))])
MID = (FLIP0 + FLIP1) // 2
keys(scout_p, 'scale', [(FLIP0, (1, 1, 1)), (MID, (NW / PANEL_W, 1, nh / sh))], interp='SINE', easing='EASE_IN')
visible(scout_p, [(LIFT, MID)]); visible(nextp, [(MID + 1, LAND + 1)])
for ob in scout_p.children_recursive: visible(ob, [(LIFT, MID)])
for ob in nextp.children_recursive: visible(ob, [(MID + 1, LAND + 1)])
key_val(s_glow, [(LIFT, 1.2), (LIFT + 6, 2.2), (FLY, 1.25)])
key_val(n_fade, [(LAND - 5, 1.0), (LAND + 1, 0.0)])
outline('ProfileGlow', PC, PANEL_W, sh, [(RATED + 40, 0.0), (LIFT - 6, 5.0), (LIFT, 6.0), (LIFT + 8, 0.0)])
rl = bpy.data.lights.new('RideLight', 'POINT'); rl.shadow_soft_size = 0.4
ride = link(bpy.data.objects.new('RideLight', rl)); ride.parent = flight; ride.location = (0, -0.9, 0.3); ride.visible_glossy = False
key_light_color(ride, [(FLY, CYAN), (FLIP0 - 6, CYAN), (FLIP1 + 6, (1.0, 0.45, 0.2))])
key_energy(ride, [(LIFT, 0.0), (FLY, 18.0), (RISE + 18, 14.0), (LAND, 3.0)])

# the corridor of interconnected data: frames of light along the path, joined by long lines and lit nodes
cu = bpy.data.curves.new('CorridorPath', 'CURVE'); cu.dimensions = '3D'
pts_ = [P1 + Vector((0, -0.6, 0)), P1, P2, P3, P4, PH2 + Vector((0, -1.2, 0.1))]
spn = cu.splines.new('BEZIER'); spn.bezier_points.add(len(pts_) - 1)
for bp, p in zip(spn.bezier_points, pts_): bp.co = p; bp.handle_left_type = bp.handle_right_type = 'AUTO'
cpath = link(bpy.data.objects.new('CorridorPath', cu)); cpath.hide_render = True
bpy.context.view_layer.update()
def sample(t):
    """Point and tangent on the corridor path at t in 0..1 (dense polyline approximation)."""
    seg = len(pts_) - 1; x = min(t * seg, seg - 1e-6); i = int(x); f = x - i
    a, b = spn.bezier_points[i], spn.bezier_points[i + 1]
    def bez(f): return ((1 - f) ** 3) * a.co + 3 * ((1 - f) ** 2) * f * a.handle_right + 3 * (1 - f) * f * f * b.handle_left + f ** 3 * b.co
    p = bez(f); q = bez(min(1, f + 0.01)) if f < 0.99 else p + (b.co - a.co).normalized() * 0.01
    return p, (q - p).normalized()
NR = 22
corner_lines = [[] for _ in range(4)]
RINGS, RAILS, NODES = [], [], []
for i in range(NR):
    t = 0.14 + 0.86 * (i + 0.5) / NR; p, tg = sample(t)           # starting clear of the workstation
    col = tuple(CYAN_HOT[c] * (1 - t) + EMBER_HOT[c] * t for c in range(3))
    m, e = emissive(f'Ring{i}', col, 0.0)
    w_, h_ = 3.4, 2.3                                    # wide enough that the camera flies inside it
    oc = bpy.data.curves.new(f'Ring{i}', 'CURVE'); oc.dimensions = '3D'; osp = oc.splines.new('POLY')
    rp = rounded_rect_points(w_, h_, 0.12, 6); osp.points.add(len(rp) - 1)
    for k_, (x, y) in enumerate(rp): osp.points[k_].co = (x, y, 0, 1)
    osp.use_cyclic_u = True; oc.bevel_depth = 0.0022
    ring = link(bpy.data.objects.new(f'Ring{i}', oc)); ring.data.materials.append(m)
    ring.location = p; ring.rotation_euler = tg.to_track_quat('Z', 'Y').to_euler(); RINGS.append((ring, rp))
    on = FLY - 10 + int(t * (RISE - FLY))                 # they light up just ahead of the tile
    key_val(e.inputs['Strength'], [(on - 6, 0.0), (on, 2.6), (on + 14, 1.0), (LAND + 10, 0.5), (END, 0.0)])
    visible(ring, [(on - 6, END)])
    bpy.context.view_layer.update()
    for k_, (cx_, cy_) in enumerate(((-w_ / 2, -h_ / 2), (w_ / 2, -h_ / 2), (w_ / 2, h_ / 2), (-w_ / 2, h_ / 2))):
        corner_lines[k_].append((ring.matrix_world @ Vector((cx_, cy_, 0)), on))
node_m, node_e = emissive('CorridorNode', (1.0, 0.85, 0.7), 0.0)
key_val(node_e.inputs['Strength'], [(FLY - 12, 0.0), (FLY, 6.0), (LAND + 10, 2.5), (END, 0.0)])
for k_, pl in enumerate(corner_lines):
    pl = pl[4:]                                            # the rails start a few frames in, clear of the camera's entry
    lc = bpy.data.curves.new(f'Rail{k_}', 'CURVE'); lc.dimensions = '3D'; ls = lc.splines.new('POLY'); ls.points.add(len(pl) - 1)
    for j, (p, _) in enumerate(pl): ls.points[j].co = (*p, 1)
    lc.bevel_depth = 0.0015
    rail = link(bpy.data.objects.new(f'Rail{k_}', lc)); RAILS.append((rail, [p for p, _ in pl])); rm, re_ = emissive(f'Rail{k_}M', (0.75, 0.42, 0.5), 0.0); rail.data.materials.append(rm)
    lc.bevel_factor_end = 0.0; lc.keyframe_insert('bevel_factor_end', frame=FLY - 12)
    lc.bevel_factor_end = 1.0; lc.keyframe_insert('bevel_factor_end', frame=RISE)
    key_val(re_.inputs['Strength'], [(FLY - 12, 0.0), (FLY, 1.8), (END, 0.6)])
    visible(rail, [(FLY - 12, END)])
    for p, on in pl[::2]:
        bpy.ops.mesh.primitive_uv_sphere_add(radius=0.009, segments=12, ring_count=6, location=p); nd = bpy.context.active_object
        nd.data.materials.append(node_m); visible(nd, [(on - 2, END)]); NODES.append(nd)
tr, te = flow_trail('Trail', [PC + NRM * 0.05, P1, P2, P3, P4, LANDING], count=700, spread=0.1, speed=0.16, radius=0.003)
key_color(te.inputs['Color'], [(FLY, CYAN_HOT), (FLIP0 - 8, CYAN_HOT), (FLIP1 + 8, EMBER_HOT)])
key_val(te.inputs['Strength'], [(LIFT, 0.0), (LIFT + 16, 5.0), (RISE, 4.5), (LAND + 6, 0.0)])

# NEXT's light at the end of the corridor
N_ = dict(
    NKey=L_('NKey2', PH2 + Vector((-1.4, -3.0, 2.2)), PH2, 2.0, (1.0, 0.92, 0.85), [(RISE - 20, 0.0), (LAND, 70.0)]),
    NRimL=L_('NRimL2', PH2 + Vector((-1.6, 1.4, 0.6)), PH2, 0.2, EMBER, [(RISE - 20, 0.0), (LAND, 240.0)], size_y=3.0),
    NRimR=L_('NRimR2', PH2 + Vector((1.6, 1.2, -0.2)), PH2, 0.2, (1.0, 0.62, 0.36), [(RISE - 20, 0.0), (LAND, 200.0)], size_y=3.0))
haze('HazeN2', (PH2.x + 1.5, PH2.y + 9, 0.8), EMBER, [(FLIP0, 0.0), (LAND, 0.3)], size=30, radius=6.0)
for nm in ('ScoutKey', 'ScoutRim', 'PoolS'):
    L = W['lights'][nm]; key_energy(L, [(FLIP0, L.data.energy), (RISE + 10, L.data.energy * 0.25)])
key_val(W['hz_s'], [(FLIP0, 0.45), (RISE + 10, 0.12)])
floor_g = link_lights(W)
nx = group('NotPhone2', [mon, W['desk'], W['ped']]); nx.objects.link(W['fl'])
for nm in ('NKey2', 'NRimL2', 'NRimR2'):
    bpy.data.objects[nm].light_linking.receiver_collection = nx
    for co in nx.collection_objects: co.light_linking.link_state = 'EXCLUDE'

# ---------------------------------------------------------------- camera
cam = Camera(lens=28, fstop=5.6)
for k_ in hook_cam_keys(WIDE)[:2]: cam.key(*k_)                     # the hook's keys, so frame 90 matches exactly
cam.key(105, (0.0, 20.4, 0.98), tuple(P0 + Vector((-0.25, 0, 0.2))), tuple(MON), 5.6, 30)
c150 = MON + Matrix.Rotation(math.radians(-16), 3, 'Z') @ Vector((0, -4.4, 0.2))
cam.key(150, tuple(c150), tuple(MON + Vector((0, 0, -0.1))), tuple(MON), 4.0, 35)
cam.key(TILE1, front(AV, 1.55, 0.3, 0.24), tuple(AV + Vector((0.3, 0, 0.22))), tuple(AV), 3.2, 35)
cam.key(225, front(ROWL, 1.45, 0, 0.24), tuple(ROWL + Vector((0, 0, 0.22))), tuple(ROWL), 3.2)
cam.key(HOVER, front(APP, 1.35, -0.12, 0.24), tuple(APP + Vector((-0.12, 0, 0.22))), tuple(APP), 3.2)
cam.key(CLICK, front(APP, 1.25, -0.12, 0.22), tuple(APP + Vector((-0.12, 0, 0.2))), tuple(APP))
cam.key(325, front(DQ, 1.6, 0, 0.0), tuple(DQ), tuple(DQ), 3.2)
cam.key(340, front(DQ, 1.55, 0, 0.0), tuple(DQ), tuple(DQ))
cam.key(360, front(LC, 3.0), tuple(LC + Vector((0, 0, 0.3))), tuple(LC), 4.0)
cam.key(388, front(LC, 2.9), tuple(LC + Vector((0, 0, 0.3))), tuple(LC))
cam.key(405, front(RC, 3.0), tuple(RC + Vector((0, 0, 0.3))), tuple(RC))
cam.key(432, front(RC, 2.9), tuple(RC + Vector((0, 0, 0.3))), tuple(RC))
cam.key(458, front(BADGE, 2.4, -0.03, 0.25), tuple(BADGE + Vector((-0.03, 0, 0.25))), tuple(BADGE), 3.2)
cam.key(482, front(BADGE, 2.3, -0.03, 0.25), tuple(BADGE + Vector((-0.03, 0, 0.25))), tuple(BADGE))
cam.key(LIFT, front(PC, 3.4, 0.35, 0.3), tuple(PC), tuple(PC), 4.0, 35)
# a follow camera: behind the tile, along the corridor's axis (never side-on to its frames)
def follow(t, back=2.1, up=0.22, side=0.18):
    p, tg = sample(t); sd = tg.cross(Vector((0, 0, 1))).normalized()
    return tuple(p - tg * back + Vector((0, 0, up)) - sd * side)
cam.key(FLY, follow(0.06, 2.3), tuple(P1), tuple(P1), 3.2)
cam.key(FLIP0, follow(0.36), tuple(P2), tuple(P2))
cam.key(FLIP1, follow(0.58), tuple(P3), tuple(P3))
cam.key(RISE + 18, follow(0.78, 1.9), tuple(P4), tuple(P4), 3.0)
scr_c = PH2 + Vector((0, -0.05, 0.0))
cam.key(LAND, tuple(PH2 + Vector((-0.35, -2.9, 0.15))), tuple(scr_c), tuple(scr_c), 2.8, 35)
cam.key(END, tuple(PH2 + Vector((-0.1, -2.6, 0.1))), tuple(scr_c), tuple(scr_c), 2.8, 35)
cam.smooth()
# keep the corridor clear of the lens: drop any frame or node that passes within 0.9 of the camera, and
# start each rail after its last close point
cpos = []
for f in range(FLY - 12, END + 1, 2):
    sc.frame_set(f); cpos.append(cam.cam.matrix_world.translation.copy())
near = lambda q: min((q - c).length for c in cpos) < 0.7
for ring, rp in RINGS:
    if any(near(ring.matrix_world @ Vector((x, y, 0))) for x, y in rp): bpy.data.objects.remove(ring)
for nd in NODES:
    if near(nd.location): bpy.data.objects.remove(nd)
for rail, pl in RAILS:
    close = [j for j, q in enumerate(pl) if near(q)]
    if close:
        sp_ = rail.data.splines[0]; keep = pl[close[-1] + 1:]
        if len(keep) < 2: bpy.data.objects.remove(rail); continue
        rail.data.splines.remove(sp_); ns = rail.data.splines.new('POLY'); ns.points.add(len(keep) - 1)
        for j, q in enumerate(keep): ns.points[j].co = (*q, 1)
if arg('--save'): bpy.ops.file.pack_all()
render(os.path.join(HERE, 'frames', 'scout5'))
