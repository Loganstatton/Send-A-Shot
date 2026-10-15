"""Training-pair QA for WA2 identity pairs (CPU only).

Measures, for any image: head yaw/pitch/roll (MediaPipe face mesh transform), the 52 expression blendshapes,
mouth opening from the 478-point mesh, body landmarks (MediaPipe pose), hair/face/body/clothes/background masks
(MediaPipe multiclass segmenter) and identity (SFace, same family as the app's face check).
`gate(target, driver)` applies the acceptance rules for a REFERENCE + DRIVER -> TARGET pair.

Models (paths via env or arguments): face_landmarker.task, pose_landmarker_full.task, selfie_multiclass_256x256.tflite
(storage.googleapis.com/mediapipe-models), face_detection_yunet_2023mar.onnx, face_recognition_sface_2021dec.onnx.
"""
import os
import numpy as np
import cv2

# Acceptance thresholds (degrees, blendshape units 0..1, fractions of face height / shoulder width)
GATES = dict(yaw=10.0, pitch=10.0, roll=6.0, jaw=0.15, smile=0.20, mouth_gap=0.03, blink=0.35,
             body=0.15, driver_id_max=0.35, target_id_min=0.70, profile_yaw=35.0, hair_de=20.0)
SEG = ['background', 'hair', 'body_skin', 'face_skin', 'clothes', 'others']
# inner-lip landmarks (upper 13, lower 14), face height from forehead 10 to chin 152
UL, LL, TOP, CHIN = 13, 14, 10, 152


