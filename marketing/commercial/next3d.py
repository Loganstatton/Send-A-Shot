"""Shared Blender toolkit for the NEXT commercial (scenes 2–4).

Everything is built procedurally: an original phone (no real-device design
copied), real NEXT app screenshots as its screen, glass artist cards, glowing
charts, 3D type and particle streams. Each scene script imports this.
"""
import bpy, bmesh, math, os, random, sys, time
from mathutils import Vector, Euler, Matrix

argv = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []
PREVIEW = '--preview' in argv
GPU = '--gpu' in argv
def arg(name, default=None):
    return argv[argv.index(name) + 1] if name in argv else default
HERE = os.path.dirname(os.path.abspath(__file__))
ASSETS = arg('--assets', os.path.join(HERE, 'assets'))
FONT_DISPLAY = os.path.join(HERE, 'fonts', 'BricolageGrotesque-ExtraBold.ttf')
FONT_MONO = os.path.join(HERE, 'fonts', 'IBMPlexMono-Medium.ttf')

EMBER = (0.9865, 0.139, 0.057)          # #FD6844 linear
EMBER_HOT = (1.0, 0.42, 0.16)
INK = (0.0051, 0.0029, 0.0023)          # #100908
PAPER = (0.8979, 0.8847, 0.8492)        # #F3F2ED
UP = (0.0624, 0.6231, 0.1908)           # brand green
FPS = 30

def init(frame_end, samples=40, gpu_samples=128):
    bpy.ops.wm.read_factory_settings(use_empty=True)
    sc = bpy.context.scene
    sc.render.fps = FPS
    sc.frame_start, sc.frame_end = 1, frame_end
    sc.render.engine = 'CYCLES'
    cy = sc.cycles
    cy.device = 'CPU'
    cy.samples = 16 if PREVIEW else samples
    cy.adaptive_threshold = 0.03
    cy.use_denoising = True
    cy.denoiser = 'OPENIMAGEDENOISE'
    cy.max_bounces, cy.diffuse_bounces, cy.glossy_bounces, cy.transmission_bounces = 6, 2, 4, 4
    cy.caustics_reflective = cy.caustics_refractive = False
    if GPU:
        prefs = bpy.context.preferences.addons['cycles'].preferences
        prefs.compute_device_type = 'OPTIX'
        prefs.get_devices()
        for d in prefs.devices: d.use = d.type in ('OPTIX', 'CUDA')
        cy.device = 'GPU'; cy.samples = gpu_samples; cy.denoiser = 'OPTIX'
    sc.render.resolution_x, sc.render.resolution_y = 1080, 1920
    sc.render.resolution_percentage = 35 if PREVIEW else 100
    sc.render.use_motion_blur = True
    sc.render.motion_blur_shutter = 0.45
    sc.view_settings.view_transform = 'AgX'
    sc.render.image_settings.file_format = 'HDR'
    w = bpy.data.worlds.new('World'); sc.world = w
    w.use_nodes = True
    w.node_tree.nodes['Background'].inputs['Color'].default_value = (0.0004, 0.0003, 0.0003, 1)
    return sc

def link(o):
    bpy.context.scene.collection.objects.link(o); return o

def iter_fcurves(action):
    if hasattr(action, 'fcurves') and len(getattr(action, 'fcurves', [])):
        yield from action.fcurves; return
    for layer in getattr(action, 'layers', []):
        for strip in layer.strips:
            for bag in strip.channelbags:
                yield from bag.fcurves

def set_interp(id_data, interp='BEZIER', easing='AUTO'):
    ad = id_data.animation_data
    if not ad or not ad.action: return
    for fc in iter_fcurves(ad.action):
        for kp in fc.keyframe_points:
            kp.interpolation = interp; kp.easing = easing

def keys(obj, path, pairs, interp=None, easing='AUTO', index=-1):
    """pairs: [(frame, value)]; sets & keys a property over time."""
    for f, v in pairs:
        target = obj
        attr = path
        if isinstance(v, (tuple, list)) and index == -1:
            setattr(target, attr, v)
        elif index >= 0:
            getattr(target, attr)[index] = v
        else:
            setattr(target, attr, v)
        target.keyframe_insert(attr, frame=f, index=index)
    if interp:
        set_interp(obj.id_data if hasattr(obj, 'id_data') else obj, interp, easing)

