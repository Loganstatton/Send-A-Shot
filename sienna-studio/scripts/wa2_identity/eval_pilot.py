"""Copy Motion evaluation for the WA2 identity-LoRA pilot (CPU; runs locally on downloaded renders).

Every run is the SAME driving clip, seed, resolution and Sienna photo; only the LoRA / face-restore setting differs.
Per run it reports:
  identity    the app's face check (YuNet + SFace vs Sienna's reference embedding, faces >= 64 px), the scorer behind
              the 0.39-0.42 Copy Motion baseline and the 0.67 face-restored result: median, p10, frames >= 0.74,
              split by head angle (output frame) and by the driver's expression (neutral / smile / open mouth)
  flicker     mean frame-to-frame change inside the aligned face crop (same measure as before; lower = steadier)
  liveliness  how much her mouth/smile moves over the clip (std of MediaPipe jawOpen + smile) relative to the
              no-LoRA run, plus correlation with the driver's mouth. A frozen or expressionless face FAILS.
  motion      body keypoints of the output vs the driving video (MediaPipe pose; each skeleton centred on the hips and scaled
              by its torso length, so pose is compared, not body size):
              mean error and share of joints within 0.2 torso lengths
  clothing    colour of the torso region vs the Sienna photo (CIE76 delta E, median) and its frame-to-frame jitter
  body        shoulder/torso and hip/shoulder ratios vs the no-LoRA run (relative change)
Usage: eval_pilot.py --driver drive.mp4 --start-sec 1.0 --ref sienna.png --out report.json NAME=video.mp4|frames_dir ...
The first NAME is the no-LoRA baseline that liveliness and body proportions are compared with.
"""
import argparse, glob, json, os, sys, tempfile
import numpy as np, cv2

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE); sys.path.insert(0, os.path.join(HERE, '..', 'comfy_nodes', 'sienna_nodes'))
W, H, N = 528, 768, 192
JOINTS = [11, 12, 13, 14, 15, 16, 23, 24, 25, 26, 27, 28]   # shoulders, elbows, wrists, hips, knees, ankles


def fit(img, w=W, h=H):
    ih, iw = img.shape[:2]; s = max(w / iw, h / ih)
    r = cv2.resize(img, (int(round(iw * s)), int(round(ih * s))), interpolation=cv2.INTER_AREA)
    y0, x0 = (r.shape[0] - h) // 2, (r.shape[1] - w) // 2
    return r[y0:y0 + h, x0:x0 + w]


def read_driver(src, start_sec, count, fps=16):
    """The driving clip as Copy Motion feeds it: resampled to 16 fps from start_sec, cover-cropped to W x H."""
    cap = cv2.VideoCapture(src); vfps = cap.get(cv2.CAP_PROP_FPS) or fps; allf = []
    while True:
        ok, f = cap.read()
        if not ok: break
        allf.append(f)
    idx = [min(len(allf) - 1, int(round((start_sec + i / fps) * vfps))) for i in range(count)]
    return [fit(allf[i]) for i in idx]


def read_frames(src, start=0, count=None):
    if os.path.isdir(src):
        fr = [cv2.imread(p) for p in sorted(glob.glob(src + '/*.png') + glob.glob(src + '/*.jpg'))]
    else:
        cap = cv2.VideoCapture(src); fr = []
        while True:
            ok, f = cap.read()
            if not ok: break
            fr.append(f)
    fr = fr[start:start + count] if count else fr[start:]
    return [fit(f) if f.shape[:2] != (H, W) else f for f in fr]


def crop_box(b, k=1.7):
    x, y, bw, bh = b; cx, cy, s = x + bw / 2, y + bh / 2, max(bw, bh) * k
    return int(round(cx - s / 2)), int(round(cy - s / 2)), int(round(s))


def get_crop(img, cb):
    x0, y0, s = cb; pad = cv2.copyMakeBorder(img, s, s, s, s, cv2.BORDER_REFLECT)
    return cv2.resize(pad[y0 + s:y0 + 2 * s, x0 + s:x0 + 2 * s], (N, N), interpolation=cv2.INTER_AREA).astype(np.float32)


