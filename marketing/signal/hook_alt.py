"""Alternative 3-second hooks for "THE SIGNAL" (frames 1–90). Each ends on exactly Hook A's frame 90
(same world, camera, monitor and phone poses, lights), so the rest of the film is identical and only
the hook differs.

  B  "THE NEXT BIG ARTIST IS STILL UNKNOWN."  tight on SCOUT's real New Candidates queue as a scan of
     light runs down it and the waiting candidates light up; a fast pull back reveals both products.
  C  "ONE SYSTEM FINDS THEM. ANOTHER LETS YOU BACK THEM."  low between the two products, split by a wall
     of light: SCOUT cyan on one side, NEXT orange on the other; the wall parts as the camera rises.

  blender-venv/bin/python hookb.py|hookc.py -- --assets DIR [--hook wide] [--preview|--gpu] [--frames a-b] [--out DIR]
"""
import json, math, os, sys
from scout3d import *
from world5 import *
from mathutils import Vector, Matrix

def build(kind):
    END = 105
    sc = init(END, samples=96, gpu_samples=128)
    compact_frames(sc)
    WIDE = arg('--hook') == 'wide'
    if WIDE: sc.render.resolution_x, sc.render.resolution_y = 1920, 1080
    S = lambda n: os.path.join(ASSETS, n)
    W = build_world(S, -20, 1, [(S('scout-queue-before.png'), 1, 'cut')], [(S('n04-back-amount.png'), 1, 'cut')])
    mon, mscr, phone = W['mon'], W['mscr'], W['phone']
    # the same poses as Hook A from frame 46 on (Hook A lights the far side at 52)
    for ob, a, b in ((mon, (0, 0, MON_YAW[0]), (0, 0, MON_YAW[1])), (phone, PHN_ROT[0], PHN_ROT[1])):
        ob.animation_data_clear()
        keys(ob, 'rotation_euler', [(1, a), (46, a), (105, b)], interp='SINE', easing='EASE_OUT')
    link_lights(W)
    build_architecture(FLOOR_Z, 14.0, 46.0, (-4.6, -7.6), (10.8, 13.8), 48.0, [(1, 1.6)], extra=BEHIND)
    sc.frame_set(1); bpy.context.view_layer.update()
    ROW = json.load(open(S('scout-slots.json')))['juno_row']
    NRM = (mscr.matrix_world.to_3x3() @ Vector((0, 0, 1))).normalized()
    def spt(px, py): return mscr.matrix_world @ Vector(((px / ROW['W'] - 0.5) * UW_W, (0.5 - py / ROW['H']) * UW_H, 0.0))
    cam = Camera(lens=35, fstop=4.0)
    if kind == 'b':
        # a band of cyan light scans down the queue; each waiting candidate's row lights as it passes
        m, e = emissive('Scan', CYAN_HOT, 0.0)
        bar = rounded_mesh('Scan', UW_W * 0.98, 0.006, 0.0029, mat=m)
        rot = mscr.matrix_world.to_3x3().to_4x4()
        for f, py in ((4, 0.08 * ROW['H']), (44, 0.97 * ROW['H'])):
            bar.matrix_world = Matrix.Translation(spt(ROW['W'] / 2, py) + NRM * 0.005) @ rot; bar.keyframe_insert('location', frame=f)
        key_val(e.inputs['Strength'], [(4, 0.0), (8, 7.0), (40, 7.0), (46, 0.0)]); visible(bar, [(4, 46)])
        for i, (py, f) in enumerate(((0.36, 18), (0.58, 30))):      # the two candidates waiting in the queue (real rows)
            oc = bpy.data.curves.new(f'Row{i}', 'CURVE'); oc.dimensions = '3D'; osp = oc.splines.new('POLY')
            rp = rounded_rect_points(ROW['w'] / ROW['W'] * UW_W + 0.01, 0.2, 0.02, 6); osp.points.add(len(rp) - 1)
            for k_, (x, y) in enumerate(rp): osp.points[k_].co = (x, y, 0, 1)
            osp.use_cyclic_u = True; oc.bevel_depth = 0.0025
            ob = link(bpy.data.objects.new(f'Row{i}', oc)); rm_, re_ = emissive(f'Row{i}M', CYAN_HOT, 0.0); ob.data.materials.append(rm_)
            ob.matrix_world = Matrix.Translation(spt(ROW['x'] + ROW['w'] / 2, py * ROW['H']) + NRM * 0.005) @ rot
            key_val(re_.inputs['Strength'], [(f - 2, 0.0), (f + 2, 5.0), (60, 2.0), (72, 0.0)]); visible(ob, [(f - 2, 72)])
        focus = spt(ROW['x'] + 0.3 * ROW['w'], 0.5 * ROW['H'])
        cam.key(1, tuple(focus + NRM * 1.7 + Vector((0, 0, 0.25))), tuple(focus + Vector((0, 0, 0.25))), tuple(focus), 3.2, 35)
        cam.key(50, tuple(focus + NRM * 1.45 + Vector((0.05, 0, 0.25))), tuple(focus + Vector((0.05, 0, 0.25))), tuple(focus))
    else:
        # a wall of light divides the two worlds, then parts
        wm, we = emissive('Divide', (1.0, 0.95, 0.9), 0.0)
        bpy.ops.mesh.primitive_cube_add(size=1, location=tuple(P0 + Vector((0.05, -0.4, 1.0)))); wall = bpy.context.active_object
        wall.scale = (0.012, 0.012, 7.0); wall.data.materials.append(wm)
        key_val(we.inputs['Strength'], [(1, 14.0), (36, 14.0), (58, 0.0)])
        keys(wall, 'scale', [(36, (0.012, 0.012, 7.0)), (58, (0.0, 0.0, 7.0))]); visible(wall, [(1, 60)])
        for nm, col, x in (('SplitS', CYAN, -1.5), ('SplitN', EMBER, 1.5)):
            lo = L_(nm, P0 + Vector((x, -3.0, 2.0)), P0 + Vector((x * 0.4, 0, 0.2)), 2.5, col, [(1, 260.0), (40, 260.0), (64, 0.0)])
            g = bpy.data.collections['NotScout' if nm == 'SplitS' else 'NotNext']        # each colour lights only its own product
            lo.light_linking.receiver_collection = g
            for co in g.collection_objects: co.light_linking.link_state = 'EXCLUDE'
        cam.key(1, tuple(P0 + Vector((0.05, -3.9, -0.55))), tuple(P0 + Vector((0.05, 0, 0.55))), tuple(P0), 4.0, 24)
        cam.key(40, tuple(P0 + Vector((0.05, -4.3, -0.4))), tuple(P0 + Vector((0.05, 0, 0.45))), tuple(P0))
    for ob in bpy.data.objects:
        if ob.type == 'LIGHT': ob.visible_camera = False
    # Hook A's last keys, exactly: frame 90 is identical in every hook
    for k_ in hook_cam_keys(WIDE)[1:]: cam.key(*k_)
    cam.smooth()
    if arg('--save'): bpy.ops.file.pack_all()
    render(os.path.join(HERE, 'frames', 'hook' + kind))
