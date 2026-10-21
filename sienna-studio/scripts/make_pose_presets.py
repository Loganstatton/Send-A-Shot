"""Draws Sienna Studio's pose presets as OpenPose skeleton images (xinsr stick widths) into public/pose-presets.
Run: python3 scripts/make_pose_presets.py   (needs numpy + opencv). Keypoints are OpenPose-18:
0 nose 1 neck 2 R-shoulder 3 R-elbow 4 R-wrist 5 L-shoulder 6 L-elbow 7 L-wrist 8 R-hip 9 R-knee 10 R-ankle
11 L-hip 12 L-knee 13 L-ankle 14 R-eye 15 L-eye 16 R-ear 17 L-ear (R = her right = image left when facing camera)."""
import json, os, sys
import numpy as np
sys.path.insert(0, os.path.join(os.path.dirname(__file__), 'comfy_nodes', 'sienna_nodes'))
from sienna_pose import draw_body  # noqa: E402

def face(cx, cy, s=1.0, turn=0):
    """nose, eyes, ears around (cx, cy); turn<0 looks to image-left."""
    return {0: (cx + turn * s, cy), 14: (cx - 22 * s + turn * s, cy - 22 * s), 15: (cx + 22 * s + turn * s, cy - 22 * s),
            16: (cx - 55 * s, cy - 12 * s), 17: (cx + 55 * s, cy - 12 * s)}

def merge(*ds):
    out = {}
    for d in ds:
        out.update(d)
    return out

