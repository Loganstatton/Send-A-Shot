#!/bin/bash
# Driver-animation pod, step 2. Weights come from the OFFICIAL KlingTeam/LivePortrait repo (license: MIT), human
# models only: liveportrait/base_models, liveportrait/retargeting_models, liveportrait/landmark.onnx. The repo's
# insightface/ folder (non-commercial) and animal models are NOT downloaded. Kijai/LivePortrait_safetensors is not
# used because it declares no license. The .pth state dicts are converted to the .safetensors names the
# ComfyUI-LivePortraitKJ loader expects (same tensors). Then ComfyUI is restarted and the nodes are checked.
C=/workspace/runpod-slim/ComfyUI; PY=$C/.venv-cu128/bin/python
$PY -m pip install -q "opencv-python==4.10.0.84" "opencv-python-headless==4.10.0.84" 2>&1 | grep -v -i "warning\|notice" | tail -2
$PY -c "import cv2, numpy, mediapipe; print('cv2', cv2.__version__, 'numpy', numpy.__version__, 'mediapipe', mediapipe.__version__)"
$PY - <<'P'
import os, torch
from huggingface_hub import snapshot_download
from safetensors.torch import save_file
src = snapshot_download('KlingTeam/LivePortrait', allow_patterns=['liveportrait/base_models/*', 'liveportrait/retargeting_models/*', 'liveportrait/landmark.onnx'],
                        local_dir='/workspace/lp_official')
assert not os.path.exists('/workspace/lp_official/insightface'), 'insightface must not be downloaded'
D = '/workspace/runpod-slim/ComfyUI/models/liveportrait'; os.makedirs(D, exist_ok=True)
names = {'base_models/appearance_feature_extractor.pth': 'appearance_feature_extractor.safetensors',
         'base_models/motion_extractor.pth': 'motion_extractor.safetensors', 'base_models/warping_module.pth': 'warping_module.safetensors',
         'base_models/spade_generator.pth': 'spade_generator.safetensors',
         'retargeting_models/stitching_retargeting_module.pth': 'stitching_retargeting_module.safetensors'}
for s, d in names.items():
    sd = torch.load(f'/workspace/lp_official/liveportrait/{s}', map_location='cpu', weights_only=True)
    strip = lambda k: k[7:] if k.startswith('module.') else k          # official loader drops DDP 'module.' prefixes
    if all(torch.is_tensor(v) for v in sd.values()):
        sd = {strip(k): v for k, v in sd.items()}
    else:   # retargeting: {'retarget_shoulder': sd, ...} -> flat 'retarget_shoulder_module.<key>' as the KJ loader expects
        sd = {f'{k}_module.{strip(kk)}': vv for k, v in sd.items() for kk, vv in v.items()}
    save_file({k: v.contiguous() for k, v in sd.items()}, f'{D}/{d}'); print('converted', d, len(sd))
import shutil; shutil.copy('/workspace/lp_official/liveportrait/landmark.onnx', f'{D}/landmark.onnx')
P
ls -la $C/models/liveportrait
curl -s -o /dev/null -w 'reboot %{http_code}\n' -X POST --max-time 10 http://127.0.0.1:8188/api/manager/reboot || true
for i in $(seq 1 60); do sleep 3; curl -fsS --max-time 5 http://127.0.0.1:8188/object_info/LivePortraitProcess 2>/dev/null | grep -q LivePortraitProcess && { echo LP_NODES_OK; break; }; done
curl -fsS --max-time 5 http://127.0.0.1:8188/object_info/LivePortraitLoadMediaPipeCropper | grep -q MediaPipe && echo MP_CROPPER_OK
tail -3 /workspace/ckpt.log
echo WEIGHTS_DONE