class PairQA:
    def __init__(self, mp_dir, face_dir):
        import mediapipe as mp
        from mediapipe.tasks.python import vision, BaseOptions
        self.mp = mp
        self.fl = vision.FaceLandmarker.create_from_options(vision.FaceLandmarkerOptions(
            base_options=BaseOptions(model_asset_path=f'{mp_dir}/face_landmarker.task'), output_face_blendshapes=True,
            output_facial_transformation_matrixes=True, num_faces=1))
        self.pl = vision.PoseLandmarker.create_from_options(vision.PoseLandmarkerOptions(
            base_options=BaseOptions(model_asset_path=f'{mp_dir}/pose_landmarker_full.task'), num_poses=1))
        self.sg = vision.ImageSegmenter.create_from_options(vision.ImageSegmenterOptions(
            base_options=BaseOptions(model_asset_path=f'{mp_dir}/selfie_multiclass_256x256.tflite'), output_category_mask=True))
        self.det = cv2.FaceDetectorYN.create(f'{face_dir}/face_detection_yunet_2023mar.onnx', '', (320, 320), 0.6)
        self.rec = cv2.FaceRecognizerSF.create(f'{face_dir}/face_recognition_sface_2021dec.onnx', '')
        self.refs = []

    # ---------- identity ----------
    def embed(self, bgr):
        """SFace embedding of the most confident face (largest among confident ones), or None."""
        h, w = bgr.shape[:2]; s = min(1.0, 1024 / max(h, w)); im = cv2.resize(bgr, (int(w * s), int(h * s))) if s < 1 else bgr
        self.det.setInputSize((im.shape[1], im.shape[0])); _, fs = self.det.detect(im)
        if fs is None or len(fs) == 0: return None, None
        good = [f for f in fs if f[14] >= 0.8] or list(fs)
        f = max(good, key=lambda r: r[2] * r[3])
        return self.rec.feature(self.rec.alignCrop(im, f)), float(f[14])

    def set_refs(self, paths):
        self.refs = [e for e in (self.embed(cv2.imread(p))[0] for p in paths) if e is not None]

    def identity(self, emb):
        if emb is None or not self.refs: return None
        return float(np.mean([self.rec.match(emb, r, cv2.FaceRecognizerSF_FR_COSINE) for r in self.refs]))

    # ---------- measurements ----------
    def analyze(self, path):
        bgr = cv2.imread(path); rgb = cv2.cvtColor(bgr, cv2.COLOR_BGR2RGB); H, W = rgb.shape[:2]
        im = self.mp.Image(image_format=self.mp.ImageFormat.SRGB, data=np.ascontiguousarray(rgb))
        out = dict(path=path, size=[W, H])
        r = self.fl.detect(im)
        if r.face_landmarks:
            R = np.array(r.facial_transformation_matrixes[0])[:3, :3]
            out['yaw'] = float(np.degrees(np.arctan2(-R[2, 0], np.hypot(R[2, 1], R[2, 2]))))
            out['pitch'] = float(np.degrees(np.arctan2(R[2, 1], R[2, 2])))
            out['roll'] = float(np.degrees(np.arctan2(R[1, 0], R[0, 0])))
            b = {c.category_name: float(c.score) for c in r.face_blendshapes[0]}
            out['bs'] = b
            out['jaw'] = b['jawOpen']; out['smile'] = (b['mouthSmileLeft'] + b['mouthSmileRight']) / 2
            out['blink'] = (b['eyeBlinkLeft'] + b['eyeBlinkRight']) / 2
            lm = np.array([[p.x * W, p.y * H] for p in r.face_landmarks[0]])
            out['lm3'] = [[p.x * W, p.y * H, p.z * W] for p in r.face_landmarks[0]]
            fh = np.linalg.norm(lm[TOP] - lm[CHIN]) + 1e-6
            out['mouth_gap'] = float(np.linalg.norm(lm[UL] - lm[LL]) / fh)
            out['face_h'] = float(fh); out['lm'] = lm.tolist()
            out['fbox'] = [float(lm[:, 0].min()), float(lm[:, 1].min()), float(lm[:, 0].max()), float(lm[:, 1].max())]
        p = self.pl.detect(im)
        if p.pose_landmarks:
            out['body'] = [[q.x * W, q.y * H, q.visibility] for q in p.pose_landmarks[0]]
        s = self.sg.segment(im).category_mask.numpy_view()
        out['seg_frac'] = {n: float((s == i).mean()) for i, n in enumerate(SEG)}
        hair = s == 1
        if hair.sum() > 200:
            lab = cv2.cvtColor(bgr, cv2.COLOR_BGR2LAB).reshape(-1, 3)[cv2.resize(hair.astype(np.uint8), (W, H), interpolation=cv2.INTER_NEAREST).reshape(-1) > 0]
            out['hair_lab'] = np.median(lab, 0).tolist()
        emb, conf = self.embed(bgr); out['id'] = self.identity(emb); out['face_conf'] = conf
        out['_seg'] = np.array(s)
        return out

    # ---------- pair rules ----------
    @staticmethod
    def facing(body):
        """+1 if the person faces the camera (their left shoulder on image right), -1 if seen from behind, 0 unknown."""
        if not body: return 0
        L, R, nose = body[11], body[12], body[0]
        if min(L[2], R[2]) < 0.5: return 0
        side = np.sign(L[0] - R[0])
        return int(side) if nose[2] > 0.5 else -1

    @staticmethod
    def eye_roll(lm):
        """In-image head tilt from the eye corners (33, 263), degrees. This is what an image rotation corrects."""
        a, b = np.array(lm[33]), np.array(lm[263]); return float(np.degrees(np.arctan2(b[1] - a[1], b[0] - a[0])))

    @staticmethod
    def shoulder_err(t, d):
        """Head-and-shoulders framing: shoulder-line angle difference (deg) and shoulder width / face height ratio
        difference (relative). None if shoulders are not both visible in both images."""
        A, B = t.get('body'), d.get('body')
        if not A or not B or 'face_h' not in t or 'face_h' not in d: return None
        if min(A[11][2], A[12][2], B[11][2], B[12][2]) < 0.5: return None
        ang = lambda P: np.degrees(np.arctan2(P[11][1] - P[12][1], P[11][0] - P[12][0]))
        wa = np.hypot(A[11][0] - A[12][0], A[11][1] - A[12][1]) / t['face_h']; wb = np.hypot(B[11][0] - B[12][0], B[11][1] - B[12][1]) / d['face_h']
        da = abs((ang(A) - ang(B) + 180) % 360 - 180)
        return float(da), float(abs(wa - wb) / wa)

    @staticmethod
    def body_err(a, b):
        """Mean distance of visible body landmarks (shoulders..ankles, 11..28) after aligning shoulder midpoints and
        scaling by shoulder width, in shoulder widths. None when fewer than 4 shared landmarks."""
        if not a or not b: return None
        A, B = np.array(a), np.array(b); idx = [i for i in range(11, 29) if A[i, 2] > .5 and B[i, 2] > .5]
        if len(idx) < 4 or 11 not in idx or 12 not in idx: return None
        sa = np.linalg.norm(A[11, :2] - A[12, :2]) + 1e-6; sb = np.linalg.norm(B[11, :2] - B[12, :2]) + 1e-6
        ca, cb = (A[11, :2] + A[12, :2]) / 2, (B[11, :2] + B[12, :2]) / 2
        return float(np.mean(np.linalg.norm((A[idx, :2] - ca) / sa - (B[idx, :2] - cb) / sb, axis=1)))

    def gate(self, t, d):
        """Returns (checks: name -> (value, ok)), verdict, reasons. ok None means 'needs visual review'."""
        G = GATES; c = {}
        if 'hair_lab' in t and 'hair_lab' in d:
            v = float(np.linalg.norm(np.array(t['hair_lab']) - np.array(d['hair_lab']))); c['hair_diff'] = (v, True if v >= G['hair_de'] else None)
        c['driver_id'] = (d.get('id'), d.get('id') is not None and d['id'] <= G['driver_id_max'])
        be = self.body_err(t.get('body'), d.get('body')); c['body'] = (be, None if be is None else be <= G['body'])
        ft, fd = self.facing(t.get('body')), self.facing(d.get('body'))
        c['facing'] = ((ft, fd), not (ft == 1 and fd == -1))
        if 'yaw' not in t:
            c['target_id'] = (t.get('id'), None); c['expression'] = ('face too small or not visible', None)
            return self._verdict(c)
        if 'yaw' not in d: c['driver_face'] = (None, False); return self._verdict(c)
        for k in ('yaw', 'pitch', 'jaw', 'smile', 'mouth_gap', 'blink'):
            v = abs(t[k] - d[k]); c[k] = (v, v <= G[k])
        v = abs((self.eye_roll(t['lm']) - self.eye_roll(d['lm']) + 180) % 360 - 180); c['roll'] = (v, v <= G['roll'])
        se = self.shoulder_err(t, d)
        if se is not None:
            c['shoulders'] = (se, se[0] <= 12 and se[1] <= 0.25)
            if c['body'][0] is None: del c['body']   # head-and-shoulders shot: shoulders are the body check
        if abs(t['yaw']) >= G['profile_yaw'] or t.get('id') is None: c['target_id'] = (t.get('id'), None)
        else: c['target_id'] = (t['id'], t['id'] >= G['target_id_min'])
        return self._verdict(c)

    @staticmethod
    def _verdict(c):
        fails = [k for k, (_, ok) in c.items() if ok is False]; review = [k for k, (_, ok) in c.items() if ok is None]
        return c, ('FAIL' if fails else 'REVIEW' if review else 'PASS'), fails + [f'{k}: visual review' for k in review]


def head_mask(qa_out, dilate=0.12):
    """Loss mask for cross-outfit pairs: face skin + hair (segmenter) plus the face-mesh hull, dilated by a fraction of
    face height. Everything else gets zero weight, so outfit and background differences are not trained on."""
    s = qa_out['_seg']; W, H = qa_out['size']
    m = cv2.resize(((s == 1) | (s == 3)).astype(np.uint8), (W, H), interpolation=cv2.INTER_NEAREST)
    if 'lm' in qa_out:
        cv2.fillConvexPoly(m, cv2.convexHull(np.array(qa_out['lm'], np.int32)), 1)
        k = max(3, int(qa_out['face_h'] * dilate)) | 1
        m = cv2.dilate(m, cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (k, k)))
    return m
