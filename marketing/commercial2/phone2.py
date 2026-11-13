"""A more detailed, original hero phone for NEXT Ad #2 (no real device's design
copied): brushed dark-metal frame with a polished chamfer lip, a separate black
glass front, a coated screen with the real NEXT app on it, punch-hole camera,
side buttons, antenna bands, frosted glass back with a camera module.
Built with the Ad #1 toolkit (next3d), which this file only imports.
"""
import math, os, sys
HERE = os.path.dirname(os.path.abspath(__file__))
for p in (HERE, os.path.join(HERE, '..', 'commercial')):
    if p not in sys.path: sys.path.insert(0, p)
from next3d import *

T = 0.085                                   # thickness (≈7.8 mm at this scale)
PW, PH, PR = SCREEN_W + 0.07, SCREEN_H + 0.085, 0.115

def brushed_metal(name, color=(0.10, 0.10, 0.11)):
    m = principled(name, color, metallic=1.0, rough=0.26, aniso=0.65)
    nt = m.node_tree; b = nt.nodes['Principled BSDF']
    tc = nt.nodes.new('ShaderNodeTexCoord'); nz = nt.nodes.new('ShaderNodeTexNoise')
    mp = nt.nodes.new('ShaderNodeMapping'); mp.inputs['Scale'].default_value = (900.0, 6.0, 6.0)   # long fine streaks
    nt.links.new(tc.outputs['Object'], mp.inputs['Vector']); nt.links.new(mp.outputs['Vector'], nz.inputs['Vector'])
    mr = nt.nodes.new('ShaderNodeMapRange'); mr.inputs['To Min'].default_value = 0.2; mr.inputs['To Max'].default_value = 0.34
    nt.links.new(nz.outputs['Fac'], mr.inputs['Value']); nt.links.new(mr.outputs['Result'], b.inputs['Roughness'])
    return m

def build_phone2(name, states, screen_glow=1.05):
    """Returns (root, screen). Root's local +Z is the screen normal; stood up to face -Y."""
    root = link(bpy.data.objects.new(name, None))
    hold = link(bpy.data.objects.new(name + '_tilt', None)); hold.parent = root; hold.rotation_euler = (math.radians(90), 0, 0)
    def P(ob, z=0.0, loc=None, rot=None):
        ob.parent = hold
        if loc: ob.location = loc
        else: ob.location.z = z
        if rot: ob.rotation_euler = rot
        return ob
    metal = brushed_metal(name + '_metal')
    chrome = principled(name + '_chrome', (0.86, 0.86, 0.88), metallic=1.0, rough=0.07)
    glass = principled(name + '_glass', (0.004, 0.004, 0.005), rough=0.015, coat=1.0)
    P(rounded_slab(name + '_frame', PW, PH, PR, depth=T / 2 - 0.016, bevel=0.016, mat=metal))
    lip = rounded_slab(name + '_lip', PW - 0.006, PH - 0.006, PR - 0.003, depth=0.002, bevel=0.0025, mat=chrome); P(lip, T / 2 - 0.003)
    P(rounded_slab(name + '_glassfront', PW - 0.016, PH - 0.016, PR - 0.008, depth=0.0015, bevel=0.003, mat=glass), T / 2 + 0.0012)
    scr = rounded_mesh(name + '_screen', SCREEN_W, SCREEN_H, 0.085, mat=screen_material(name + '_screen', states, screen_glow))
    sb = next(n for n in scr.data.materials[0].node_tree.nodes if n.type == 'BSDF_PRINCIPLED')
    sb.inputs['Coat Weight'].default_value = 1.0; sb.inputs['Coat Roughness'].default_value = 0.025
    P(scr, T / 2 + 0.0062)
    hole = rounded_slab(name + '_punch', 0.026, 0.026, 0.0129, mat=principled(name + '_lens', (0.0, 0.0, 0.0), rough=0.05, coat=1.0))
    P(hole, loc=(0, SCREEN_H / 2 - 0.032, T / 2 + 0.0068))
    ring = rounded_slab(name + '_punchring', 0.032, 0.032, 0.0159, mat=chrome); P(ring, loc=(0, SCREEN_H / 2 - 0.032, T / 2 + 0.0066))
    # side buttons (right: power; left: two volume keys)
    for x, y, l in ((PW / 2 + 0.003, 0.30, 0.17), (-PW / 2 - 0.003, 0.40, 0.11), (-PW / 2 - 0.003, 0.24, 0.11)):
        b_ = rounded_slab(name + '_btn', 0.014, l, 0.006, depth=0.011, bevel=0.003, mat=metal)
        P(b_, loc=(x, y, 0), rot=(0, math.radians(90), 0))
    # antenna bands across the frame
    band = principled(name + '_band', (0.03, 0.03, 0.032), rough=0.5)
    for x, y, w, h in ((PW / 2, 0.62, 0.006, 0.012), (PW / 2, -0.62, 0.006, 0.012), (-PW / 2, 0.62, 0.006, 0.012), (-PW / 2, -0.62, 0.006, 0.012),
                       (0.22, PH / 2, 0.012, 0.006), (-0.22, -PH / 2, 0.012, 0.006)):
        bd = rounded_slab(name + '_ant', w, h, 0.002, depth=T / 2 - 0.006, mat=band); P(bd, loc=(x, y, 0))
    # back: frosted glass + camera module
    back = rounded_slab(name + '_back', PW - 0.016, PH - 0.016, PR - 0.008, depth=0.0015, bevel=0.003,
                        mat=principled(name + '_frost', (0.03, 0.026, 0.025), rough=0.38, coat=0.35))
    P(back, -T / 2 - 0.0012); back.rotation_euler.y = math.pi
    mod = rounded_slab(name + '_cammod', 0.27, 0.27, 0.07, depth=0.006, bevel=0.004, mat=glass)
    P(mod, loc=(-PW / 2 + 0.2, PH / 2 - 0.2, -T / 2 - 0.006)); mod.rotation_euler.y = math.pi
    for dx, dy in ((-0.055, 0.055), (0.055, -0.055)):
        lens = rounded_slab(name + '_lensr', 0.085, 0.085, 0.0424, depth=0.006, bevel=0.002, mat=chrome)
        P(lens, loc=(-PW / 2 + 0.2 + dx, PH / 2 - 0.2 + dy, -T / 2 - 0.013)); lens.rotation_euler.y = math.pi
        gl = rounded_slab(name + '_lensg', 0.06, 0.06, 0.0299, mat=principled(name + '_lensglass', (0.0, 0.0, 0.002), rough=0.02, coat=1.0))
        P(gl, loc=(-PW / 2 + 0.2 + dx, PH / 2 - 0.2 + dy, -T / 2 - 0.0195)); gl.rotation_euler.y = math.pi
    return root, scr