def visible(obj, ranges):
    """Show obj only within [(start, end)] frame ranges (hide_render keyed)."""
    obj.hide_render = True; obj.keyframe_insert('hide_render', frame=1)
    for a, b in ranges:
        obj.hide_render = False; obj.keyframe_insert('hide_render', frame=a)
        obj.hide_render = True; obj.keyframe_insert('hide_render', frame=b + 1)

# ---------------------------------------------------------------- materials
def principled(name, base, metallic=0.0, rough=0.4, emission=None, estr=0.0, coat=0.0, aniso=0.0, alpha=1.0, transmission=0.0, ior=1.45):
    m = bpy.data.materials.new(name); m.use_nodes = True
    b = m.node_tree.nodes['Principled BSDF']
    b.inputs['Base Color'].default_value = (*base, 1)
    b.inputs['Metallic'].default_value = metallic
    b.inputs['Roughness'].default_value = rough
    if coat: b.inputs['Coat Weight'].default_value = coat
    if aniso: b.inputs['Anisotropic'].default_value = aniso
    if emission:
        b.inputs['Emission Color'].default_value = (*emission, 1)
        b.inputs['Emission Strength'].default_value = estr
    if transmission:
        b.inputs['Transmission Weight'].default_value = transmission; b.inputs['IOR'].default_value = ior
    b.inputs['Alpha'].default_value = alpha
    return m

def emissive(name, color, strength):
    m = bpy.data.materials.new(name); m.use_nodes = True
    nt = m.node_tree; nt.nodes.clear()
    e = nt.nodes.new('ShaderNodeEmission'); o = nt.nodes.new('ShaderNodeOutputMaterial')
    e.inputs['Color'].default_value = (*color, 1); e.inputs['Strength'].default_value = strength
    nt.links.new(e.outputs[0], o.inputs['Surface'])
    return m, e

def load_image(path):
    img = bpy.data.images.load(path, check_existing=True)
    img.colorspace_settings.name = 'sRGB'
    return img

# ---------------------------------------------------------------- shapes
def rounded_rect_points(w, h, r, seg=10):
    pts = []
    for cx, cy, a0 in ((w / 2 - r, h / 2 - r, 0), (-w / 2 + r, h / 2 - r, 90), (-w / 2 + r, -h / 2 + r, 180), (w / 2 - r, -h / 2 + r, 270)):
        for i in range(seg + 1):
            a = math.radians(a0 + 90 * i / seg)
            pts.append((cx + r * math.cos(a), cy + r * math.sin(a)))
    return pts

def rounded_slab(name, w, h, r, depth=0.0, bevel=0.0, mat=None, seg=10):
    """A filled rounded rectangle in the XY plane (optionally extruded/bevelled).
    'Generated' texture coordinates span 0..1 across it — images map straight on."""
    cu = bpy.data.curves.new(name, 'CURVE'); cu.dimensions = '2D'; cu.fill_mode = 'BOTH'
    sp = cu.splines.new('POLY'); pts = rounded_rect_points(w, h, r, seg)
    sp.points.add(len(pts) - 1)
    for i, (x, y) in enumerate(pts): sp.points[i].co = (x, y, 0, 1)
    sp.use_cyclic_u = True
    cu.extrude = depth; cu.bevel_depth = bevel; cu.bevel_resolution = 3 if bevel else 0
    ob = link(bpy.data.objects.new(name, cu))
    if mat: ob.data.materials.append(mat)
    return ob

def rounded_mesh(name, w, h, r, mat=None, seg=12):
    """Flat rounded rectangle mesh in XY with UVs spanning 0..1 — images map exactly."""
    bm = bmesh.new()
    c = bm.verts.new((0, 0, 0))
    ring = [bm.verts.new((x, y, 0)) for x, y in rounded_rect_points(w, h, r, seg)]
    for i in range(len(ring)):
        bm.faces.new((c, ring[i], ring[(i + 1) % len(ring)]))
    uv = bm.loops.layers.uv.new('UVMap')
    for f in bm.faces:
        for lp in f.loops:
            lp[uv].uv = ((lp.vert.co.x + w / 2) / w, (lp.vert.co.y + h / 2) / h)
    me = bpy.data.meshes.new(name); bm.to_mesh(me); bm.free()
    ob = link(bpy.data.objects.new(name, me))
    if mat: ob.data.materials.append(mat)
    return ob

