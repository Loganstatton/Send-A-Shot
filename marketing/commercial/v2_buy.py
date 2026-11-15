"""v2 shot 2 (3.0–8.4 s, global frames 91–252): THE BUY.
The real app on a big, close 3D phone: Juno Marrow's page (no backers yet) →
the trade form with $250 of virtual credits → confirm → "Bought 5.6779 shares".
The camera pushes in so the numbers are readable on a phone. 162 frames.

  blender-venv/bin/python v2_buy.py -- --assets DIR [--preview|--gpu] [--frames a-b|--list ...] [--out DIR]
"""
import math, os, random, sys
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from next3d import *
from mathutils import Vector

random.seed(22)
sc = init(162)
S = lambda name: os.path.join(ASSETS, name)
Z = lambda v: (0.5 - v) * SCREEN_H          # screen height (from the top) -> world z on the phone

# ---------------------------------------------------------------- phone
states = [(S('03-artist.png'), 1, 'cut'), (S('04-back-amount.png'), 55, 'up'),
          (S('05-confirm.png'), 91, 'cut'), (S('06-backed.png'), 109, 'fade')]
phone, scr = build_phone('Phone', states, screen_glow=1.08)
spin = link(bpy.data.objects.new('PhoneSpin', None)); phone.parent = spin
keys(spin, 'location', [(1, (0.5, 3.2, -1.1)), (18, (0, 0, 0)), (90, (0, 0, 0.01)), (162, (0, 0, 0))])
keys(spin, 'rotation_euler', [(1, (math.radians(18), 0, math.radians(-430))), (18, (math.radians(3), 0, math.radians(-9))),
                              (54, (math.radians(2), 0, math.radians(-4))), (108, (math.radians(1), 0, math.radians(3))),
                              (162, (math.radians(1), 0, math.radians(-2)))])
for fc in iter_fcurves(spin.animation_data.action):
    for kp in fc.keyframe_points:
        if round(kp.co.x) == 1: kp.interpolation = 'EXPO'; kp.easing = 'EASE_OUT'

# Taps on the real buttons (positions measured on the captured screens).
tap_ripple(scr, 0.87, 0.955, 50)      # "Trade"
tap_ripple(scr, 0.500, 0.792, 86)     # "Review purchase"
tap_ripple(scr, 0.380, 0.743, 104)    # "Confirm purchase"

def burst_from_banner(name, frame, count, vanish):
    """Sparks thrown outward from the edges of the green "Bought" banner — they frame it, never cover it."""
    sc.frame_set(frame); bpy.context.view_layer.update()
    mw = scr.matrix_world
    normal = (mw.to_3x3() @ Vector((0, 0, 1))).normalized()
    c = mw @ screen_point(scr, 0.5, 0.72, 0.01)
    starts, targets, bursts, delays = [], [], [], []
    for _ in range(count):
        u, v = random.uniform(0.06, 0.94), random.choice((0.685, 0.755))
        if random.random() < 0.35: u, v = random.choice((0.06, 0.94)), random.uniform(0.685, 0.755)
        s = mw @ screen_point(scr, u, v, 0.01)
        out = (s - c); out = Vector((out.x * 1.0, out.y, out.z * 2.2)).normalized()
        starts.append(s); targets.append(s + out * random.uniform(0.25, 0.75) + normal * random.uniform(0.05, 0.35))
        bursts.append(out * random.uniform(0.03, 0.12)); delays.append(frame + random.uniform(0, 4))
    return particles(name, starts, targets, bursts, delays, frame, settle=11, base=0.0015, fly=0.0026, noise_amp=0.15,
                     appear=frame, vanish=vanish, glow=0.45)
burst_from_banner('BoughtSparks', 109, 650, (124, 138))