P = {
  'sitting_crosslegged': (832, 1216, 'sitting cross-legged, hands resting on her knees', merge(face(416, 300), {1: (416, 400), 2: (325, 420), 5: (507, 420), 3: (290, 570), 6: (542, 570), 4: (270, 735), 7: (562, 735),
      8: (372, 700), 11: (460, 700), 9: (200, 820), 12: (632, 820), 10: (480, 880), 13: (352, 880)})),
  'arms_crossed': (832, 1216, 'standing with her arms folded across her chest, each hand on the opposite upper arm', merge(face(416, 250), {1: (416, 360), 2: (318, 380), 5: (514, 380), 3: (305, 560), 6: (527, 560), 4: (530, 470), 7: (302, 470),
      8: (362, 790), 11: (470, 790), 9: (358, 1060), 12: (474, 1060)})),
  'hand_in_hair': (832, 1216, 'close-up, one hand raised running through her hair', merge(face(416, 470, 2.2), {1: (416, 740), 2: (210, 830), 5: (622, 830), 3: (130, 520), 4: (250, 290), 6: (700, 1180)})),
  'mirror_selfie': (832, 1216, 'mirror selfie, holding a phone up in front of her chest with one hand, other hand on her hip', merge(face(416, 270), {1: (416, 380), 2: (320, 400), 5: (512, 400), 3: (250, 560), 4: (330, 470), 6: (600, 570), 7: (520, 700),
      8: (366, 790), 11: (466, 790), 9: (360, 1070), 12: (472, 1070)})),
  # rear view: her right side is on the image's right; head turned to look back over her right shoulder.
  # Drawn bent at the waist, but SDXL's pose ControlNet gives a standing look-back with a slight lean (5/5);
  # true bending-over (front/side/back) was ignored in 11 tests — she knelt, crouched or stood.
  'looking_back': (832, 1216, 'seen from behind, leaning forward slightly, looking back over her shoulder at the camera', merge(
      {0: (478, 668), 14: (492, 650), 15: (462, 648), 17: (420, 660)}, {1: (416, 640), 2: (512, 628), 5: (320, 628),
      3: (530, 740), 6: (302, 740), 4: (488, 815), 7: (344, 815), 8: (468, 515), 11: (364, 515), 9: (478, 805), 12: (354, 805),
      10: (490, 1125), 13: (342, 1125)})),
  'lying_on_stomach': (1216, 832, 'lying on her stomach on the bed, propped up on her elbows, chin resting on her hands, feet up behind her', merge(
      {0: (300, 330), 14: (285, 305), 15: (310, 300), 17: (345, 315)}, {1: (390, 380), 2: (380, 400), 5: (420, 390),
      3: (360, 570), 6: (420, 575), 4: (290, 460), 7: (320, 470), 8: (720, 470), 11: (730, 480), 9: (930, 520), 12: (940, 530),
      10: (1010, 330), 13: (1040, 350)})),
  # Added after the position test (2026-10-17): text alone gave sitting-up photos for "lying on her back/side" and
  # never full body for "standing ... head to feet".
  'standing_full_body': (832, 1216, 'standing, full body from head to feet, arms relaxed at her sides', merge(face(416, 175, 0.85), {
      1: (416, 265), 2: (332, 285), 5: (500, 285), 3: (318, 450), 6: (514, 450), 4: (322, 600), 7: (510, 600),
      8: (370, 640), 11: (462, 640), 9: (366, 880), 12: (466, 880), 10: (370, 1105), 13: (462, 1105)})),
  # head at image-left, face turned to the camera (top of her head points left), one arm above her head
  'lying_on_back': (1216, 832, 'lying on her back on the bed, legs together and straight, one arm above her head', merge(
      {0: (250, 400), 14: (228, 378), 15: (228, 422), 16: (238, 345), 17: (238, 455)}, {1: (330, 410), 2: (335, 440), 5: (330, 375),
      3: (250, 330), 4: (170, 290), 6: (450, 470), 7: (580, 480), 8: (650, 440), 11: (650, 405),
      9: (880, 440), 12: (880, 412), 10: (1100, 448), 13: (1100, 420)})),
  # on her right side facing the camera, propped on her right elbow, top hand resting on her hip, knees slightly bent
  'lying_on_side': (1216, 832, 'lying on her side on the bed, propped up on one elbow, legs together and slightly bent', merge(face(330, 250, 0.8), {
      1: (345, 335), 2: (325, 410), 5: (385, 345), 3: (300, 560), 4: (420, 575), 6: (520, 450), 7: (640, 520),
      8: (690, 580), 11: (700, 530), 9: (900, 600), 12: (910, 565), 10: (1110, 640), 13: (1120, 610)})),
  # thighs upright, shins folded back along the bed (ankles behind and to the side, lower than the knees) so it can't
  # read as standing cut off at the knees — the earlier kneeling preset without shins gave standing photos
  'kneeling_upright': (832, 1216, 'kneeling upright on the bed, knees together, hands resting on her thighs', merge(face(430, 240), {
      1: (430, 350), 2: (336, 370), 5: (524, 370), 3: (318, 545), 6: (540, 545), 4: (378, 720), 7: (486, 720),
      8: (382, 700), 11: (476, 700), 9: (392, 980), 12: (474, 990), 10: (230, 1060), 13: (300, 1080)})),
  # Rear three-quarter hip hinge, camera behind her at hip height, facing image-left. The torso is drawn below
  # horizontal (neck lower than the hips) so the hinge can't be read as standing; knees are only slightly bent and
  # in front of the hip-ankle line, and both ankles are on the floor below the knees, so it can't read as a squat or a
  # kneel. Rear view: no eyes, the nose hidden under her hanging head links it to the neck. Her right side is
  # image-right. Drawn at 1.3x so she fills the portrait frame (hips near the top third, feet near the bottom).
  'bent_over_rear': (832, 1216, 'seen from behind, bending forward deeply at the waist, hips raised, legs nearly straight with a slight bend at the knees, feet flat on the ground', {
      i: (round((x - 380) * 1.3 + 416), round((y - 528) * 1.3 + 330)) for i, (x, y) in {
      0: (200, 800), 16: (232, 760), 17: (178, 712), 1: (262, 680), 2: (322, 712), 5: (232, 626),
      3: (318, 858), 4: (322, 1000), 6: (214, 772), 7: (210, 916),
      8: (548, 556), 11: (470, 528), 9: (522, 812), 12: (440, 800), 10: (540, 1092), 13: (458, 1084)}.items()}),
  # ── Pose guides (21 Oct): picked by the AI reader from the description, hands and legs included. Text alone never
  # held "sitting on the edge of the bed, feet on the floor", "foot pressed against the cabinet" or a low camera in the
  # controlled test. Sitting is drawn three-quarter: seen straight on, the foreshortened thighs read as standing.
  'sitting_edge_hands_chest': (832, 1216, 'sitting upright on the edge of the bed, both feet flat on the floor, both hands holding a mug in front of her chest', merge(face(470, 250, 0.9, -8), {
      1: (470, 350), 2: (390, 372), 5: (552, 368), 3: (372, 520), 6: (570, 520), 4: (448, 455), 7: (490, 455),
      8: (440, 660), 11: (512, 650), 9: (290, 700), 12: (352, 725), 10: (300, 1050), 13: (366, 1070)})),
  'sitting_edge_hands_lap': (832, 1216, 'sitting upright on the edge of the bed, both feet flat on the floor, hands resting in her lap', merge(face(470, 250, 0.9, -8), {
      1: (470, 350), 2: (390, 372), 5: (552, 368), 3: (368, 530), 6: (574, 530), 4: (372, 680), 7: (440, 690),
      8: (440, 660), 11: (512, 650), 9: (290, 700), 12: (352, 725), 10: (300, 1050), 13: (366, 1070)})),
  'sitting_sofa': (832, 1216, 'sitting relaxed on the sofa, leaning back, one arm resting along the sofa, feet on the floor', merge(face(520, 330, 0.9, -8), {
      1: (510, 430), 2: (432, 445), 5: (594, 440), 3: (400, 600), 4: (400, 720), 6: (680, 540), 7: (760, 600),
      8: (462, 740), 11: (536, 735), 9: (300, 770), 12: (352, 800), 10: (260, 1080), 13: (330, 1095)})),
  # her right hand back on the counter edge at hip height, left hand holding a glass at her chest, left knee bent
  # with that foot raised behind her against the cabinet
  'leaning_counter_foot_up': (832, 1216, 'leaning back against the counter, right hand resting on the counter edge, left hand holding a glass at her chest, left knee bent with the foot pressed against the cabinet behind her', merge(face(416, 240, 0.9), {
      1: (416, 345), 2: (326, 366), 5: (506, 366), 3: (282, 520), 4: (296, 650), 6: (540, 540), 7: (470, 440),
      8: (372, 660), 11: (462, 660), 9: (374, 895), 12: (500, 860), 10: (380, 1125), 13: (430, 975)})),
  # her right leg raised sideways, foot resting on a counter at hip height
  'standing_leg_up': (832, 1216, 'standing on one leg, her other leg raised with the foot resting on the counter at hip height', merge(face(470, 240, 0.9), {
      1: (470, 345), 2: (380, 366), 5: (560, 366), 3: (330, 500), 4: (300, 610), 6: (580, 520), 7: (575, 660),
      8: (430, 650), 11: (520, 650), 9: (270, 600), 12: (525, 890), 10: (130, 650), 13: (530, 1125)})),
  # low camera: long legs, big feet near the bottom edge, short torso, small head and narrow shoulders
  'standing_low_angle': (832, 1216, 'standing, full body, seen from a low camera angle looking up at her', merge(face(416, 250, 0.7), {
      1: (416, 328), 2: (348, 342), 5: (484, 342), 3: (330, 465), 6: (502, 465), 4: (334, 585), 7: (498, 585),
      8: (374, 600), 11: (458, 600), 9: (360, 870), 12: (472, 870), 10: (346, 1160), 13: (486, 1160)})),
  'standing_holding_glass': (832, 1216, 'standing, full body, holding a glass at her chest in her left hand, right arm relaxed', merge(face(416, 175, 0.85), {
      1: (416, 265), 2: (332, 285), 5: (500, 285), 3: (318, 450), 4: (322, 600), 6: (530, 440), 7: (470, 370),
      8: (370, 640), 11: (462, 640), 9: (366, 880), 12: (466, 880), 10: (370, 1105), 13: (462, 1105)})),
}

