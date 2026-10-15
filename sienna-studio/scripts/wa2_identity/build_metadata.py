"""Build a DiffSynth Wan-Animate-2 training folder from approved (reference, driver, target) sets.

manifest.json: [{"id", "reference", "driver", "target", "face_box"?, "loss_mask"?, "clip"?: true,
                 "rotate"?: deg, "still"?: true, "copies"?: 1}]
  rotate    - in-plane rotation (degrees, counter-clockwise; measured head tilt changes by -deg) applied identically to
              driver, target and loss mask about the head centre. Used to break the one-way selfie tilt without
              mirroring (a mirror would flip her facial asymmetry). The reference is never rotated.
  still/copies - write the single-frame sample (default yes) this many times; clip=true adds the 9-frame pseudo-clip.
  loss_mask - optional head+hair mask of the target (pair_qa.head_mask). When present only that region is scored,
              which is required when the reference shows a different outfit/place (cross-outfit pairs).
Every sample gets the SAME text prompt (TRAIN_PROMPT): a per-sample prompt describing the pose or expression would let
the model read the answer from the text instead of from the driver. A differing manifest "prompt" is an error.
  reference - approved Sienna image, same outfit/scene as the target, different pose/expression
  driver    - a different person (stand-in) rendered from the target's own pose + face keypoints
  target    - approved Sienna image: ground truth for identity AND for the driver's pose/expression
Writes <out>/metadata.json with one single-frame sample per set, plus (clip=true) a 9-frame pseudo-clip where the
same smooth camera move is applied to driver and target, so every frame stays a real approved image of her.
"""
import json, os, shutil, subprocess, sys
import numpy as np, cv2

W, H = 528, 768             # the Copy Motion inference size (lib/video.ts videoSize for 832x1216 at 480p)
CLIP_FRAMES = 9             # 4n+1, as Wan requires
MOTION_TEXT = 'a woman performing the movement from the reference video naturally, background stationary'  # lib/server/video.ts MOTION2_TEXT
TRAIN_PROMPT = MOTION_TEXT  # constant for every sample (no per-sample hints)
FF = os.environ.get('FFMPEG', '/home/user/Send-A-Shot/sienna-studio/node_modules/ffmpeg-static/ffmpeg')


def fit(img, w=W, h=H):
    """Cover-resize and centre-crop to w x h (same as ComfyUI ImageScale 'area' + crop 'center')."""
    ih, iw = img.shape[:2]; s = max(w / iw, h / ih)
    r = cv2.resize(img, (int(round(iw * s)), int(round(ih * s))), interpolation=cv2.INTER_AREA)
    y0, x0 = (r.shape[0] - h) // 2, (r.shape[1] - w) // 2
    return r[y0:y0 + h, x0:x0 + w]


def camera_path(n=CLIP_FRAMES, zoom=1.08, pan=(0.03, -0.02)):
    """Smooth push-in with a slight pan: list of (scale, dx, dy) per frame, eased."""
    out = []
    for i in range(n):
        t = i / (n - 1); e = t * t * (3 - 2 * t)
        out.append((1 + (zoom - 1) * e, pan[0] * e, pan[1] * e))
    return out


def apply_camera(img, scale, dx, dy):
    h, w = img.shape[:2]
    m = np.float32([[scale, 0, (1 - scale) * w / 2 + dx * w], [0, scale, (1 - scale) * h / 2 + dy * h]])
    return cv2.warpAffine(img, m, (w, h), flags=cv2.INTER_CUBIC, borderMode=cv2.BORDER_REFLECT)


def write_clip(frames, path):
    p = subprocess.Popen([FF, '-loglevel', 'error', '-y', '-f', 'rawvideo', '-pix_fmt', 'bgr24', '-s', f'{W}x{H}', '-r', '16', '-i', '-',
                          '-c:v', 'libx264', '-crf', '12', '-pix_fmt', 'yuv420p', path], stdin=subprocess.PIPE)
    for f in frames:
        p.stdin.write(f.tobytes())
    p.stdin.close(); p.wait()
    if p.returncode:
        raise RuntimeError(f'ffmpeg failed for {path}')


def clip_box(box, scale, dx, dy):
    """Face box after the camera move (all in 0-1 coords)."""
    x0, y0, x1, y1 = box
    f = lambda x, d: (x - 0.5) * scale + 0.5 + d
    return [min(1, max(0, f(x0, dx))), min(1, max(0, f(y0, dy))), min(1, max(0, f(x1, dx))), min(1, max(0, f(y1, dy)))]


ROT_ZOOM = 1.12   # zoom while rotating so less of the frame is filled by reflected border


def rotate_about(img, deg, center, interp=cv2.INTER_CUBIC, border=cv2.BORDER_REFLECT):
    m = cv2.getRotationMatrix2D(center, deg, ROT_ZOOM)
    return cv2.warpAffine(img, m, (img.shape[1], img.shape[0]), flags=interp, borderMode=border, borderValue=0)


