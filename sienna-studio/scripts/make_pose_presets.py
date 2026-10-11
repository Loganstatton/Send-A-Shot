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
  'lying_on_stomach': (1216, 832, 'lying on her stomach on the bed, propped up on her elbows, chin resting on her hands, feet up behind her', merge(
      {0: (300, 330), 14: (285, 305), 15: (310, 300), 17: (345, 315)}, {1: (390, 380), 2: (380, 400), 5: (420, 390),
      3: (360, 570), 6: (420, 575), 4: (290, 460), 7: (320, 470), 8: (720, 470), 11: (730, 480), 9: (930, 520), 12: (940, 530),
      10: (1010, 330), 13: (1040, 350)})),
}

# pose ControlNet strength for presets: 0.85 followed arms-crossed 4/4 and hand-in-hair 2/2 (0.65: 2/4, 1/2).
# Kneeling was dropped: its skeleton produced a ghost second body or a standing pose in 2 of 4 tests.
STRENGTH = 0.85

out = os.path.join(os.path.dirname(__file__), '..', 'public', 'pose-presets')
os.makedirs(out, exist_ok=True)
meta = []
for pid, (w, h, prompt, kp) in P.items():
    body = [kp.get(i) for i in range(18)]
    canvas = draw_body(np.zeros((h, w, 3), np.uint8), body)
    import cv2
    cv2.imwrite(os.path.join(out, f'{pid}.png'), cv2.cvtColor(canvas, cv2.COLOR_RGB2BGR))
    meta.append({'id': pid, 'width': w, 'height': h, 'pose': prompt, 'strength': STRENGTH})
json.dump(meta, open(os.path.join(out, 'presets.json'), 'w'), indent=1)
print('wrote', [m['id'] for m in meta])
