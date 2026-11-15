"""THE MOVE, hook B (0–3 s, frames 1–90): phone first. The phone fills the frame on the real NEXT
portfolio page (Total return +14.3%, $1,432.00; "Paper trading — NEXT Credits have no real monetary
value"). The camera pushes in, and on the lock (frame 46) a blade of light sweeps the glass. The climbing
figure and the disclosure are composited in post (post_move.py --hook b).

  blender-venv/bin/python move_hookb.py -- --journey J.json --assets SCREENS [--preview] [--frames 1-90] [--out DIR]
"""
from world_move import *

END, LOCK = 90, 46
sc = init(END, samples=int(arg('--samples', '40')))
compact(sc)
sc.cycles.max_bounces = 6; sc.cycles.glossy_bounces = 3; sc.cycles.diffuse_bounces = 2; sc.cycles.sample_clamp_indirect = 6.0
sc.render.motion_blur_shutter = 0.4
world_dark(sc)
M = materials(); build_floor(); build_monoliths(M)
ch = Chart(area_gain=0.7)
def grow(scene, *_):
    f = scene.frame_current + scene.frame_subframe
    t = min(max((f - 1) / (LOCK - 1), 0.0), 1.0); ch.reveal(1.35 + (N - 2.35) * (1 - (1 - t) ** 2.6))
bpy.app.handlers.frame_change_pre.append(grow)
PH = Vector((0.0, -3.0, 2.45))
phone, scr = build_phone('Phone', [(S_('m11-portfolio.png'), 1, 'cut')], screen_glow=1.3)
keys(phone, 'location', [(1, tuple(PH + Vector((0.0, 0.0, -0.08)))), (END, tuple(PH + Vector((0, 0, 0.04))))], interp='BEZIER')
keys(phone, 'rotation_euler', [(1, (math.radians(6), 0, math.radians(-12))), (LOCK, (math.radians(1), 0, math.radians(-2))),
                               (END, (0, 0, math.radians(1)))], interp='BEZIER')
base_lights(key=650, rim=0.8)
look_light('PhoneKey', (-1.6, -5.2, 4.6), tuple(PH), 1.6, 160, (1.0, 0.95, 0.9), size_y=0.5)
look_light('PhoneRim', (1.8, -1.6, 3.4), tuple(PH), 0.3, 140, EMBER_HOT, size_y=2.4)
blade = area('Blade', (-1.2, -4.2, 2.45), (math.radians(90), 0, math.radians(18)), 0.05, 0.0, (1.0, 0.95, 0.88), size_y=3.0)
keys(blade, 'location', [(LOCK - 5, (-1.4, -4.2, 2.45)), (LOCK + 10, (1.4, -4.2, 2.45))], interp='SINE')
blade.data.energy = 0.0; blade.data.keyframe_insert('energy', frame=LOCK - 6)
blade.data.energy = 260.0; blade.data.keyframe_insert('energy', frame=LOCK - 1); blade.data.keyframe_insert('energy', frame=LOCK + 7)
blade.data.energy = 0.0; blade.data.keyframe_insert('energy', frame=LOCK + 12)
finish_lights()
cam = Camera(lens=50, fstop=2.8)
cam.key(1, (0.45, -9.6, 2.95), tuple(PH + Vector((0, 0, 0.62))), tuple(PH), 2.8, 50)
cam.key(LOCK, (0.1, -9.1, 3.0), tuple(PH + Vector((0, 0, 0.62))), tuple(PH))
cam.key(END, (-0.1, -8.8, 3.02), tuple(PH + Vector((0, 0, 0.62))), tuple(PH))
cam.smooth()
render(os.path.join(MHERE, 'frames', 'hookb'))