def glow_material(name, color, strength=0.0):
    """Pure light: adds glow, never blocks what is behind it (no black discs)."""
    m = bpy.data.materials.new(name); m.use_nodes = True
    nt = m.node_tree; nt.nodes.clear()
    tr = nt.nodes.new('ShaderNodeBsdfTransparent'); e = nt.nodes.new('ShaderNodeEmission'); ad = nt.nodes.new('ShaderNodeAddShader')
    o = nt.nodes.new('ShaderNodeOutputMaterial')
    e.inputs['Color'].default_value = (*color, 1); e.inputs['Strength'].default_value = strength
    nt.links.new(tr.outputs[0], ad.inputs[0]); nt.links.new(e.outputs[0], ad.inputs[1]); nt.links.new(ad.outputs[0], o.inputs['Surface'])
    return m, e

def text_obj(body, font_path, size, mat, extrude=0.0, bevel=0.0, align='CENTER'):
    cu = bpy.data.curves.new('T_' + body[:12], 'FONT'); cu.body = body
    cu.font = bpy.data.fonts.load(font_path, check_existing=True)
    cu.size = size; cu.align_x = align; cu.align_y = 'CENTER'; cu.extrude = extrude
    cu.bevel_depth = bevel; cu.bevel_resolution = 2
    ob = link(bpy.data.objects.new('T_' + body[:12], cu)); ob.data.materials.append(mat)
    return ob

# ---------------------------------------------------------------- phone
SCREEN_W, SCREEN_H = 0.7206, 1.56          # 1170 x 2532 aspect
PHONE_W, PHONE_H, PHONE_T = SCREEN_W + 0.06, SCREEN_H + 0.075, 0.078

def sock(sockets, name, kind):
    """Pick a Mix node socket by name AND type (Mix has float/vector/color sockets with the same names)."""
    return next(x for x in sockets if x.name == name and x.type == kind)

def screen_material(name, states):
    """states: [(image_path, start_frame, kind)] — kind 'cut'|'fade'|'push'|'up'.
    Each state cross-fades in over 5 frames, sliding in for push/up."""
    m = bpy.data.materials.new(name); m.use_nodes = True
    nt = m.node_tree; nt.nodes.clear(); L = nt.links
    out = nt.nodes.new('ShaderNodeOutputMaterial')
    tc = nt.nodes.new('ShaderNodeTexCoord')
    prev = None
    for i, (path, start, kind) in enumerate(states):
        mp = nt.nodes.new('ShaderNodeMapping')
        L.new(tc.outputs['UV'], mp.inputs['Vector'])
        tex = nt.nodes.new('ShaderNodeTexImage'); tex.image = load_image(path); tex.extension = 'CLIP'; tex.interpolation = 'Cubic'
        L.new(mp.outputs['Vector'], tex.inputs['Vector'])
        if kind in ('push', 'up'):
            idx = 0 if kind == 'push' else 1
            mp.inputs['Location'].default_value[idx] = -0.18 if kind == 'push' else 0.12
            mp.inputs['Location'].keyframe_insert('default_value', frame=start - 1, index=idx)
            mp.inputs['Location'].default_value[idx] = 0.0
            mp.inputs['Location'].keyframe_insert('default_value', frame=start + 5, index=idx)
        if prev is None:
            prev = tex.outputs['Color']; continue
        mix = nt.nodes.new('ShaderNodeMix'); mix.data_type = 'RGBA'
        dur = 1 if kind == 'cut' else 5
        mix.inputs['Factor'].default_value = 0.0; mix.inputs['Factor'].keyframe_insert('default_value', frame=start - 1)
        mix.inputs['Factor'].default_value = 1.0; mix.inputs['Factor'].keyframe_insert('default_value', frame=start - 1 + dur)
        L.new(prev, sock(mix.inputs, 'A', 'RGBA')); L.new(tex.outputs['Color'], sock(mix.inputs, 'B', 'RGBA'))
        prev = sock(mix.outputs, 'Result', 'RGBA')
    b = nt.nodes.new('ShaderNodeBsdfPrincipled')
    b.inputs['Base Color'].default_value = (0, 0, 0, 1)
    b.inputs['Roughness'].default_value = 0.06
    b.inputs['Coat Weight'].default_value = 0.0
    L.new(prev, b.inputs['Emission Color'])
    b.inputs['Emission Strength'].default_value = 1.35
    L.new(b.outputs[0], out.inputs['Surface'])
    return m

