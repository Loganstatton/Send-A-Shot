"""Close-framed evaluation inputs: the SAME dance clip and Sienna photo, cropped to head-and-shoulders so her face is
large enough (~160 px by the app face check in the 528x768 output) for reliable identity and expression measurement.
The crop follows the dancer's head (smoothed, like a camera operator), at the output aspect ratio.
Usage: make_closeup.py drive.mp4 start_sec photo.png out_dir   -> closeup_drive.mp4 (16 fps, 64 frames), closeup_photo.png
"""
import os, subprocess, sys
import numpy as np, cv2
sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'comfy_nodes', 'sienna_nodes'))
W, H, FPS, N, FACE_FRAC = 528, 768, 16, 64, 0.30   # YuNet box height / crop height
FF = os.environ.get('FFMPEG', '/home/user/Send-A-Shot/sienna-studio/node_modules/ffmpeg-static/ffmpeg')


def detector(face_dir):
    return cv2.FaceDetectorYN.create(os.path.join(face_dir, 'face_detection_yunet_2023mar.onnx'), '', (320, 320), 0.6)


def face(det, img):
    h, w = img.shape[:2]; det.setInputSize((w, h)); _, fs = det.detect(img)
    return None if fs is None else fs[np.argmax(fs[:, 2] * fs[:, 3])][:4]


def crop(img, cx, cy, ch):
    cw = ch * W / H; x0, y0 = cx - cw / 2, cy - 0.33 * ch          # face in the upper third
    m = np.float32([[W / cw, 0, -x0 * W / cw], [0, H / ch, -y0 * H / ch]])
    return cv2.warpAffine(img, m, (W, H), flags=cv2.INTER_CUBIC, borderMode=cv2.BORDER_REPLICATE)


def main(drive, start, photo, out, face_dir):
    det = detector(face_dir); cap = cv2.VideoCapture(drive); vfps = cap.get(cv2.CAP_PROP_FPS); allf = []
    while True:
        ok, f = cap.read()
        if not ok: break
        allf.append(f)
    fr = [allf[min(len(allf) - 1, int(round((start + i / FPS) * vfps)))] for i in range(N)]
    boxes = [face(det, f) for f in fr]; ok = [b is not None for b in boxes]
    if sum(ok) < N * 0.6: raise SystemExit(f'face found in only {sum(ok)}/{N} frames')
    t = np.arange(N); g = lambda v: np.interp(t, t[ok], np.array(v)[ok])
    cx = g([b[0] + b[2] / 2 if b is not None else 0 for b in boxes]); cy = g([b[1] + b[3] / 2 if b is not None else 0 for b in boxes])
    fh = g([b[3] if b is not None else 0 for b in boxes])
    sm = lambda v, s=2.0: cv2.GaussianBlur(v.reshape(1, -1).astype(np.float32), (0, 0), s, borderType=cv2.BORDER_REPLICATE).ravel()
    cx, cy, ch = sm(cx), sm(cy), sm(np.full(N, np.median(fh) / FACE_FRAC), 1)
    os.makedirs(out, exist_ok=True)
    p = subprocess.Popen([FF, '-loglevel', 'error', '-y', '-f', 'rawvideo', '-pix_fmt', 'bgr24', '-s', f'{W}x{H}', '-r', str(FPS), '-i', '-',
                          '-c:v', 'libx264', '-crf', '12', '-pix_fmt', 'yuv420p', f'{out}/closeup_drive.mp4'], stdin=subprocess.PIPE)
    for i, f in enumerate(fr): p.stdin.write(crop(f, cx[i], cy[i], ch[i]).tobytes())
    p.stdin.close(); p.wait()
    img = cv2.imread(photo); b = face(det, img)
    cv2.imwrite(f'{out}/closeup_photo.png', crop(img, b[0] + b[2] / 2, b[1] + b[3] / 2, b[3] / FACE_FRAC))
    print(f'face found {sum(ok)}/{N}; crop height {np.median(ch):.0f}px of source; expected output face ~{FACE_FRAC * H:.0f}px')


if __name__ == '__main__':
    main(sys.argv[1], float(sys.argv[2]), sys.argv[3], sys.argv[4], os.environ.get('FACE_MODELS', ''))
