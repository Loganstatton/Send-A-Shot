"""Scene 2 (3.0–9.0 s): DISCOVER. BACK. TRADE.
A 3D phone running the real NEXT app (invented artists) spins in; app cards
orbit it; the viewer opens Juno Marrow, listens, and backs her with virtual
credits. 180 frames at 30 fps.

  blender-venv/bin/python scene2.py -- --assets DIR [--preview|--gpu] [--frames a-b|--list ...] [--out DIR]
"""
import math, os, random, sys
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from next3d import *
from mathutils import Vector

random.seed(21)
sc = init(180)
S = lambda name: os.path.join(ASSETS, name)

# ---------------------------------------------------------------- phone
states = [(S('01-discover.png'), 1, 'cut'), (S('02-discover-grid.png'), 40, 'up'), (S('03-artist.png'), 86, 'push'),
          (S('04-back-amount.png'), 122, 'up'), (S('05-confirm.png'), 140, 'cut'), (S('06-backed.png'), 156, 'fade')]
phone, scr = build_phone('Phone', states)
spin = link(bpy.data.objects.new('PhoneSpin', None)); phone.parent = spin
keys(spin, 'location', [(1, (0.7, 4.5, -1.4)), (30, (0.0, 0.0, 0.0)), (80, (0.0, 0.0, 0.04)), (120, (0.0, 0.0, 0.0)), (180, (0.0, 0.0, 0.0))])
keys(spin, 'rotation_euler', [(1, (math.radians(22), 0, math.radians(-560))), (30, (math.radians(4), 0, math.radians(-14))),
                              (80, (math.radians(3), 0, math.radians(9))), (120, (math.radians(2), 0, math.radians(-6))),
                              (180, (math.radians(0), 0, math.radians(-2)))])
for fc in iter_fcurves(spin.animation_data.action):
    for kp in fc.keyframe_points:
        if round(kp.co.x) == 1: kp.interpolation = 'EXPO'; kp.easing = 'EASE_OUT'

# Taps on the real buttons (positions detected from the screenshots).
tap_ripple(scr, 0.287, 0.528, 80)     # "Back this artist"
tap_ripple(scr, 0.500, 0.792, 137)    # "Review purchase"
tap_ripple(scr, 0.380, 0.743, 153)    # "Confirm purchase"

# ---------------------------------------------------------------- orbiting app cards
orbit = link(bpy.data.objects.new('CardOrbit', None))
keys(orbit, 'rotation_euler', [(1, (0, 0, math.radians(-25))), (90, (0, 0, math.radians(45)))], interp='LINEAR')
cards = ['card-2.png', 'card-3.png', 'card-4.png', 'card-5.png', 'card-6.png', 'card-7.png', 'card-8.png']
for i, c in enumerate(cards):
    if not os.path.exists(S(c)): continue
    edge, face, h = image_card(f'Card{i}', S(c), 0.46)
    holder = link(bpy.data.objects.new(f'CardHolder{i}', None)); holder.parent = orbit
    ang = 2 * math.pi * i / len(cards) + 0.3
    rad = 1.25 + 0.25 * (i % 2)
    holder.location = (rad * math.sin(ang), -rad * math.cos(ang) * 0.55 + 0.4, -0.75 + 1.45 * ((i * 0.37) % 1))
    edge.parent = holder
    edge.rotation_euler = (math.radians(90), math.radians(random.uniform(-14, 14)), math.radians(random.uniform(-25, 25)) + ang * 0.25)
    f_in = 8 + i * 3
    keys(holder, 'scale', [(1, (0, 0, 0)), (f_in, (0, 0, 0)), (f_in + 14, (1, 1, 1)), (76, (1, 1, 1)), (88, (0, 0, 0))])
    keys(holder, 'location', [(76, tuple(holder.location)), (88, tuple(Vector(holder.location) * 2.2))])
    for fc in iter_fcurves(holder.animation_data.action):
        for kp in fc.keyframe_points:
            if round(kp.co.x) == f_in: kp.interpolation = 'BACK'; kp.easing = 'EASE_OUT'
            if round(kp.co.x) == 76: kp.interpolation = 'EXPO'; kp.easing = 'EASE_IN'

# ---------------------------------------------------------------- listen: pulse rings + sparks off the cover
bpy.context.view_layer.update()
cover_local = screen_point(scr, 0.5, 0.36, 0.01)
ring_mat, ring_e = emissive('Ring', EMBER_HOT, 0.0)
for k, f0 in enumerate((92, 100, 108)):
    bpy.ops.mesh.primitive_torus_add(major_radius=0.18, minor_radius=0.006, major_segments=96, minor_segments=8)
    ring = bpy.context.active_object
    rm, e = glow_material(f'Ring{k}', EMBER_HOT, 0.0); ring.data.materials.append(rm)
    ring.parent = scr; ring.location = cover_local
    visible(ring, [(f0 - 1, f0 + 22)])
    for f, s, st in ((f0 - 1, 0.3, 0.0), (f0, 0.4, 14.0), (f0 + 22, 3.2, 0.0)):
        ring.scale = (s, s, s); ring.keyframe_insert('scale', frame=f)
        e.inputs['Strength'].default_value = st; e.inputs['Strength'].keyframe_insert('default_value', frame=f)