def build_phone(name, states, back_logo=True):
    """Returns (root, screen_obj). Root's local +Z is the screen normal; the
    root is stood up to face -Y (towards a camera on -Y)."""
    root = link(bpy.data.objects.new(name, None))
    holder = link(bpy.data.objects.new(name + '_tilt', None)); holder.parent = root
    holder.rotation_euler = (math.radians(90), 0, 0)
    frame_mat = principled(name + '_frame', (0.32, 0.31, 0.30), metallic=1.0, rough=0.22, aniso=0.3)
    body = rounded_slab(name + '_body', PHONE_W, PHONE_H, 0.11, depth=PHONE_T / 2 - 0.012, bevel=0.012, mat=frame_mat)
    body.parent = holder
    glass = principled(name + '_glass', (0.003, 0.003, 0.004), rough=0.04, coat=1.0)
    front = rounded_slab(name + '_front', PHONE_W - 0.012, PHONE_H - 0.012, 0.104, mat=glass); front.parent = holder
    front.location.z = PHONE_T / 2 + 0.0008
    scr = rounded_mesh(name + '_screen', SCREEN_W, SCREEN_H, 0.085, mat=screen_material(name + '_screen', states)); scr.parent = holder
    scr.location.z = PHONE_T / 2 + 0.0016
    cam_dot = rounded_slab(name + '_cam', 0.03, 0.03, 0.0149, mat=glass); cam_dot.parent = holder
    cam_dot.location = (0, SCREEN_H / 2 - 0.035, PHONE_T / 2 + 0.0024)
    back = rounded_slab(name + '_back', PHONE_W - 0.012, PHONE_H - 0.012, 0.104, mat=principled(name + '_backglass', (0.02, 0.016, 0.015), rough=0.3, coat=1.0))
    back.parent = holder; back.location.z = -PHONE_T / 2 - 0.0008; back.rotation_euler.y = math.pi
    if back_logo:
        word = text_obj('NEXT', FONT_DISPLAY, 0.16, principled('backlogo', PAPER, rough=0.35, emission=PAPER, estr=0.4), extrude=0.0)
        word.parent = holder; word.location = (-0.02, 0.1, -PHONE_T / 2 - 0.002); word.rotation_euler.y = math.pi
        dot = rounded_slab('backdot', 0.03, 0.03, 0.0149, mat=emissive('backdot', EMBER, 6.0)[0]); dot.parent = holder
        dot.location = (-0.21, 0.1, -PHONE_T / 2 - 0.002); dot.rotation_euler.y = math.pi
    for y, l in ((0.32, 0.16), (0.08, 0.1)):   # side buttons
        btn = rounded_slab(name + '_btn', 0.012, l, 0.005, depth=0.012, mat=frame_mat); btn.parent = holder
        btn.location = (PHONE_W / 2 + 0.004, y, 0); btn.rotation_euler.y = math.radians(90)
    return root, scr

def screen_point(scr, u, v_from_top, lift=0.004):
    """World position of a point on a phone screen (u, v from the top-left)."""
    local = Vector(((u - 0.5) * SCREEN_W, (0.5 - v_from_top) * SCREEN_H, lift))
    return local

def tap_ripple(scr, u, v_from_top, frame, color=PAPER):
    """A touch: a soft disc + an expanding ring at a screen point."""
    mat, e = glow_material('tap', color, 0.0)
    ring = rounded_mesh('tapring', 0.09, 0.09, 0.0449, mat=mat)
    visible(ring, [(frame - 2, frame + 6)])
    ring.parent = scr; ring.location = screen_point(scr, u, v_from_top, 0.003)
    for f, s, st in ((frame - 2, 0.4, 0.0), (frame, 0.8, 3.0), (frame + 6, 1.6, 0.0)):
        ring.scale = (s, s, s); ring.keyframe_insert('scale', frame=f)
        e.inputs['Strength'].default_value = st; e.inputs['Strength'].keyframe_insert('default_value', frame=f)
    return ring

