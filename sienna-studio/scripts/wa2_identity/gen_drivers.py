"""Drivers for generated Sienna targets + DWPose keypoints of both (for the keypoint-match check).
Usage: gen_drivers.py <comfy_url> <poc_out_dir>   (after gen_poc.py; reads <set>/records.json)"""
import json, os, sys, time, uuid
HERE = os.path.dirname(os.path.abspath(__file__)); sys.path.insert(0, HERE)
from gen_poc import http, comfy_run
from driver_graph import driver_graph


def upload(C, path, name):
    bd = uuid.uuid4().hex
    body = (f'--{bd}\r\nContent-Disposition: form-data; name="image"; filename="{name}"\r\nContent-Type: image/png\r\n\r\n').encode() + open(path, 'rb').read() \
        + f'\r\n--{bd}\r\nContent-Disposition: form-data; name="overwrite"\r\n\r\ntrue\r\n--{bd}--\r\n'.encode()
    return http(C + '/upload/image', body, ctype=f'multipart/form-data; boundary={bd}')


def pose_only(img_name):
    return {'img': {'class_type': 'LoadImage', 'inputs': {'image': img_name}},
            'dw': {'class_type': 'DWPreprocessor', 'inputs': {'image': ['img', 0], 'detect_hand': 'enable', 'detect_body': 'enable', 'detect_face': 'enable', 'resolution': 1024,
                                                             'bbox_detector': 'yolox_l.onnx', 'pose_estimator': 'dw-ll_ucoco_384_bs5.torchscript.pt', 'scale_stick_for_xinsr_cn': 'disable'}},
            'pv': {'class_type': 'PreviewImage', 'inputs': {'images': ['dw', 0]}}}


def main(C, OUT, images_dir):
    for sid in sorted(os.listdir(OUT)):
        rp = f'{OUT}/{sid}/records.json'
        if not os.path.exists(rp): continue
        recs = json.load(open(rp))
        for i, r in enumerate(recs):
            if not r.get('file'): continue
            tgt = f'{OUT}/{sid}/{i:02d}_sienna.png'
            if not os.path.exists(tgt):
                open(tgt, 'wb').write(open(f'{images_dir}/{r["file"]}', 'rb').read())
            name = f'poc_{sid}_{i:02d}.png'; upload(C, tgt, name)
            person, g = driver_graph(name, 9100 + i * 7 + len(sid))
            out = comfy_run(C, g)
            im = out['sv']['images'][0]
            open(f'{OUT}/{sid}/{i:02d}_driver.png', 'wb').write(http(f"{C}/view?filename={im['filename']}&subfolder={im['subfolder']}&type=output"))
            r['driver_person'] = person; r['target_pose'] = out.get('dw', {}).get('openpose_json')
            dname = f'poc_{sid}_{i:02d}_driver.png'; upload(C, f'{OUT}/{sid}/{i:02d}_driver.png', dname)
            r['driver_pose'] = comfy_run(C, pose_only(dname)).get('dw', {}).get('openpose_json')
            print(sid, i, 'driver ok', person, flush=True)
        json.dump(recs, open(rp, 'w'), indent=1)
    print('DRIVERS_DONE')


if __name__ == '__main__':
    main(*sys.argv[1:4])
