"""THE MOVE: the shared market hall: black lacquer floor with satin chrome seams, chrome monoliths with
ember light strips, the real price chart at any scale, holographic NEXT displays, lights. Shots 2–5
and hooks B/C import this; move_hook.py (hook A) builds the same pieces inline.
"""
import json, math, os, sys
MHERE = os.path.dirname(os.path.abspath(__file__))
for p in (MHERE, os.path.join(MHERE, '..', 'commercial')):
    if p not in sys.path: sys.path.insert(0, p)
from next3d import *
import bpy
from mathutils import Vector, Matrix

J = json.load(open(arg('--journey', os.path.join(MHERE, 'journey.json'))))
SCREENS = arg('--assets', os.path.join(MHERE, 'assets'))
S_ = lambda n: os.path.join(SCREENS, n)
SERIES = J['series'][:-1]                       # listing ... exit price (the last recorded point follows the sale)
PICK, SHARES = J['plan']['pick'], J['hero_buy']['shares']
N = len(SERIES)
TRADES = [t for t in J['trades'] if not (t['hero'] and t['type'] == 'sell')]
def exit_pnl(p):
    """lib/next-market.ts quoteSell (sell-all at price p) minus the $4,500 cost: the app's Unrealized P&L."""
    notional = round(SHARES * p); post = max(100, round(p * (1 - notional / 1_000_000 * 0.05)))
    return round(SHARES * max(100, round((p + post) / 2))) - PICK
PNL = [exit_pnl(p) for p in SERIES]
assert PNL[-1] == 143_200

def compact(sc):
    """On the GPU pods: write each frame as half-float EXR (DWAA, visually lossless, ~10x smaller than Radiance
    HDR) under the toolkit's f####.hdr name; post_move.py reads it by content."""
    if not GPU: return
    s_ = sc.render.image_settings; s_.file_format = 'OPEN_EXR'; s_.color_depth = '16'; s_.exr_codec = 'DWAA'
    sc.render.use_file_extension = False

def materials():
    return dict(lacquer=principled('BlackLacquer', (0.0025, 0.0024, 0.0026), rough=0.05, coat=1.0),
                chrome=principled('Chrome', (0.9, 0.9, 0.92), metallic=1.0, rough=0.07),
                dark_chrome=principled('DarkChrome', (0.32, 0.31, 0.31), metallic=1.0, rough=0.14),
                brushed=principled('Brushed', (0.55, 0.55, 0.57), metallic=1.0, rough=0.22, aniso=0.6))

def build_floor(center=(0, 20, 0), size=200, tile=3.2):
    bpy.ops.mesh.primitive_plane_add(size=size, location=center); fl = bpy.context.active_object
    m = principled('Floor', (0.003, 0.0028, 0.003), rough=0.045, coat=1.0)
    nt = m.node_tree; b = nt.nodes['Principled BSDF']
    tc = nt.nodes.new('ShaderNodeTexCoord'); mp = nt.nodes.new('ShaderNodeMapping'); mp.inputs['Scale'].default_value = (1 / tile, 1 / tile, 1)
    nt.links.new(tc.outputs['Object'], mp.inputs['Vector'])
    br = nt.nodes.new('ShaderNodeTexBrick'); br.offset = 0.0
    br.inputs['Mortar Size'].default_value = 0.006; br.inputs['Mortar Smooth'].default_value = 0.2
    br.inputs['Brick Width'].default_value = 1.0; br.inputs['Row Height'].default_value = 1.0
    for k_, c_ in (('Color1', (0, 0, 0, 1)), ('Color2', (0, 0, 0, 1)), ('Mortar', (1, 1, 1, 1))): br.inputs[k_].default_value = c_
    nt.links.new(mp.outputs['Vector'], br.inputs['Vector'])
    mx = nt.nodes.new('ShaderNodeMix'); mx.data_type = 'RGBA'; nt.links.new(br.outputs['Fac'], mx.inputs['Factor'])
    sock(mx.inputs, 'A', 'RGBA').default_value = (0.003, 0.0028, 0.003, 1); sock(mx.inputs, 'B', 'RGBA').default_value = (0.16, 0.16, 0.17, 1)
    nt.links.new(sock(mx.outputs, 'Result', 'RGBA'), b.inputs['Base Color']); nt.links.new(br.outputs['Fac'], b.inputs['Metallic'])
    rr = nt.nodes.new('ShaderNodeMapRange'); rr.inputs['To Min'].default_value = 0.045; rr.inputs['To Max'].default_value = 0.4
    nt.links.new(br.outputs['Fac'], rr.inputs['Value']); nt.links.new(rr.outputs[0], b.inputs['Roughness'])
    fl.data.materials.append(m)
    return fl