def burst_from_screen(name, u, v, frame, count, spread, toward_cam, vanish):
    sc.frame_set(frame); bpy.context.view_layer.update()
    mw = scr.matrix_world
    origin = mw @ screen_point(scr, u, v, 0.01)
    normal = (mw.to_3x3() @ Vector((0, 0, 1))).normalized()
    starts, targets, bursts, delays = [], [], [], []
    for _ in range(count):
        jitter = Vector((random.gauss(0, 0.12), random.gauss(0, 0.02), random.gauss(0, 0.12)))
        s = origin + jitter
        d = Vector((random.gauss(0, 1), random.gauss(0, 1), random.gauss(0, 1))).normalized()
        tgt = s + d * random.uniform(0.3, spread) + normal * random.uniform(0.2, toward_cam)
        starts.append(s); targets.append(tgt); bursts.append(d * random.uniform(0.05, 0.25)); delays.append(frame + random.uniform(0, 6))
    return particles(name, starts, targets, bursts, delays, frame, settle=10, base=0.0022, fly=0.0035, noise_amp=0.25,
                     appear=frame, vanish=vanish)

burst_from_screen('ListenSparks', 0.5, 0.36, 92, 900, 1.2, 0.9, (110, 124))
burst_from_screen('SuccessSparks', 0.5, 0.73, 157, 1400, 1.3, 1.0, (168, 180))

# ---------------------------------------------------------------- set & light
backdrop_m = bpy.data.materials.new('Backdrop'); backdrop_m.use_nodes = True
nt = backdrop_m.node_tree; nt.nodes.clear()
tc = nt.nodes.new('ShaderNodeTexCoord'); gr = nt.nodes.new('ShaderNodeTexGradient'); gr.gradient_type = 'SPHERICAL'
mp = nt.nodes.new('ShaderNodeMapping'); mp.inputs['Scale'].default_value = (0.2, 0.2, 0.2)
em = nt.nodes.new('ShaderNodeEmission'); em.inputs['Color'].default_value = (*EMBER, 1)
mu = nt.nodes.new('ShaderNodeMath'); mu.operation = 'POWER'; mu.inputs[1].default_value = 3.0
mu2 = nt.nodes.new('ShaderNodeMath'); mu2.operation = 'MULTIPLY'; mu2.inputs[1].default_value = 0.12
out = nt.nodes.new('ShaderNodeOutputMaterial')
nt.links.new(tc.outputs['Object'], mp.inputs['Vector']); nt.links.new(mp.outputs['Vector'], gr.inputs['Vector'])
nt.links.new(gr.outputs['Fac'], mu.inputs[0]); nt.links.new(mu.outputs[0], mu2.inputs[0]); nt.links.new(mu2.outputs[0], em.inputs['Strength'])
nt.links.new(em.outputs[0], out.inputs['Surface'])
bpy.ops.mesh.primitive_plane_add(size=30, location=(0, 9, 0.5), rotation=(math.radians(90), 0, 0))
bpy.context.active_object.data.materials.append(backdrop_m)

rig = link(bpy.data.objects.new('Rig', None))
for nm, loc, sz, szy, e in (('StripL', (-2.6, -2.2, 1.6), 0.12, 5.0, 160), ('StripR', (2.8, -1.4, 0.6), 0.12, 5.0, 120), ('Top', (0.3, -1.6, 3.4), 4.0, 0.15, 140)):
    l = look_light(nm, loc, (0, 0, 0), sz, e, size_y=szy); l.parent = rig
keys(rig, 'rotation_euler', [(1, (0, 0, math.radians(-25))), (180, (0, 0, math.radians(25)))], interp='LINEAR')
look_light('Rim', (0.4, 3.0, 1.4), (0, 0, 0), 3.0, 380, color=EMBER)
look_light('Fill', (0, -6, -0.8), (0, 0, 0), 5.0, 30)

# ---------------------------------------------------------------- camera
cam = Camera(lens=50, fstop=2.4)
cam.key(1, (0.6, -6.6, 1.0), (0, 0, 0.15), (0, 0, 0))
cam.key(40, (0.25, -5.9, 0.5), (0, 0, 0.18), (0, 0, 0))
cam.key(80, (-0.45, -5.5, 0.35), (0, 0, 0.18), (0, 0, 0))
cam.key(122, (0.35, -5.1, 0.32), (0, 0, 0.14), (0, 0, 0), 2.8)
cam.key(156, (0.12, -4.6, 0.25), (0, 0, 0.08), (0, 0, 0))
cam.key(180, (0.02, -3.1, 0.12), (0, 0, 0.02), (0, 0, 0), 2.0)
cam.smooth()
cam.bind(1)
render(os.path.join(HERE, 'frames_s2'))