def image_card(name, path, w, r=0.035, depth=0.012, glow=1.15):
    """A thin rounded glass slab with an app card image on its face."""
    img = load_image(path)
    h = w * img.size[1] / img.size[0]
    m = bpy.data.materials.new(name); m.use_nodes = True
    nt = m.node_tree; b = nt.nodes['Principled BSDF']
    tc = nt.nodes.new('ShaderNodeTexCoord'); tex = nt.nodes.new('ShaderNodeTexImage'); tex.image = img; tex.extension = 'CLIP'
    nt.links.new(tc.outputs['UV'], tex.inputs['Vector'])
    b.inputs['Base Color'].default_value = (0, 0, 0, 1); b.inputs['Roughness'].default_value = 0.08
    b.inputs['Coat Weight'].default_value = 0.6
    nt.links.new(tex.outputs['Color'], b.inputs['Emission Color']); b.inputs['Emission Strength'].default_value = glow
    face = rounded_mesh(name, w, h, r, mat=m)
    edge = rounded_slab(name + '_edge', w + 0.01, h + 0.01, r + 0.005, depth=depth / 2, bevel=0.003,
                        mat=principled(name + '_edgemat', (0.6, 0.62, 0.66), metallic=1.0, rough=0.18))
    face.parent = edge; face.location.z = depth / 2 + 0.003 + 0.002
    return edge, face, h

# ---------------------------------------------------------------- lights & camera
def area(name, loc, rot, size, energy, color=(1, 1, 1), size_y=None, parent=None):
    ld = bpy.data.lights.new(name, 'AREA'); ld.shape = 'RECTANGLE'; ld.size = size; ld.size_y = size_y or size
    ld.energy = energy; ld.color = color
    ob = link(bpy.data.objects.new(name, ld)); ob.location = loc; ob.rotation_euler = rot
    if parent: ob.parent = parent
    return ob

def look_light(name, loc, target, size, energy, color=(1, 1, 1), size_y=None):
    ob = area(name, loc, (0, 0, 0), size, energy, color, size_y)
    d = (Vector(target) - Vector(loc)).normalized()
    ob.rotation_euler = d.to_track_quat('-Z', 'Y').to_euler()
    return ob

class Camera:
    def __init__(self, lens=50, fstop=4.0):
        self.data = bpy.data.cameras.new('Cam'); self.data.lens = lens; self.data.sensor_fit = 'VERTICAL'; self.data.sensor_height = 24.0
        self.data.dof.use_dof = True; self.data.dof.aperture_fstop = fstop
        self.focus = link(bpy.data.objects.new('Focus', None)); self.data.dof.focus_object = self.focus
        self.cam = link(bpy.data.objects.new('Cam', self.data)); bpy.context.scene.camera = self.cam
        self.target = link(bpy.data.objects.new('CamTarget', None))
        tr = self.cam.constraints.new('TRACK_TO'); tr.target = self.target; tr.track_axis = 'TRACK_NEGATIVE_Z'; tr.up_axis = 'UP_Y'
    def key(self, f, loc, tgt, focus=None, fstop=None, lens=None):
        self.cam.location = loc; self.cam.keyframe_insert('location', frame=f)
        self.target.location = tgt; self.target.keyframe_insert('location', frame=f)
        self.focus.location = focus if focus is not None else tgt; self.focus.keyframe_insert('location', frame=f)
        if fstop is not None: self.data.dof.aperture_fstop = fstop; self.data.dof.keyframe_insert('aperture_fstop', frame=f)
        if lens is not None: self.data.lens = lens; self.data.keyframe_insert('lens', frame=f)
    def bind(self, frame):
        """Make this the active camera from `frame` on (timeline marker) — hard cuts between shots."""
        m = bpy.context.scene.timeline_markers.new(f'cam{frame}', frame=frame); m.camera = self.cam
    def smooth(self):
        for ob in (self.cam, self.target, self.focus): set_interp(ob, 'BEZIER')

# ---------------------------------------------------------------- charts
def chart_line(name, values, x0, x1, base, height, depth_y=0.0, radius=0.02, strength=16.0, color=EMBER_HOT, reveal=None):
    lo, hi = min(values), max(values)
    span = (hi - lo) or 1
    n = len(values)
    pts = [Vector((x0 + (x1 - x0) * i / (n - 1), depth_y, base + 0.15 + (v - lo) / span * height)) for i, v in enumerate(values)]
    cu = bpy.data.curves.new(name, 'CURVE'); cu.dimensions = '3D'
    sp = cu.splines.new('POLY'); sp.points.add(n - 1)
    for i, p in enumerate(pts): sp.points[i].co = (*p, 1)
    cu.bevel_depth = radius; cu.bevel_resolution = 4
    ob = link(bpy.data.objects.new(name, cu)); ob.data.materials.append(emissive(name + '_m', color, strength)[0])
    if reveal:
        cu.bevel_factor_end = 0.0; cu.keyframe_insert('bevel_factor_end', frame=reveal[0])
        cu.bevel_factor_end = 1.0; cu.keyframe_insert('bevel_factor_end', frame=reveal[1])
        set_interp(cu, 'SINE', 'EASE_IN_OUT')
    return ob, pts