def build_monoliths(M, xs=(4.3, 4.65, 5.0), ys=(4.0, 12.0, 20.0), h=14.0, strip=9.0):
    out = []
    for side in (-1, 1):
        for j, (x0, y) in enumerate(zip(xs, ys)):
            x = side * x0
            col = rounded_slab(f'Mono{side}{j}', 1.1, h, 0.08, depth=0.55, bevel=0.03, mat=M['dark_chrome'] if j % 2 else M['brushed'])
            col.rotation_euler = (math.radians(90), 0, math.radians(90)); col.location = (x, y, h / 2)
            sm, _ = emissive(f'MonoStrip{side}{j}', EMBER_HOT, strip)
            bpy.ops.mesh.primitive_cube_add(size=1, location=(x - side * 0.56, y, h / 2)); st = bpy.context.active_object
            st.scale = (0.012, 0.05, h - 0.6); st.data.materials.append(sm)
            out += [col, st]
    return out

class Chart:
    """Kito Vale's recorded price, trade by trade, as a glowing line over a glass area, a price grid,
    day rules, and one polished volume bar per real trade. reveal(idx) shows it up to series index idx."""
    def __init__(self, x0=-3.25, x1=3.35, y=6.5, z0=0.35, h=6.7, line_r=0.045, line_strength=38.0, bar_w=0.17, bar_h=1.0,
                 area_gain=0.9, grid_strength=0.22, name='Chart'):
        self.x0, self.x1, self.y, self.z0, self.h = x0, x1, y, z0, h
        lo, hi = min(SERIES), max(SERIES); self.lo, self.hi = lo, hi
        self.pts = [self.pt(i) for i in range(N)]
        cu = bpy.data.curves.new(name + 'Line', 'CURVE'); cu.dimensions = '3D'
        sp = cu.splines.new('POLY'); sp.points.add(N - 1)
        for i, p in enumerate(self.pts): sp.points[i].co = (*p, 1)
        cu.bevel_depth = line_r; cu.bevel_resolution = 4; cu.bevel_factor_mapping_end = 'SPLINE'
        self.curve = cu; self.line = link(bpy.data.objects.new(name + 'Line', cu))
        lm, self.line_e = emissive(name + 'LineM', EMBER_HOT, line_strength); cu.materials.append(lm)
        # glass area with scan-bands, revealed left to right
        me = bpy.data.meshes.new(name + 'Area'); verts, faces = [], []
        for i, p in enumerate(self.pts):
            verts += [(p.x, p.y + 0.02, p.z), (p.x, p.y + 0.02, z0)]
            if i: faces.append((2 * i - 2, 2 * i, 2 * i + 1, 2 * i - 1))
        me.from_pydata(verts, [], faces); me.update()
        self.area = link(bpy.data.objects.new(name + 'Area', me))
        am = bpy.data.materials.new(name + 'AreaM'); am.use_nodes = True; an = am.node_tree; an.nodes.clear()
        tcA = an.nodes.new('ShaderNodeTexCoord'); sepA = an.nodes.new('ShaderNodeSeparateXYZ'); an.links.new(tcA.outputs['Object'], sepA.inputs[0])
        fz = an.nodes.new('ShaderNodeMapRange'); fz.inputs['From Min'].default_value = z0; fz.inputs['From Max'].default_value = z0 + h + 0.3
        an.links.new(sepA.outputs['Z'], fz.inputs['Value'])
        pw = an.nodes.new('ShaderNodeMath'); pw.operation = 'POWER'; pw.inputs[1].default_value = 1.6; an.links.new(fz.outputs[0], pw.inputs[0])
        rv = an.nodes.new('ShaderNodeMath'); rv.operation = 'LESS_THAN'; an.links.new(sepA.outputs['X'], rv.inputs[0]); self.reveal_x = rv.inputs[1]
        mul = an.nodes.new('ShaderNodeMath'); mul.operation = 'MULTIPLY'; an.links.new(pw.outputs[0], mul.inputs[0]); an.links.new(rv.outputs[0], mul.inputs[1])
        wv = an.nodes.new('ShaderNodeTexWave'); wv.wave_type = 'BANDS'; wv.bands_direction = 'Z'; wv.inputs['Scale'].default_value = 7.0 * 6.7 / h
        wv.inputs['Distortion'].default_value = 0.0; an.links.new(tcA.outputs['Object'], wv.inputs['Vector'])
        bd = an.nodes.new('ShaderNodeMapRange'); bd.inputs['To Min'].default_value = 0.62; bd.inputs['To Max'].default_value = 1.0; an.links.new(wv.outputs['Fac'], bd.inputs['Value'])
        mb = an.nodes.new('ShaderNodeMath'); mb.operation = 'MULTIPLY'; an.links.new(mul.outputs[0], mb.inputs[0]); an.links.new(bd.outputs[0], mb.inputs[1])
        eA = an.nodes.new('ShaderNodeEmission'); eA.inputs['Color'].default_value = (*EMBER, 1)
        gA = an.nodes.new('ShaderNodeMath'); gA.operation = 'MULTIPLY'; gA.inputs[1].default_value = area_gain; self.area_gain = gA.inputs[1]
        an.links.new(mb.outputs[0], gA.inputs[0]); an.links.new(gA.outputs[0], eA.inputs['Strength'])
        trA = an.nodes.new('ShaderNodeBsdfTransparent'); addA = an.nodes.new('ShaderNodeAddShader'); oA = an.nodes.new('ShaderNodeOutputMaterial')
        an.links.new(trA.outputs[0], addA.inputs[0]); an.links.new(eA.outputs[0], addA.inputs[1]); an.links.new(addA.outputs[0], oA.inputs['Surface'])
        self.area.data.materials.append(am); self.area.visible_shadow = False
        # grid: price levels and one rule per demo day
        gm, self.grid_e = emissive(name + 'Grid', (1.0, 0.55, 0.32), grid_strength); self.grid = []
        t_ = 0.0035 * h / 6.7
        for k in range(5):
            bpy.ops.mesh.primitive_cube_add(size=1, location=((x0 + x1) / 2, y + 0.6 * h / 6.7, z0 + 0.25 * h / 6.7 + h * k / 4)); g = bpy.context.active_object
            g.scale = (x1 - x0 + 0.8 * h / 6.7, t_, t_); g.data.materials.append(gm); g.visible_shadow = False; self.grid.append(g)
        days = sorted({t['at'][:10] for t in TRADES}); self.days = days
        for d in range(len(days) + 1):
            x = x0 + (x1 - x0) * d / len(days)
            bpy.ops.mesh.primitive_cube_add(size=1, location=(x, y + 0.6 * h / 6.7, z0 + h / 2 + 0.3 * h / 6.7)); g = bpy.context.active_object
            g.scale = (t_, t_, h + 0.6 * h / 6.7); g.data.materials.append(gm); g.visible_shadow = False; self.grid.append(g)
        # volume bars
        vb = principled(name + 'VolBuy', (0.02, 0.012, 0.01), rough=0.08, coat=1.0, emission=EMBER, estr=1.1)
        vs = principled(name + 'VolSell', (0.02, 0.01, 0.01), rough=0.08, coat=1.0, emission=(0.9, 0.08, 0.05), estr=0.9)
        vmax = max(t['cents'] for t in TRADES); self.bars = []
        for i, t in enumerate(TRADES, start=1):
            x = x0 + (x1 - x0) * i / (N - 1); bh = (0.15 + 1.0 * t['cents'] / vmax) * bar_h
            bar = rounded_slab(f'{name}Vol{i}', bar_w, bh, 0.03 * bar_w / 0.17, depth=0.09 * bar_w / 0.17, bevel=0.012 * bar_w / 0.17, mat=vb if t['type'] == 'buy' else vs)
            bar.rotation_euler = (math.radians(90), 0, 0); bar.location = (x, y - 0.8 * h / 6.7, z0)
            bar.data.transform(Matrix.Translation((0, bh / 2, 0))); self.bars.append((bar, i))
        hm, self.head_e = emissive(name + 'Head', (1.0, 0.75, 0.55), 60.0)
        bpy.ops.mesh.primitive_uv_sphere_add(radius=0.1 * h / 6.7, segments=24, ring_count=12); self.head = bpy.context.active_object; self.head.data.materials.append(hm)
        hl = bpy.data.lights.new(name + 'HeadLight', 'POINT'); hl.energy = 2600 * (h / 6.7) ** 2; hl.color = EMBER_HOT; hl.shadow_soft_size = 0.4
        self.head_light = link(bpy.data.objects.new(name + 'HeadLight', hl)); self.head_light.parent = self.head
    def pt(self, idx):
        k = min(int(idx), N - 2); fr = idx - k
        v = SERIES[k] + (SERIES[k + 1] - SERIES[k]) * fr
        return Vector((self.x0 + (self.x1 - self.x0) * idx / (N - 1), self.y, self.z0 + 0.25 * self.h / 6.7 + (v - self.lo) / (self.hi - self.lo) * self.h))
    def reveal(self, idx):
        idx = min(max(idx, 0.0), N - 1)
        self.curve.bevel_factor_end = idx / (N - 1); self.reveal_x.default_value = self.pt(idx).x + (1e-3 if idx >= N - 1 else 0.0)
        self.head.location = self.pt(idx)
        for bar, i in self.bars:
            s = min(max((idx - i + 0.6) / 0.6, 0.0), 1.0); s = s * s * (3 - 2 * s)
            bar.scale = (1, max(s, 0.001), 1); bar.hide_render = s < 0.02
    def objects(self):
        return [self.line, self.area, self.head] + self.grid + [b for b, _ in self.bars]

