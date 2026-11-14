"""NEXT × SCOUT — "THE SIGNAL": ACT III opens, 0:40–0:47 (global frames 1200–1410; frame 1200 is
next5's last frame: same phone, same camera).

  frames      picture (all real NEXT screens)
  1200–1240   pull back from the phone; it shows the watchlist; three glass panels leave it
  1236–1282   PORTFOLIO (left): holdings, value, return in virtual Credits
  1288–1340   COMMUNITY (right): the Feed (artist activity, players' takes); the phone shows Market Activity
  1346–1400   LEADERBOARD (above): ways to rank, top traders
  1395–1410   everything darkens to one point of orange light (the card scene starts from black)

  blender-venv/bin/python panels5.py -- --assets DIR [--hook wide] [--preview|--gpu] [--frames a-b|--list ...] [--out DIR]
"""
import json, math, os, random, sys
HERE = os.path.dirname(os.path.abspath(__file__))
for p in (HERE, os.path.join(HERE, '..', 'dual'), os.path.join(HERE, '..', 'commercial2'), os.path.join(HERE, '..', 'commercial')):
    if p not in sys.path: sys.path.insert(0, p)
from scout3d import *
from phone2 import build_phone2
from world5 import build_floor, haze, L_
from mathutils import Vector, Matrix

random.seed(1200)
START, END = 1200, 1410
sc = init(END, samples=96, gpu_samples=128)
sc.frame_start = START
sc.cycles.transparent_max_bounces = 16
from world5 import compact_frames; compact_frames(sc)

WIDE = arg('--hook') == 'wide'
if WIDE: sc.render.resolution_x, sc.render.resolution_y = 1920, 1080
S = lambda n: os.path.join(ASSETS, n)
DARK0, DARK1 = 1394, 1410

PH2 = Vector((7.2, 30.2, 1.15))
fl, floor_glow, floor_mix = build_floor(52)
key_val(floor_glow, [(DARK0, 0.6), (DARK1, 0.0)])
_, hz = haze('HazeN2', (PH2.x + 1.5, PH2.y + 9, 0.8), EMBER, [(START, 0.3), (DARK0, 0.3), (DARK1, 0.0)], size=30, radius=6.0)
phone, pscr = build_phone2('NextPhone', [(S('n11c-sold.png'), 1, 'cut'), (S('n13-watchlist.png'), 1214, 'fade'), (S('n14-activity.png'), 1300, 'fade')], screen_glow=1.05)
phone.location = PH2 + Vector((0, 0, 0.03)); phone.rotation_euler = (0, 0, 0)
keys(phone, 'rotation_euler', [(1240, (0, 0, 0)), (1300, (0, 0, math.radians(8))), (1380, (0, 0, math.radians(-6)))], interp='SINE', easing='EASE_IN_OUT')
psb = next(n for n in pscr.data.materials[0].node_tree.nodes if n.type == 'BSDF_PRINCIPLED')
key_val(psb.inputs['Emission Strength'], [(DARK0, 1.05), (DARK1, 0.0)])
sc.frame_set(START); bpy.context.view_layer.update()
def on_screen(u, v):
    return pscr.matrix_world @ Vector(((u - 0.5) * SCREEN_W, (0.5 - v) * SCREEN_H, 0.0))
NRM = (pscr.matrix_world.to_3x3() @ Vector((0, 0, 1))).normalized()

# ---------------------------------------------------------------- the three panels
PW = 0.78
PANELS = {}
for name, img, dest, yaw, t0, focus in (('Portfolio', 'panel-portfolio.png', PH2 + Vector((-1.05, 0.55, 0.2)), 26, 1222, 1236),
                                        ('Community', 'panel-feed.png', PH2 + Vector((1.05, 0.55, 0.2)), -26, 1228, 1288),
                                        ('Leaderboard', 'panel-leaders.png', PH2 + Vector((0.0, 0.95, 1.55)), 0, 1234, 1346)):
    root, face, h, fade, glow = glass_panel(name, S(img), PW, depth=0.04, glow=1.1)
    keys(root, 'location', [(t0, tuple(PH2 + Vector((0, 0.05, 0.0)))), (t0 + 24, tuple(dest)), (END, tuple(dest + Vector((0, 0, 0.04))))], interp='SINE', easing='EASE_OUT')
    keys(root, 'rotation_euler', [(t0, (0, 0, 0)), (t0 + 24, (math.radians(-6 if name == 'Leaderboard' else 0), 0, math.radians(yaw)))])
    keys(root, 'scale', [(t0, (0.2, 0.2, 0.2)), (t0 + 24, (1, 1, 1))])
    key_val(glow, [(t0, 0.0), (t0 + 8, 1.1), (focus - 4, 1.1), (focus, 1.35), (focus + 50, 1.1), (DARK0, 1.0), (DARK1, 0.0)])
    visible(root, [(t0, END)])
    for ob in root.children_recursive: visible(ob, [(t0, END)])
    PANELS[name] = (dest, yaw, h)

