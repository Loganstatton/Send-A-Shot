"""Prepares the owner's authorised talking/laughing reference clip for the expression test.

Checks before anything is spent on it (each failure is reported; nothing is rendered automatically):
  length       at least 4.0 s (the test uses 4 s = 64 frames at 16 fps), at most 20 s
  one face     a face is found in >= 90% of sampled frames, and only one face in most of them
  face size    large enough after the head-and-shoulders crop (>= 120 px by the app face check)
  expression   the mouth and smile actually move: jawOpen range >= 0.25 and smile range >= 0.3 across the clip,
               otherwise it cannot test talking/laughing (the dance clip fails exactly this: smile range 0.00)
Then writes talk_drive.mp4 (528x768, 16 fps, 64 frames, crop following the head) next to the existing
closeup_photo.png, using the same cropper as make_closeup.py.
Usage: prepare_talking_clip.py clip.mp4 start_sec out_dir     (env FACE_MODELS, MP_MODELS)
"""
import os, shutil, sys, tempfile
import numpy as np, cv2
HERE = os.path.dirname(os.path.abspath(__file__)); sys.path.insert(0, HERE)
import make_closeup as mc


def check_and_prepare(clip, start, out, face_dir, mp_dir):
    cap = cv2.VideoCapture(clip); fps = cap.get(cv2.CAP_PROP_FPS) or 0; n = int(cap.get(cv2.CAP_PROP_FRAME_COUNT) or 0)
    dur = n / fps if fps else 0; problems = []
    if dur < start + 4.0: problems.append(f'too short: {dur:.1f} s from {start:.1f} s (need 4 s)')
    if dur > 20: problems.append(f'too long: {dur:.1f} s (max 20 s)')
    det = mc.detector(face_dir); frames = []
    while True:
        ok, f = cap.read()
        if not ok: break
        frames.append(f)
    idx = [min(len(frames) - 1, int(round((start + i / mc.FPS) * fps))) for i in range(mc.N)] if frames and fps else []
    counts = []
    for i in idx:
        f = frames[i]; h, w = f.shape[:2]; det.setInputSize((w, h)); _, fs = det.detect(f)
        counts.append(0 if fs is None else len(fs))
    found = sum(c >= 1 for c in counts)
    if not idx or found < 0.9 * len(idx): problems.append(f'face found in {found}/{len(idx)} frames (need 90%)')
    if idx and sum(c > 1 for c in counts) > 0.2 * len(idx): problems.append('more than one face in many frames')
    report = {'duration_s': round(dur, 2), 'fps': round(fps, 2), 'faces_found': f'{found}/{len(idx)}'}
    if problems:
        return False, problems, report
    photo = os.path.join(out, 'closeup_photo.png')       # the close-up Sienna photo from make_closeup.py (unchanged)
    if not os.path.exists(photo):
        return False, ['closeup_photo.png missing in out_dir (run make_closeup.py first)'], report
    tmp = tempfile.mkdtemp()
    try:
        mc.main(clip, start, photo, tmp, face_dir)        # writes only into tmp
    except SystemExit as e:
        return False, [str(e)], report
    shutil.move(os.path.join(tmp, 'closeup_drive.mp4'), os.path.join(out, 'talk_drive.mp4'))
    from pair_qa import PairQA
    qa = PairQA(mp_dir, face_dir); jaw, smile, size = [], [], []
    cap = cv2.VideoCapture(os.path.join(out, 'talk_drive.mp4'))
    while True:
        ok, f = cap.read()
        if not ok: break
        p = os.path.join(tmp, 'f.png'); cv2.imwrite(p, f); a = qa.analyze(p)
        if 'jaw' in a: jaw.append(a['jaw']); smile.append(a['smile']); size.append(a['face_h'])
    shutil.rmtree(tmp, ignore_errors=True)
    if len(jaw) < 0.9 * mc.N: problems.append(f'expression readable in only {len(jaw)}/{mc.N} cropped frames')
    jr = float(np.ptp(jaw)) if jaw else 0.0; sr = float(np.ptp(smile)) if smile else 0.0
    report.update({'jaw_range': round(jr, 3), 'smile_range': round(sr, 3), 'face_h_px_median': round(float(np.median(size)), 1) if size else None})
    if jr < 0.25: problems.append(f'mouth barely moves (jawOpen range {jr:.2f} < 0.25)')
    if sr < 0.3: problems.append(f'no real smile/laugh (smile range {sr:.2f} < 0.3)')
    if size and np.median(size) < 120: problems.append(f'face too small after crop ({np.median(size):.0f} px)')
    return not problems, problems, report


if __name__ == '__main__':
    ok, problems, rep = check_and_prepare(sys.argv[1], float(sys.argv[2]), sys.argv[3], os.environ['FACE_MODELS'], os.environ['MP_MODELS'])
    print(rep)
    print('READY: talk_drive.mp4 written' if ok else 'NOT USABLE:\n  ' + '\n  '.join(problems))
    sys.exit(0 if ok else 1)
