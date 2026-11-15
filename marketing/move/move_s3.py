"""THE MOVE, shot 3 (8–15 s, frames 241–450): the trade, the market, the sale.

  241–295  the phone, the real Buy panel: $4,500, Review purchase, Confirm, "Bought 201.9749 shares of
           Kito Vale at $22.28." The camera pushes into the screen.
  296–389  the chart becomes an enormous 3D landscape (the same recorded series, about 80 m long): the
           line advances trade by trade from $22.53 to $29.82, each real trade a glass tower (its credits
           volume), with a light rule for each of the ten demo days.
  390–450  the phone again: the position (Unrealized P&L +$1,432.00), Sell all, Confirm, "Sold 201.9749
           shares of Kito Vale at $29.37."

  blender-venv/bin/python move_s3.py -- --journey J.json --assets SCREENS [--preview] [--frames 241-450] [--out DIR]
"""
from world_move import *

END = 450
P1, DIVE, LAND0, LAND1, P2 = 241, 296, 296, 389, 390
sc = init(END, samples=int(arg('--samples', '40')))
compact(sc)
sc.frame_start = P1
sc.cycles.max_bounces = 6; sc.cycles.glossy_bounces = 3; sc.cycles.diffuse_bounces = 2; sc.cycles.sample_clamp_indirect = 6.0
sc.render.motion_blur_shutter = 0.4
world_dark(sc)
M = materials()
TAPS = json.load(open(S_('taps.json')))

# ================================================================= the hall (phone parts)
build_floor(); build_monoliths(M)
ch = Chart(area_gain=0.6); ch.head_e.inputs['Strength'].default_value = 40.0
PH = Vector((0.0, -3.0, 2.45))
phone, scr = build_phone('Phone', [
    (S_('m04a-trade-empty.png'), 1, 'cut'), (S_('m04-buy-amount.png'), 248, 'cut'), (S_('m05-buy-confirm.png'), 260, 'cut'),
    (S_('m06-bought.png'), 273, 'cut'),
    (S_('m07b-position.png'), P2, 'cut'), (S_('m09c-sell-confirm.png'), 409, 'cut'), (S_('m10-sold.png'), 428, 'cut')], screen_glow=1.3)
phone.location = PH
keys(phone, 'rotation_euler', [(P1, (math.radians(-2), 0, math.radians(-4))), (DIVE, (0, 0, 0)), (P2, (math.radians(-1), 0, math.radians(3))),
                               (END, (math.radians(-2), 0, math.radians(-2)))], interp='BEZIER')
for k, f in (('amount', 245), ('review_buy', 257), ('confirm_buy', 270), ('confirm_sell', 425)):
    tap_ripple(scr, TAPS[k]['u'], TAPS[k]['v'], f)
# before the market moves the hall's chart shows only listing → pick; after it, the whole run
def hall_chart(scene, *_):
    f = scene.frame_current + scene.frame_subframe
    ch.reveal(1.0 if f < LAND1 else N - 1)
bpy.app.handlers.frame_change_pre.append(hall_chart)
HOLOS = [(1, (-1.25, -0.6, 3.15), 28), (2, (1.3, -0.3, 1.75), -28), (3, (-1.45, 1.4, 1.55), 24), (4, (1.5, 1.7, 3.35), -24)]
for k, (ci, loc, yaw) in enumerate(HOLOS):
    p = S_(f'card-{ci}.png')
    if os.path.exists(p): holo(f'Holo{k}', p, 1.25, loc, yaw, glow=0.6)
base_lights(key=650, rim=0.8)
look_light('PhoneKey', (-1.6, -5.2, 4.6), tuple(PH), 1.6, 160, (1.0, 0.95, 0.9), size_y=0.5)
look_light('PhoneRim', (1.8, -1.6, 3.4), tuple(PH), 0.3, 140, EMBER_HOT, size_y=2.4)