# ---------------------------------------------------------------- light
L_('NKey2', PH2 + Vector((-1.4, -3.0, 2.2)), PH2, 2.0, (1.0, 0.92, 0.85), [(START, 70.0), (DARK0, 70.0), (DARK1, 0.0)])
L_('NRimL2', PH2 + Vector((-1.6, 1.4, 0.6)), PH2, 0.2, EMBER, [(START, 240.0), (DARK0, 240.0), (DARK1, 0.0)], size_y=3.0)
L_('NRimR2', PH2 + Vector((1.6, 1.2, -0.2)), PH2, 0.2, (1.0, 0.62, 0.36), [(START, 200.0), (DARK0, 200.0), (DARK1, 0.0)], size_y=3.0)
L_('NTop', PH2 + Vector((0.3, -1.0, 3.8)), PH2, 2.0, (1.0, 0.93, 0.86), [(START, 25.0), (DARK0, 25.0), (DARK1, 0.0)])
L_('PanelFill', PH2 + Vector((0, -3.5, 2.5)), PH2 + Vector((0, 0.6, 0.6)), 4.0, (1.0, 0.85, 0.75), [(1220, 0.0), (1250, 30.0), (DARK0, 30.0), (DARK1, 0.0)])
for ob in bpy.data.objects:
    if ob.type == 'LIGHT': ob.visible_camera = False; ob.visible_glossy = ob.name not in ('PanelFill', 'NTop', 'NKey2')   # no light shapes mirrored in the glass panels
fg = bpy.data.collections.new('FloorOnly'); fg.objects.link(fl)
for nm in ('NKey2', 'NRimL2', 'NRimR2', 'NTop', 'PanelFill'):
    bpy.data.objects[nm].light_linking.receiver_collection = fg
    for co in fg.collection_objects: co.light_linking.link_state = 'EXCLUDE'
# one point of orange light remains (the card scene opens on it)
em_m, em_e = emissive('Ember', EMBER_HOT, 0.0)
bpy.ops.mesh.primitive_uv_sphere_add(radius=0.03, segments=24, ring_count=12, location=tuple(PH2 + Vector((0, -0.4, 0.4)))); ember = bpy.context.active_object
ember.data.materials.append(em_m); key_val(em_e.inputs['Strength'], [(DARK0 - 6, 0.0), (DARK0 + 4, 30.0), (DARK1, 8.0)])
visible(ember, [(DARK0 - 6, END)])

# ---------------------------------------------------------------- camera
cam = Camera(lens=35, fstop=2.8)
p0 = on_screen(0.5, 0.55)
cam.key(START, tuple(p0 + NRM * 1.9 + Vector((0, 0, 0.1))), tuple(p0 + Vector((0, 0, 0.1))), tuple(p0))
cam.key(1232, tuple(PH2 + Vector((0.0, -4.4, 0.6))), tuple(PH2 + Vector((0, 0.4, 0.45))), tuple(PH2), 4.0, 35)
def facing(name, d, up=0.15):
    dest, yaw, h = PANELS[name]
    n_ = Matrix.Rotation(math.radians(yaw), 3, 'Z') @ Vector((0, -1, 0))
    return tuple(dest + n_ * d + Vector((0, 0, up))), tuple(dest + Vector((0, 0, up)))
c, t = facing('Portfolio', 2.3); cam.key(1262, c, t, t, 3.2)
c, t = facing('Portfolio', 2.2); cam.key(1280, c, t, t)
c, t = facing('Community', 2.3); cam.key(1314, c, t, t)
c, t = facing('Community', 2.2); cam.key(1336, c, t, t)
c, t = facing('Leaderboard', 2.3, 0.1); cam.key(1368, c, t, t)
c, t = facing('Leaderboard', 2.2, 0.1); cam.key(1388, c, t, t)
cam.key(END, tuple(PH2 + Vector((0.0, -4.8, 1.0))), tuple(PH2 + Vector((0, -0.4, 0.5))), tuple(PH2 + Vector((0, -0.4, 0.4))), 4.0)
cam.smooth()
if arg('--save'): bpy.ops.file.pack_all()
render(os.path.join(HERE, 'frames', 'panels5'))