# pose ControlNet strength for presets: 0.85 followed arms-crossed 4/4 and hand-in-hair 2/2 (0.65: 2/4, 1/2).
# Kneeling was dropped: its skeleton produced a ghost second body or a standing pose in 2 of 4 tests.
STRENGTH = 0.85
# bent_over_rear: the earlier bend-over skeletons were ignored at 0.85 (she knelt, crouched or stood in 11 tests), so
# this one runs at full strength — to be confirmed on the GPU
STRENGTHS = {'bent_over_rear': 1.0}
# presets drawn from a low camera (allowed with a low-angle request; every other preset is eye level)
LOW_VIEW = {'standing_low_angle'}

out = os.path.join(os.path.dirname(__file__), '..', 'public', 'pose-presets')
os.makedirs(out, exist_ok=True)
meta = []
for pid, (w, h, prompt, kp) in P.items():
    body = [kp.get(i) for i in range(18)]
    canvas = draw_body(np.zeros((h, w, 3), np.uint8), body)
    import cv2
    cv2.imwrite(os.path.join(out, f'{pid}.png'), cv2.cvtColor(canvas, cv2.COLOR_RGB2BGR))
    meta.append({'id': pid, 'width': w, 'height': h, 'pose': prompt, 'strength': STRENGTHS.get(pid, STRENGTH), **({'view': 'low'} if pid in LOW_VIEW else {})})
json.dump(meta, open(os.path.join(out, 'presets.json'), 'w'), indent=1)
print('wrote', [m['id'] for m in meta])