# ================================================================= the landscape (the same series, enormous), far from the hall
LX = 400.0                                    # its own place in the world
build_floor(center=(LX, 40, 0), size=320, tile=9.6)
big = Chart(x0=LX - 40, x1=LX + 40, y=30.0, z0=0.0, h=26.0, line_r=0.36, line_strength=30.0, bar_w=1.8, bar_h=6.5,
            area_gain=0.75, grid_strength=0.5, name='Land')
for j in range(10):                           # a row of chrome monoliths behind the chart (never between it and the lens)
    x = LX - 49 + j * 11; y = 44.0
    col = rounded_slab(f'LMono{j}', 3.0, 40.0, 0.2, depth=1.4, bevel=0.06, mat=M['dark_chrome'] if j % 2 else M['brushed'])
    col.rotation_euler = (math.radians(90), 0, 0); col.location = (x, y, 20.0)
    sm, _ = emissive(f'LMonoStrip{j}', EMBER_HOT, 7.0)
    bpy.ops.mesh.primitive_cube_add(size=1, location=(x + 1.52, y - 1.0, 20.0)); st = bpy.context.active_object
    st.scale = (0.03, 0.12, 39.0); st.data.materials.append(sm)
for mat in (bpy.data.materials['LandVolBuy'], bpy.data.materials['LandVolSell']):    # the towers: dark glass with a glow, not plastic
    bb = mat.node_tree.nodes['Principled BSDF']; bb.inputs['Emission Strength'].default_value = 0.45
    bb.inputs['Roughness'].default_value = 0.04; bb.inputs['Coat Weight'].default_value = 1.0
LAND_T0, LAND_T1 = LAND0 + 6, LAND1 - 8
def land_idx(f):
    t = min(max((f - LAND_T0) / (LAND_T1 - LAND_T0), 0.0), 1.0)
    return 1.0 + (N - 2) * (t * t * (3 - 2 * t)) if f >= LAND_T0 else 1.0
def landscape(scene, *_):
    f = scene.frame_current + scene.frame_subframe
    big.reveal(land_idx(f))
bpy.app.handlers.frame_change_pre.append(landscape)
look_light('LandTop', (LX, 10, 60), (LX, 30, 0), 60.0, 9000, (1.0, 0.94, 0.88), size_y=20.0)
look_light('LandWash', (LX, 26, 2.0), (LX, -20, 0), 70.0, 2500, EMBER, size_y=2.0)
finish_lights()

# ================================================================= cameras (hard cuts via markers)
camA = Camera(lens=50, fstop=2.8)                                       # phone, the buy, then into the screen
camA.key(P1, (-0.15, -6.75, 2.5), tuple(PH + Vector((0, 0, 0.04))), tuple(PH), 2.8, 50)
camA.key(276, (0.0, -6.2, 2.47), tuple(PH + Vector((0, 0, 0.02))), tuple(PH))
camA.key(DIVE - 1, (0.0, -3.55, 2.46), tuple(PH + Vector((0, 0, 0.0))), tuple(PH), 2.8, 50)
camA.smooth(); camA.bind(P1)
camB = Camera(lens=24, fstop=5.6)                                       # the landscape: track the head, low and close
def head_at(f): return big.pt(land_idx(f))
for f in (LAND0, LAND0 + 20, LAND0 + 40, LAND0 + 60, LAND0 + 80, LAND1):
    h = head_at(f)
    u = (f - LAND0) / (LAND1 - LAND0)
    camB.key(f, (h.x + 10.0, 30.0 - 21.0 + 4.0 * u, max(h.z + 3.2, 12.0 - 6.0 * u)), (h.x - 8.0, 30.0, h.z - 3.5), tuple(h), 5.6, 24)
camB.smooth(); camB.bind(LAND0)
camC = Camera(lens=50, fstop=2.8)                                       # back on the phone for the sale
camC.key(P2, (0.35, -6.0, 2.42), tuple(PH + Vector((0, 0, 0.02))), tuple(PH), 2.8, 50)
camC.key(END, (0.05, -5.55, 2.46), tuple(PH + Vector((0, 0, 0.03))), tuple(PH))
camC.smooth(); camC.bind(P2)
render(os.path.join(MHERE, 'frames', 's3'))
