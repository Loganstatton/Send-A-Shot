"""THE MOVE, shot 2 (3–8 s, frames 91–240): discovery. The phone enters the market hall on the drive
downbeat. It shows the real NEXT Discover screen, scrolls to Kito Vale's card, taps it, and opens her
real artist page (score 63, $22.03). Large holographic NEXT Discover cards (real captures) float in the
hall; the finished price chart glows behind.

  blender-venv/bin/python move_s2.py -- --journey J.json --assets SCREENS [--preview] [--frames 91-240] [--out DIR]
"""
from world_move import *

END = 240
sc = init(END, samples=int(arg('--samples', '40')))
sc.frame_start = 91
sc.cycles.max_bounces = 6; sc.cycles.glossy_bounces = 3; sc.cycles.diffuse_bounces = 2; sc.cycles.sample_clamp_indirect = 6.0
sc.render.motion_blur_shutter = 0.4
world_dark(sc)
M = materials(); build_floor(); build_monoliths(M)
ch = Chart(area_gain=0.6); ch.reveal(N - 1)
ch.head_e.inputs['Strength'].default_value = 40.0
TAPS = json.load(open(S_('taps.json')))

# ---------------------------------------------------------------- the phone
PH = Vector((0.0, -3.0, 2.45))
phone, scr = build_phone('Phone', [(S_('m01-discover.png'), 1, 'cut'), (S_('m02b-grid-pick.png'), 128, 'up'), (S_('m03-artist.png'), 170, 'push')],
                         screen_glow=1.3)
keys(phone, 'location', [(91, tuple(PH + Vector((0.95, 0.9, -1.15)))), (105, tuple(PH + Vector((-0.04, 0, 0.03)))), (114, tuple(PH)),
                         (END, tuple(PH + Vector((0, 0, 0.06))))], interp='BEZIER')
keys(phone, 'rotation_euler', [(91, (math.radians(-28), math.radians(-14), math.radians(-38))), (106, (math.radians(1.5), 0, math.radians(2))),
                               (116, (0, 0, 0)), (END, (math.radians(-2), 0, math.radians(-4)))], interp='BEZIER')
phone.scale = (1.0, 1.0, 1.0)
tap_ripple(scr, TAPS['pick_card']['u'], TAPS['pick_card']['v'], 166)

# ---------------------------------------------------------------- holographic Discover cards around it (real captures)
HOLOS = [(1, (-1.25, -0.6, 3.15), 28), (2, (1.3, -0.3, 1.75), -28), (3, (-1.45, 1.4, 1.55), 24), (4, (1.5, 1.7, 3.35), -24),
         (5, (-0.6, 3.6, 4.1), 8), (8, (0.75, 3.9, 0.95), -8)]
for k, (ci, loc, yaw) in enumerate(HOLOS):
    p = S_(f'card-{ci}.png')
    if not os.path.exists(p): continue
    e, h = holo(f'Holo{k}', p, 1.25, loc, yaw, glow=0.7)
    keys(e, 'location', [(91, (loc[0] * 1.6, loc[1] - 0.8, loc[2] - 0.3)), (122, loc), (END, (loc[0] * 1.04, loc[1], loc[2] + 0.18))], interp='BEZIER')

# ---------------------------------------------------------------- light
base_lights(key=650, rim=0.8)
look_light('PhoneKey', (-1.6, -5.2, 4.6), tuple(PH), 1.6, 160, (1.0, 0.95, 0.9), size_y=0.5)      # a clean line of light along the glass
look_light('PhoneRim', (1.8, -1.6, 3.4), tuple(PH), 0.3, 140, EMBER_HOT, size_y=2.4)
finish_lights()

# ---------------------------------------------------------------- camera: follows the entry, then a slow push to the screen
cam = Camera(lens=50, fstop=2.8)
cam.key(91, (1.1, -9.0, 2.0), tuple(PH + Vector((0.6, 0, -0.5))), tuple(PH), 2.8, 45)
cam.key(110, (0.45, -8.1, 2.3), tuple(PH + Vector((0, 0, 0.05))), tuple(PH))
cam.key(170, (0.15, -7.2, 2.42), tuple(PH + Vector((0, 0, 0.02))), tuple(PH), 2.8, 50)
cam.key(END, (-0.15, -6.75, 2.5), tuple(PH + Vector((0, 0, 0.04))), tuple(PH))
cam.smooth()
render(os.path.join(MHERE, 'frames', 's2'))