ELL = np.zeros((N, N), np.float32); cv2.ellipse(ELL, (N // 2, int(N * 0.52)), (int(N * 0.27), int(N * 0.34)), 0, 0, 360, 1, -1)
ELL = cv2.GaussianBlur(ELL, (0, 0), N * 0.05)[..., None]


def flicker(frames, bxs):
    v = []
    for t in range(1, len(frames)):
        if bxs[t] is None or bxs[t - 1] is None: continue
        cb = crop_box(bxs[t]); a, b = get_crop(frames[t - 1], cb), get_crop(frames[t], cb)
        v.append(float(np.mean(np.abs(a - b) * ELL) / np.mean(ELL)))
    return float(np.mean(v)) if v else None


def torso(body):
    if not body or min(body[i][2] for i in (11, 12, 23, 24)) < 0.5: return None
    p = {i: np.array(body[i][:2]) for i in (11, 12, 23, 24)}
    sh, hp = (p[11] + p[12]) / 2, (p[23] + p[24]) / 2
    return {'len': float(np.linalg.norm(sh - hp)), 'sw': float(np.linalg.norm(p[11] - p[12])), 'hw': float(np.linalg.norm(p[23] - p[24])),
            'poly': np.array([p[12], p[11], p[23], p[24]], np.int32)}


def norm_pose(body):
    """Joints relative to the hip centre, in torso lengths: compares body POSE, not size or placement (Wan Animate
    re-fits the driver's skeleton to her body and framing, so raw pixel positions are not comparable)."""
    t = torso(body)
    if not t or t['len'] < 10: return None
    hp = (np.array(body[23][:2]) + np.array(body[24][:2])) / 2
    return {j: (np.array(body[j][:2]) - hp) / t['len'] for j in JOINTS if body[j][2] > 0.5}


def torso_lab(img, body):
    t = torso(body)
    if not t: return None
    m = np.zeros(img.shape[:2], np.uint8); cv2.fillConvexPoly(m, t['poly'], 1)
    m = cv2.erode(m, np.ones((9, 9), np.uint8))
    if m.sum() < 400: return None
    return cv2.cvtColor(img, cv2.COLOR_BGR2LAB).reshape(-1, 3)[m.reshape(-1) > 0].astype(np.float32).mean(0) * np.array([100 / 255, 1, 1]) - np.array([0, 128, 128])


def expr_bin(a):
    if a is None or 'jaw' not in a: return 'unreadable'
    if a['jaw'] > 0.25 or a['mouth_gap'] > 0.06: return 'open'
    return 'smile' if a['smile'] > 0.4 else 'neutral'


def angle_bin(a):
    if a is None or 'yaw' not in a: return 'unreadable (profile/small)'
    y = abs(a['yaw'])
    return 'frontal <15' if y < 15 else 'turned 15-35' if y < 35 else 'strong >35'


class Analyzer:
    def __init__(self, mp_dir, face_dir):
        import sienna_face as sf
        from pair_qa import PairQA
        self.sf, self.M = sf, sf.models(face_dir)
        self.ref = sf.reference_embedding([json.load(open(os.path.join(HERE, '..', '..', 'lib', 'sienna-face-reference.json')))])
        self.qa = PairQA(mp_dir, face_dir); self.tmp = tempfile.mkdtemp(); self.heldout = None

    def set_heldout(self, paths):
        """Embedding of the held-out validation photos (never trained on): scores whether the LoRA learned HER, not
        just its training photos. Profiles the detector misses are skipped."""
        embs = [self.sf.faces(cv2.imread(p), *self.M) for p in paths]
        embs = [f[0]['embedding'] for f in embs if f]
        self.heldout = self.sf.reference_embedding(embs) if embs else None
        return len(embs)

    def frame(self, img):
        p = os.path.join(self.tmp, 'f.png'); cv2.imwrite(p, img); a = self.qa.analyze(p); a.pop('_seg', None)
        found = self.sf.faces(img, *self.M); out = {'mp': a}
        if found:
            c = self.sf.check(found, self.ref, 0.74, 64); out['sim'], out['size'] = c['similarity'], c['size']
            if self.heldout is not None: out['sim_heldout'] = self.sf.similarity(found[0]['embedding'], self.heldout)
        det = self.M[0]; det.setInputSize((W, H)); _, fs = det.detect(img)
        out['box'] = None if fs is None else fs[np.argmax(fs[:, 2] * fs[:, 3])][:4].tolist()
        return out


def summarise(name, frames, A, drv, ref_lab, base=None):
    sims = [a['sim'] for a in A if a.get('sim') is not None and a['size'] >= 64]
    stat = lambda v: {'n': len(v), 'median': float(np.median(v)) if v else None, 'p10': float(np.percentile(v, 10)) if v else None,
                      'pass_074': int(sum(x >= 0.74 for x in v))}
    r = {'frames': len(frames), 'faces_scored': len(sims), 'identity': stat(sims),
         'face_px_median': float(np.median([a['size'] for a in A if a.get('size')])) if any(a.get('size') for a in A) else None}
    by_ang, by_exp = {}, {}
    for a, d in zip(A, drv):
        if a.get('sim') is None or a['size'] < 64: continue
        by_ang.setdefault(angle_bin(a['mp']), []).append(a['sim']); by_exp.setdefault(expr_bin(d['mp']), []).append(a['sim'])
    ho = [a['sim_heldout'] for a in A if a.get('sim_heldout') is not None and a['size'] >= 64]
    if ho: r['identity_vs_heldout_photos'] = stat(ho)
    r['identity_by_angle'] = {k: stat(v) for k, v in sorted(by_ang.items())}
    r['identity_by_driver_expression'] = {k: stat(v) for k, v in sorted(by_exp.items())}
    r['unreadable_frames'] = [i for i, a in enumerate(A) if a.get('sim') is None]
    r['flicker'] = flicker(frames, [a['box'] for a in A])
    mo = np.array([[a['mp'].get('jaw', np.nan), a['mp'].get('smile', np.nan)] for a in A], float)
    md = np.array([[d['mp'].get('jaw', np.nan), d['mp'].get('smile', np.nan)] for d in drv], float)
    ok = ~np.isnan(mo).any(1)
    r['expression_motion'] = float(np.nanstd(mo[:, 0]) + np.nanstd(mo[:, 1])) if ok.sum() > 5 else None
    both = ok & ~np.isnan(md).any(1)
    r['mouth_follows_driver_corr'] = float(np.corrcoef(mo[both, 0], md[both, 0])[0, 1]) if both.sum() > 8 and np.std(md[both, 0]) > 1e-3 and np.std(mo[both, 0]) > 1e-3 else None
    errs, pck = [], []
    for a, d in zip(A, drv):
        po, pd = norm_pose(a['mp'].get('body')), norm_pose(d['mp'].get('body'))
        if not po or not pd: continue
        for j in set(po) & set(pd):
            e = float(np.linalg.norm(po[j] - pd[j])); errs.append(e); pck.append(e < 0.2)
    r['motion'] = {'joint_error_torso_lengths': float(np.mean(errs)) if errs else None, 'joints_within_0.2': float(np.mean(pck)) if pck else None}
    labs = [torso_lab(f, a['mp'].get('body')) for f, a in zip(frames, A)]; labs = [l for l in labs if l is not None]
    r['clothing'] = {'deltaE_vs_photo_median': float(np.median([np.linalg.norm(l - ref_lab) for l in labs])) if labs and ref_lab is not None else None,
                     'deltaE_frame_to_frame': float(np.mean([np.linalg.norm(labs[i] - labs[i - 1]) for i in range(1, len(labs))])) if len(labs) > 1 else None}
    ts = [torso(a['mp'].get('body')) for a in A]; ts = [t for t in ts if t and t['len'] > 10]
    r['body'] = {'shoulder_over_torso': float(np.median([t['sw'] / t['len'] for t in ts])) if ts else None,
                 'hip_over_shoulder': float(np.median([t['hw'] / t['sw'] for t in ts if t['sw'] > 5])) if ts else None}
    if base:
        b = base
        r['vs_baseline'] = {
            'identity_median_gain': (r['identity']['median'] - b['identity']['median']) if r['identity']['median'] is not None and b['identity']['median'] is not None else None,
            'liveliness_ratio': (r['expression_motion'] / b['expression_motion']) if r['expression_motion'] and b['expression_motion'] else None,
            'flicker_change': (r['flicker'] - b['flicker']) if r['flicker'] is not None and b['flicker'] is not None else None,
            'motion_error_change': (r['motion']['joint_error_torso_lengths'] - b['motion']['joint_error_torso_lengths']) if r['motion']['joint_error_torso_lengths'] is not None and b['motion']['joint_error_torso_lengths'] is not None else None,
            'clothing_deltaE_change': (r['clothing']['deltaE_vs_photo_median'] - b['clothing']['deltaE_vs_photo_median']) if r['clothing']['deltaE_vs_photo_median'] is not None and b['clothing']['deltaE_vs_photo_median'] is not None else None,
            'body_ratio_change': {k: (r['body'][k] / b['body'][k] - 1) if r['body'][k] and b['body'][k] else None for k in r['body']}}
    return r


def verdict(r, base):
    """Per-run checks from the plan (a run passes only if every applicable check passes; visual review still decides)."""
    v = r.get('vs_baseline') or {}; c = {}
    if v.get('liveliness_ratio') is not None: c['not frozen (liveliness >= 0.8 of no-LoRA)'] = v['liveliness_ratio'] >= 0.8
    if v.get('flicker_change') is not None: c['flicker within +5% of no-LoRA'] = v['flicker_change'] <= 0.05 * base['flicker']
    if v.get('motion_error_change') is not None: c['motion kept (joint error +0.05 at most)'] = v['motion_error_change'] <= 0.05
    if v.get('clothing_deltaE_change') is not None: c['clothing kept (delta E +5 at most)'] = v['clothing_deltaE_change'] <= 5
    br = [abs(x) for x in (v.get('body_ratio_change') or {}).values() if x is not None]
    if br: c['body proportions kept (within 8%)'] = max(br) <= 0.08
    return c


if __name__ == '__main__':
    ap = argparse.ArgumentParser(); ap.add_argument('--driver', required=True); ap.add_argument('--start-sec', type=float, default=1.0)
    ap.add_argument('--ref', required=True); ap.add_argument('--out', required=True)
    ap.add_argument('--mp', default=os.environ.get('MP_MODELS')); ap.add_argument('--face', default=os.environ.get('FACE_MODELS'))
    ap.add_argument('--heldout', help='folder of held-out validation photos (scoring only)')
    ap.add_argument('runs', nargs='+'); a = ap.parse_args()
    an = Analyzer(a.mp, a.face)
    if a.heldout: print('held-out photos with a readable face:', an.set_heldout(sorted(glob.glob(a.heldout + '/*'))))
    runs = [r.split('=', 1) for r in a.runs]
    frames0 = read_frames(runs[0][1]); n = len(frames0)
    drv_frames = read_driver(a.driver, a.start_sec, n); drv = [an.frame(f) for f in drv_frames]
    ref = fit(cv2.imread(a.ref)); ra = an.frame(ref); ref_lab = torso_lab(ref, ra['mp'].get('body'))
    report, base = {'driver': a.driver, 'start_sec': a.start_sec, 'frames': n, 'reference': a.ref}, None
    for name, src in runs:
        fr = frames0 if base is None else read_frames(src)
        A = [an.frame(f) for f in fr[:n]]
        r = summarise(name, fr[:n], A, drv, ref_lab, base)
        if base is None: base = r
        else: r['checks'] = verdict(r, base)
        report[name] = r
        idn = r['identity']
        print(f"{name:18s} identity median {idn['median'] if idn['median'] is not None else float('nan'):.3f}  p10 {idn['p10'] if idn['p10'] is not None else float('nan'):.3f}  "
              f">=0.74 {idn['pass_074']}/{idn['n']}  flicker {r['flicker'] or 0:.2f}  expr-motion {r['expression_motion'] or 0:.3f}  "
              f"motion err {r['motion']['joint_error_torso_lengths'] or 0:.3f}  clothes dE {r['clothing']['deltaE_vs_photo_median'] or 0:.1f}")
        if 'identity_vs_heldout_photos' in r: print(f"      vs held-out photos: median {r['identity_vs_heldout_photos']['median']:.3f}")
        for k, v in r['identity_by_angle'].items(): print(f"      angle {k:24s} n {v['n']:2d}  median {v['median']:.3f}")
        for k, v in r['identity_by_driver_expression'].items(): print(f"      driver expr {k:18s} n {v['n']:2d}  median {v['median']:.3f}")
        for k, ok in (r.get('checks') or {}).items(): print(f"      {'PASS' if ok else 'FAIL'} {k}")
    json.dump(report, open(a.out, 'w'), indent=1, default=float)