def holo(name, path, w, loc, yaw, glow=0.6, pitch=90):
    """A large floating holographic NEXT display: a real capture on a thin chrome-edged glass slab."""
    edge, face, h = image_card(name, path, w, glow=glow)
    edge.rotation_euler = (math.radians(pitch), 0, math.radians(yaw)); edge.location = loc
    return edge, h

def base_lights(key=900, rim=1.0):
    look_light('KeyTop', (0, -4.5, 9.0), (0, 0, 3.0), 6.0, key, (1.0, 0.96, 0.92), size_y=2.0)
    look_light('RimL', (-6.0, 3.0, 4.0), (0, 0, 3.0), 1.2, 1400 * rim, EMBER_HOT, size_y=6.0)
    look_light('RimR', (6.0, 3.0, 4.0), (0, 0, 3.0), 1.2, 1100 * rim, (1.0, 0.55, 0.3), size_y=6.0)
    fw = look_light('FloorWash', (0, 5.0, 0.6), (0, -6, 0), 8.0, 140, EMBER, size_y=0.6)
    look_light('CoolFill', (3.5, -9.0, 2.0), (0, 0, 3.0), 3.0, 120, (0.75, 0.85, 1.0))
    return fw

def finish_lights():
    for ob in bpy.data.objects:
        if ob.type == 'LIGHT': ob.visible_camera = False
    if 'FloorWash' in bpy.data.objects: bpy.data.objects['FloorWash'].visible_glossy = False