def rotate_mask(mask, deg, center):
    """Rotated loss mask, limited to pixels that came from inside the original frame: the reflected border is a
    mirror image, so it must never be scored (that would teach a mirrored face/hair)."""
    rot = rotate_about(mask, deg, center, cv2.INTER_NEAREST, cv2.BORDER_CONSTANT)
    valid = rotate_about(np.full_like(mask, 255), deg, center, cv2.INTER_NEAREST, cv2.BORDER_CONSTANT)
    valid = cv2.erode(valid, np.ones((9, 9), np.uint8))
    return np.where((rot > 127) & (valid > 127), 255, 0).astype(np.uint8)


def head_center(mask):
    ys, xs = np.nonzero(mask)
    return (float(xs.mean()), float(ys.mean())) if len(xs) else (mask.shape[1] / 2, mask.shape[0] / 2)


def build(manifest, out):
    for d in ('refs', 'drivers', 'targets', 'clips', 'masks'):
        os.makedirs(f'{out}/{d}', exist_ok=True)
    meta = []
    for s in manifest:
        sid = s['id']; box = [float(v) for v in s['face_box'].split(',')] if s.get('face_box') else None
        ref, drv, tgt = (fit(cv2.imread(s[k])) for k in ('reference', 'driver', 'target'))
        for k, im in (('refs', ref), ('drivers', drv), ('targets', tgt)):
            cv2.imwrite(f'{out}/{k}/{sid}.png', im)
        if s.get('prompt') not in (None, TRAIN_PROMPT):
            raise ValueError(f'{sid}: per-sample prompts are not allowed (they can leak pose/expression); omit "prompt"')
        mask = None
        if s.get('loss_mask'):
            mask = fit(cv2.imread(s['loss_mask'], cv2.IMREAD_GRAYSCALE)); mask = np.where(mask > 127, 255, 0).astype(np.uint8)
            if not mask.any(): raise ValueError(f'{sid}: empty loss mask')
        if s.get('rotate'):
            if box or mask is None: raise ValueError(f'{sid}: rotate needs a loss_mask and no face_box')
            c = head_center(mask)
            drv, tgt = rotate_about(drv, s['rotate'], c), rotate_about(tgt, s['rotate'], c)
            mask = rotate_mask(mask, s['rotate'], c)
            if not mask.any(): raise ValueError(f'{sid}: rotation left no scorable head pixels')
            for k, im in (('drivers', drv), ('targets', tgt)):
                cv2.imwrite(f'{out}/{k}/{sid}.png', im)
        if mask is not None:
            cv2.imwrite(f'{out}/masks/{sid}.png', mask)
        base = {'animate2_reference_image': f'refs/{sid}.png', 'prompt': TRAIN_PROMPT, 'animate2_prompt_ref': MOTION_TEXT}
        still = {**base, 'video': f'targets/{sid}.png', 'animate2_reference_video': f'drivers/{sid}.png',
                 'face_box': ','.join(f'{v:.4f}' for v in box) if box else '', 'loss_mask': f'masks/{sid}.png' if mask is not None else ''}
        if s.get('still', True):
            meta.extend(dict(still) for _ in range(int(s.get('copies', 1))))
        if s.get('clip'):
            path = camera_path()
            write_clip([apply_camera(tgt, *p) for p in path], f'{out}/clips/{sid}_target.mp4')
            write_clip([apply_camera(drv, *p) for p in path], f'{out}/clips/{sid}_driver.mp4')
            # the face moves a little during the clip; weight the union of its boxes
            boxes = [clip_box(box, *p) for p in path] if box else None
            ub = [min(b[0] for b in boxes), min(b[1] for b in boxes), max(b[2] for b in boxes), max(b[3] for b in boxes)] if boxes else None
            cm = ''
            if mask is not None:   # union of the moved masks: the head moves a little during the clip
                u = np.max([apply_camera(cv2.merge([mask] * 3), *p)[..., 0] for p in path], axis=0)
                cv2.imwrite(f'{out}/masks/{sid}_clip.png', u); cm = f'masks/{sid}_clip.png'
            meta.append({**base, 'video': f'clips/{sid}_target.mp4', 'animate2_reference_video': f'clips/{sid}_driver.mp4',
                         'face_box': ','.join(f'{v:.4f}' for v in ub) if ub else '', 'loss_mask': cm})
    json.dump(meta, open(f'{out}/metadata.json', 'w'), indent=1, ensure_ascii=False)
    return meta


if __name__ == '__main__':
    m = build(json.load(open(sys.argv[1])), sys.argv[2])
    print(f'{len(m)} samples -> {sys.argv[2]}/metadata.json')