def smooth_series(values, n=64):
    """Resample a short price series to n points with gentle interpolation (no new data invented: same start, end and shape)."""
    if len(values) < 2: return [values[0]] * n
    out = []
    for i in range(n):
        t = i / (n - 1) * (len(values) - 1); k = min(int(t), len(values) - 2); f = t - k
        f = f * f * (3 - 2 * f)
        out.append(values[k] * (1 - f) + values[k + 1] * f)
    return out

def floor(z, mat_color=(0.006, 0.005, 0.005), grid=0.8, size=60):
    bpy.ops.mesh.primitive_plane_add(size=size, location=(0, 0, z))
    fl = bpy.context.active_object
    m = principled('Floor', mat_color, rough=0.2, coat=0.5)
    nt = m.node_tree; b = nt.nodes['Principled BSDF']
    tc = nt.nodes.new('ShaderNodeTexCoord'); mp = nt.nodes.new('ShaderNodeMapping'); mp.inputs['Scale'].default_value = (2.5, 2.5, 1)
    nt.links.new(tc.outputs['Object'], mp.inputs['Vector'])
    br = nt.nodes.new('ShaderNodeTexBrick'); br.offset = 0.0
    br.inputs['Mortar Size'].default_value = 0.012; br.inputs['Brick Width'].default_value = 1.0; br.inputs['Row Height'].default_value = 1.0
    br.inputs['Color1'].default_value = (0, 0, 0, 1); br.inputs['Color2'].default_value = (0, 0, 0, 1); br.inputs['Mortar'].default_value = (1, 1, 1, 1)
    nt.links.new(mp.outputs['Vector'], br.inputs['Vector'])
    g = nt.nodes.new('ShaderNodeTexGradient'); g.gradient_type = 'SPHERICAL'
    mp2 = nt.nodes.new('ShaderNodeMapping'); mp2.inputs['Scale'].default_value = (0.12, 0.12, 0.12)
    nt.links.new(tc.outputs['Object'], mp2.inputs['Vector']); nt.links.new(mp2.outputs['Vector'], g.inputs['Vector'])
    mul = nt.nodes.new('ShaderNodeMath'); mul.operation = 'MULTIPLY'
    nt.links.new(br.outputs['Fac'], mul.inputs[0]); nt.links.new(g.outputs['Fac'], mul.inputs[1])
    mul2 = nt.nodes.new('ShaderNodeMath'); mul2.operation = 'MULTIPLY'; mul2.inputs[1].default_value = grid
    nt.links.new(mul.outputs[0], mul2.inputs[0])
    b.inputs['Emission Color'].default_value = (*EMBER, 1)
    nt.links.new(mul2.outputs[0], b.inputs['Emission Strength'])
    fl.data.materials.append(m)
    return fl

# ---------------------------------------------------------------- particles
def particle_material(name='Particles'):
    m = bpy.data.materials.new(name); m.use_nodes = True
    n = m.node_tree.nodes; l = m.node_tree.links; n.clear()
    a = n.new('ShaderNodeAttribute'); a.attribute_name = 'rnd'
    fl = n.new('ShaderNodeAttribute'); fl.attribute_name = 'flight'
    r = n.new('ShaderNodeValToRGB')
    r.color_ramp.elements[0].color = (*EMBER, 1); r.color_ramp.elements[1].color = (1.0, 0.75, 0.45, 1); r.color_ramp.elements[1].position = 0.95
    e = n.new('ShaderNodeEmission'); o = n.new('ShaderNodeOutputMaterial')
    mul = n.new('ShaderNodeMath'); mul.operation = 'MULTIPLY_ADD'; mul.inputs[1].default_value = 14.0; mul.inputs[2].default_value = 6.0
    dim = n.new('ShaderNodeMath'); dim.operation = 'MULTIPLY_ADD'; dim.inputs[1].default_value = -0.6; dim.inputs[2].default_value = 1.0
    m2 = n.new('ShaderNodeMath'); m2.operation = 'MULTIPLY'
    l.new(a.outputs['Fac'], r.inputs['Fac']); l.new(r.outputs['Color'], e.inputs['Color'])
    l.new(a.outputs['Fac'], mul.inputs[0]); l.new(fl.outputs['Fac'], dim.inputs[0])
    l.new(mul.outputs[0], m2.inputs[0]); l.new(dim.outputs[0], m2.inputs[1]); l.new(m2.outputs[0], e.inputs['Strength'])
    l.new(e.outputs[0], o.inputs['Surface'])
    return m

