"""Comparison media for the pilot report (CPU, local).
  side_by_side: labelled columns (driver | no-LoRA | face-restored | LoRA ...) as one 16 fps mp4
  face_strip:   the same frames' faces from every column in a grid, at the largest head turns and evenly spaced frames
Usage: make_media.py video <out.mp4> <label=src> ...      src = mp4 or folder of frames
       make_media.py faces <out.jpg> <n> <label=src> ...
"""
import os, subprocess, sys
import numpy as np, cv2
HERE = os.path.dirname(os.path.abspath(__file__)); sys.path.insert(0, os.path.dirname(HERE))
from eval_pilot import read_frames, fit
FF = os.environ.get('FFMPEG', '/home/user/Send-A-Shot/sienna-studio/node_modules/ffmpeg-static/ffmpeg')
SP = '/tmp/claude-0/-home-user-Send-A-Shot/5ab8d7bf-5d0f-550f-a69c-62a6985b93f2/scratchpad'
CW, CH, BAR = 352, 512, 34


def load(src):
    if src.startswith('driver:'):
        from eval_pilot import read_driver
        path, start = src[7:].rsplit('@', 1)
        return read_driver(path, float(start), 64)
    return read_frames(src)


def label(img, text):
    out = np.full((CH + BAR, CW, 3), 255, np.uint8); out[BAR:] = cv2.resize(img, (CW, CH), interpolation=cv2.INTER_AREA)
    cv2.putText(out, text, (8, 24), cv2.FONT_HERSHEY_SIMPLEX, 0.62, (20, 20, 20), 2, cv2.LINE_AA); return out


def video(out, cols):
    n = min(len(f) for _, f in cols); h, w = CH + BAR, CW * len(cols)
    p = subprocess.Popen([FF, '-loglevel', 'error', '-y', '-f', 'rawvideo', '-pix_fmt', 'bgr24', '-s', f'{w}x{h}', '-r', '16', '-i', '-',
                          '-c:v', 'libx264', '-crf', '18', '-pix_fmt', 'yuv420p', '-movflags', '+faststart', out], stdin=subprocess.PIPE)
    for i in range(n):
        p.stdin.write(np.hstack([label(f[i], l) for l, f in cols]).tobytes())
    p.stdin.close(); p.wait()
    if p.returncode: raise RuntimeError('ffmpeg failed')
    return n


def faces(out, cols, n_pick=8):
    det = cv2.FaceDetectorYN.create(f'{SP}/facemodels/face_detection_yunet_2023mar.onnx', '', (320, 320), 0.6)
    def box(img):
        det.setInputSize((img.shape[1], img.shape[0])); _, fs = det.detect(img)
        return None if fs is None else fs[np.argmax(fs[:, 2] * fs[:, 3])]
    n = min(len(f) for _, f in cols); ref = cols[1][1]           # frame choice from the no-LoRA column
    turn = []
    for i in range(n):
        b = box(ref[i])
        if b is None: turn.append((-1, i)); continue
        le, re_, nose = b[4:6], b[6:8], b[8:10]                   # eye-to-nose asymmetry = head turn
        turn.append((abs(np.linalg.norm(nose - le) - np.linalg.norm(nose - re_)) / max(b[2], 1), i))
    pick = sorted({i for _, i in sorted(turn, reverse=True)[:n_pick // 2]} | set(np.linspace(0, n - 1, n_pick // 2).astype(int).tolist()))
    S = 180; rows = []
    for l, fr in cols:
        cells = [np.full((S, 170, 3), 255, np.uint8)]
        cv2.putText(cells[0], l[:14], (6, S // 2), cv2.FONT_HERSHEY_SIMPLEX, 0.5, (0, 0, 0), 1, cv2.LINE_AA)
        for i in pick:
            bb = box(fr[i])
            if bb is None: bb = box(ref[i])                      # no face found: same place as the no-LoRA face
            if bb is None: cells.append(np.full((S, S, 3), 200, np.uint8)); continue
            x, y, w, h = bb[:4]; cx, cy, s = x + w / 2, y + h / 2, max(w, h) * 1.6
            pad = cv2.copyMakeBorder(fr[i], 300, 300, 300, 300, cv2.BORDER_REFLECT)
            c = pad[int(cy - s / 2) + 300:int(cy + s / 2) + 300, int(cx - s / 2) + 300:int(cx + s / 2) + 300]
            cells.append(cv2.resize(c, (S, S)))
        rows.append(np.hstack(cells))
    head = np.full((26, rows[0].shape[1], 3), 255, np.uint8)
    for k, i in enumerate(pick):
        cv2.putText(head, f'frame {i}', (170 + k * S + 40, 18), cv2.FONT_HERSHEY_SIMPLEX, 0.45, (0, 0, 0), 1, cv2.LINE_AA)
    cv2.imwrite(out, np.vstack([head] + rows), [cv2.IMWRITE_JPEG_QUALITY, 90]); return pick


if __name__ == '__main__':
    kind, out = sys.argv[1], sys.argv[2]
    if kind == 'video':
        cols = [(a.split('=', 1)[0], load(a.split('=', 1)[1])) for a in sys.argv[3:]]; print('frames', video(out, cols))
    else:
        n = int(sys.argv[3]); cols = [(a.split('=', 1)[0], load(a.split('=', 1)[1])) for a in sys.argv[4:]]; print('picked', faces(out, cols, n))