def world_dark(sc):
    sc.world.node_tree.nodes['Background'].inputs['Color'].default_value = (0.0012, 0.0008, 0.0007, 1)

def chrome_text(name, body, size, mats, extrude=0.16, bevel=0.018, face_mats=None):
    """Polished chrome extruded type with a lit face (front emissive text just ahead of the bevel)."""
    def mk(nm, ms, ex, bv):
        c = bpy.data.curves.new(nm, 'FONT'); c.font = bpy.data.fonts.load(FONT_DISPLAY, check_existing=True); c.body = body
        c.size = size; c.align_x = 'CENTER'; c.align_y = 'CENTER'; c.extrude = ex; c.bevel_depth = bv; c.bevel_resolution = 3
        for mm in ms: c.materials.append(mm)
        ob = link(bpy.data.objects.new(nm, c)); ob.rotation_euler = (math.radians(90), 0, 0); return ob
    body_ob = mk(name + 'Body', mats, extrude, bevel)
    face_ob = mk(name + 'Face', face_mats, 0.0, 0.0) if face_mats else None
    if face_ob: face_ob.parent = body_ob; face_ob.rotation_euler = (0, 0, 0); face_ob.location = (0, 0, extrude + bevel + 0.003)
    return body_ob, face_ob

def money(cents):
    d = int(round(cents / 100)); return f"+${d:,}" if d >= 0 else f"−${-d:,}"