def particles(name, starts, targets, bursts, delays, start_frame, settle=14.0, base=0.0042, fly=0.0075, noise_amp=0.7,
              appear=None, vanish=None):
    """Points fly from starts to targets (per-point delay), bursting and
    swirling on the way; hidden before `appear`, shrink away after `vanish`."""
    n_ = len(starts)
    rnds = [random.random() for _ in range(n_)]
    me = bpy.data.meshes.new(name); me.vertices.add(n_)
    me.vertices.foreach_set('co', [c for v in starts for c in v])
    for nm, data, kind in (('start', starts, 'FLOAT_VECTOR'), ('target', targets, 'FLOAT_VECTOR'), ('burst', bursts, 'FLOAT_VECTOR'),
                           ('rnd', rnds, 'FLOAT'), ('delay', delays, 'FLOAT')):
        at = me.attributes.new(nm, kind, 'POINT')
        at.data.foreach_set('vector' if kind == 'FLOAT_VECTOR' else 'value', [c for v in data for c in v] if kind == 'FLOAT_VECTOR' else data)
    ob = link(bpy.data.objects.new(name, me))
    ng = bpy.data.node_groups.new(name + 'Flow', 'GeometryNodeTree')
    ng.interface.new_socket('Geometry', in_out='INPUT', socket_type='NodeSocketGeometry')
    ng.interface.new_socket('Geometry', in_out='OUTPUT', socket_type='NodeSocketGeometry')
    N, L = ng.nodes, ng.links
    gi, go, t = N.new('NodeGroupInput'), N.new('NodeGroupOutput'), N.new('GeometryNodeInputSceneTime')
    def named(nm, dt):
        x = N.new('GeometryNodeInputNamedAttribute'); x.data_type = dt; x.inputs['Name'].default_value = nm; return x.outputs['Attribute']
    def M(op, a=None, b=None, c=None):
        x = N.new('ShaderNodeMath'); x.operation = op
        for i, v in enumerate((a, b, c)):
            if v is None: continue
            if isinstance(v, (int, float)): x.inputs[i].default_value = v
            else: L.new(v, x.inputs[i])
        return x.outputs[0]
    fr = t.outputs['Frame']
    st, tg, bu, rn, de = named('start', 'FLOAT_VECTOR'), named('target', 'FLOAT_VECTOR'), named('burst', 'FLOAT_VECTOR'), named('rnd', 'FLOAT'), named('delay', 'FLOAT')
    dur = M('SUBTRACT', M('ADD', de, settle), float(start_frame))
    u = M('MINIMUM', M('MAXIMUM', M('DIVIDE', M('SUBTRACT', fr, float(start_frame)), dur), 0.0), 1.0)
    ease = M('MULTIPLY', M('MULTIPLY', u, u), M('SUBTRACT', 3.0, M('MULTIPLY', u, 2.0)))
    arc = M('SINE', M('MULTIPLY', M('POWER', u, 0.55), math.pi))
    mix = N.new('ShaderNodeMix'); mix.data_type = 'VECTOR'
    L.new(ease, mix.inputs['Factor']); L.new(st, mix.inputs['A']); L.new(tg, mix.inputs['B'])
    sb = N.new('ShaderNodeVectorMath'); sb.operation = 'SCALE'; L.new(bu, sb.inputs[0]); L.new(arc, sb.inputs['Scale'])
    nz = N.new('ShaderNodeTexNoise'); nz.noise_dimensions = '4D'; nz.inputs['Scale'].default_value = 0.28
    L.new(st, nz.inputs['Vector']); L.new(M('MULTIPLY', fr, 0.03), nz.inputs['W'])
    ns = N.new('ShaderNodeVectorMath'); ns.operation = 'SUBTRACT'; L.new(nz.outputs['Color'], ns.inputs[0]); ns.inputs[1].default_value = (0.5, 0.5, 0.5)
    nsc = N.new('ShaderNodeVectorMath'); nsc.operation = 'SCALE'; L.new(ns.outputs[0], nsc.inputs[0]); L.new(M('MULTIPLY', arc, noise_amp), nsc.inputs['Scale'])
    a1 = N.new('ShaderNodeVectorMath'); a1.operation = 'ADD'; L.new(mix.outputs['Result'], a1.inputs[0]); L.new(sb.outputs[0], a1.inputs[1])
    a2 = N.new('ShaderNodeVectorMath'); a2.operation = 'ADD'; L.new(a1.outputs[0], a2.inputs[0]); L.new(nsc.outputs[0], a2.inputs[1])
    sp = N.new('GeometryNodeSetPosition'); L.new(gi.outputs[0], sp.inputs['Geometry']); L.new(a2.outputs[0], sp.inputs['Position'])
    alive = M('GREATER_THAN', fr, float(appear if appear is not None else start_frame) - 0.5)
    if vanish is not None:
        fade = M('MINIMUM', M('MAXIMUM', M('DIVIDE', M('SUBTRACT', float(vanish[1]), fr), float(vanish[1] - vanish[0])), 0.0), 1.0)
        alive = M('MULTIPLY', alive, fade)
    tw = M('ADD', 0.75, M('MULTIPLY', 0.25, M('SINE', M('ADD', M('MULTIPLY', fr, 0.35), M('MULTIPLY', rn, 40.0)))))
    size = M('MULTIPLY', M('MULTIPLY', M('ADD', base, M('MULTIPLY', arc, fly)), tw), M('ADD', 0.6, M('MULTIPLY', rn, 0.8)))
    store = N.new('GeometryNodeStoreNamedAttribute'); store.data_type = 'FLOAT'; store.inputs['Name'].default_value = 'flight'
    L.new(sp.outputs[0], store.inputs['Geometry']); L.new(arc, store.inputs['Value'])
    m2p = N.new('GeometryNodeMeshToPoints'); L.new(store.outputs[0], m2p.inputs['Mesh']); L.new(M('MULTIPLY', size, alive), m2p.inputs['Radius'])
    sm = N.new('GeometryNodeSetMaterial'); sm.inputs['Material'].default_value = particle_material(name + 'Mat')
    L.new(m2p.outputs[0], sm.inputs['Geometry']); L.new(sm.outputs[0], go.inputs[0])
    ob.modifiers.new('Flow', 'NODES').node_group = ng
    return ob