# ---------------------------------------------------------------- set: ember glow + out-of-focus app cards drifting behind
backdrop_m = bpy.data.materials.new('Backdrop'); backdrop_m.use_nodes = True
nt = backdrop_m.node_tree; nt.nodes.clear()
tc = nt.nodes.new('ShaderNodeTexCoord'); gr = nt.nodes.new('ShaderNodeTexGradient'); gr.gradient_type = 'SPHERICAL'
mp = nt.nodes.new('ShaderNodeMapping'); mp.inputs['Scale'].default_value = (0.2, 0.2, 0.2)
em = nt.nodes.new('ShaderNodeEmission'); em.inputs['Color'].default_value = (*EMBER, 1)
pw = nt.nodes.new('ShaderNodeMath'); pw.operation = 'POWER'; pw.inputs[1].default_value = 3.0
mu = nt.nodes.new('ShaderNodeMath'); mu.operation = 'MULTIPLY'; mu.inputs[1].default_value = 0.10
out = nt.nodes.new('ShaderNodeOutputMaterial')
nt.links.new(tc.outputs['Object'], mp.inputs['Vector']); nt.links.new(mp.outputs['Vector'], gr.inputs['Vector'])
nt.links.new(gr.outputs['Fac'], pw.inputs[0]); nt.links.new(pw.outputs[0], mu.inputs[0]); nt.links.new(mu.outputs[0], em.inputs['Strength'])
nt.links.new(em.outputs[0], out.inputs['Surface'])
bpy.ops.mesh.primitive_plane_add(size=30, location=(0, 9, 0.3), rotation=(math.radians(90), 0, 0))
bpy.context.active_object.data.materials.append(backdrop_m)
for i, c in enumerate(['card-1.png', 'card-3.png', 'card-5.png', 'card-6.png', 'card-7.png']):
    if not os.path.exists(S(c)): continue
    edge, face, h = image_card(f'BgCard{i}', S(c), 0.5, glow=0.7)
    x = (-1.5, 1.4, -1.1, 1.2, 0.0)[i]; zz = (0.7, 0.4, -0.6, -0.9, 1.1)[i]
    edge.rotation_euler = (math.radians(90), math.radians(random.uniform(-10, 10)), math.radians(random.uniform(-20, 20)))
    keys(edge, 'location', [(1, (x * 1.3, 2.4 + i * 0.3, zz)), (162, (x, 2.4 + i * 0.3, zz + 0.25))], interp='LINEAR')

rig = link(bpy.data.objects.new('Rig', None))
for nm, loc, sz, szy, e in (('StripL', (-2.6, -2.2, 1.6), 0.12, 5.0, 150), ('StripR', (2.8, -1.4, 0.6), 0.12, 5.0, 110)):
    look_light(nm, loc, (0, 0, 0), sz, e, size_y=szy).parent = rig
keys(rig, 'rotation_euler', [(1, (0, 0, math.radians(-20))), (162, (0, 0, math.radians(20)))], interp='LINEAR')
look_light('Rim', (0.4, 3.0, 1.4), (0, 0, 0), 3.0, 380, color=EMBER)
look_light('Fill', (0, -6, -0.8), (0, 0, 0), 5.0, 25)

# ---------------------------------------------------------------- camera: land → push into the trade form → the confirmation
cam = Camera(lens=50, fstop=4.0)
cam.key(1, (0.3, -5.4, 0.35), (0, 0, 0.05))
cam.key(18, (0.12, -4.35, 0.12), (0, 0, -0.02))
cam.key(50, (-0.08, -3.95, 0.04), (0, 0, -0.04))
cam.key(66, (0.10, -2.75, Z(0.62) + 0.06), (0, 0, Z(0.62)))
cam.key(88, (-0.04, -2.6, Z(0.63) + 0.03), (0, 0, Z(0.63)))
cam.key(106, (0.04, -2.55, Z(0.60) + 0.03), (0, 0, Z(0.60)))
cam.key(120, (0.10, -2.95, Z(0.63) + 0.05), (0, 0, Z(0.63)))
cam.key(162, (-0.10, -2.75, Z(0.64) + 0.02), (0, 0, Z(0.64)))
cam.smooth(); cam.bind(1)
render(os.path.join(HERE, 'frames_v2_buy'))