def surface_points(ob, n, jitter=0.0):
    """n random points on an object's evaluated surface (world space), area-weighted."""
    dg = bpy.context.evaluated_depsgraph_get()
    ev = ob.evaluated_get(dg); me = ev.to_mesh()
    me.calc_loop_triangles()
    mw = ob.matrix_world
    tris = [(mw @ me.vertices[t.vertices[0]].co, mw @ me.vertices[t.vertices[1]].co, mw @ me.vertices[t.vertices[2]].co) for t in me.loop_triangles]
    areas = [((b - a).cross(c - a)).length / 2 for a, b, c in tris]
    tot = sum(areas); acc = []; s = 0
    for a in areas: s += a; acc.append(s / tot)
    import bisect
    out = []
    for _ in range(n):
        a, b, c = tris[min(bisect.bisect_left(acc, random.random()), len(tris) - 1)]
        r1, r2 = random.random(), random.random()
        if r1 + r2 > 1: r1, r2 = 1 - r1, 1 - r2
        p = a + (b - a) * r1 + (c - a) * r2
        out.append(p + Vector([random.gauss(0, jitter) for _ in range(3)]))
    ev.to_mesh_clear()
    return out

# ---------------------------------------------------------------- render
def render(default_out):
    sc = bpy.context.scene
    out = arg('--out', default_out); os.makedirs(out, exist_ok=True)
    if arg('--save'): bpy.ops.wm.save_as_mainfile(filepath=os.path.abspath(arg('--save')))
    if arg('--list'):
        frames = [int(x) for x in arg('--list').split(',')]
    else:
        a, b = (int(x) for x in arg('--frames', f'1-{sc.frame_end}').split('-'))
        frames = range(a, b + 1)
    for f in frames:
        t0 = time.time(); sc.frame_set(f)
        sc.render.filepath = os.path.join(out, f'f{f:04d}.hdr')
        bpy.ops.render.render(write_still=True)
        print(f'[frame {f}] {time.time() - t0:.1f}s', flush=True)
