#!/bin/bash
# One-shot driver-animation pod: setup (pod_setup.sh) + license gate + official MIT weights (pod_weights.sh logic).
# Aborts before any weight download unless KlingTeam/LivePortrait declares license: mit. No InsightFace, no mirrors.
C=/workspace/runpod-slim/ComfyUI; PY=$C/.venv-cu128/bin/python
(bash /workspace/dl_ckpt.sh > /workspace/ckpt.log 2>&1 &)
cd $C/custom_nodes && rm -rf ComfyUI-LivePortraitKJ && git clone -q https://github.com/kijai/ComfyUI-LivePortraitKJ && cd ComfyUI-LivePortraitKJ && git checkout -q 4d9dc6205b793ffd0fb319816136d9b8c0dbfdff && echo "KJ at $(git rev-parse HEAD)"
$PY -m pip install -q "numpy<2" "mediapipe==0.10.14" pykalman kornia onnxruntime scipy "opencv-python==4.10.0.84" "opencv-python-headless==4.10.0.84" 2>&1 | grep -v -i "warning\|notice\|requires numpy" | tail -2
$PY -c "import cv2, numpy, mediapipe; print('cv2', cv2.__version__, 'numpy', numpy.__version__, 'mediapipe', mediapipe.__version__)"
$PY -c "import insightface" 2>/dev/null && echo "insightface PACKAGE present" || echo "no insightface package"
$PY - <<'P' || { echo LICENSE_GATE_FAILED; exit 3; }
import os, torch
from huggingface_hub import HfApi, snapshot_download
from safetensors.torch import save_file
i = HfApi().model_info('KlingTeam/LivePortrait'); lic = (i.card_data or {}).get('license') if i.card_data else None
print('LICENSE KlingTeam/LivePortrait', lic)
assert lic == 'mit', 'license is not MIT - stop'
src = snapshot_download('KlingTeam/LivePortrait', allow_patterns=['liveportrait/base_models/*', 'liveportrait/retargeting_models/*', 'liveportrait/landmark.onnx'], local_dir='/workspace/lp_official')
assert not os.path.exists('/workspace/lp_official/insightface'), 'insightface must not be downloaded'
D = '/workspace/runpod-slim/ComfyUI/models/liveportrait'; os.makedirs(D, exist_ok=True)
strip = lambda k: k[7:] if k.startswith('module.') else k
for s, d in {'base_models/appearance_feature_extractor.pth': 'appearance_feature_extractor', 'base_models/motion_extractor.pth': 'motion_extractor',
             'base_models/warping_module.pth': 'warping_module', 'base_models/spade_generator.pth': 'spade_generator',
             'retargeting_models/stitching_retargeting_module.pth': 'stitching_retargeting_module'}.items():
    sd = torch.load(f'/workspace/lp_official/liveportrait/{s}', map_location='cpu', weights_only=True)
    if all(torch.is_tensor(v) for v in sd.values()): sd = {strip(k): v for k, v in sd.items()}
    else: sd = {f'{k}_module.{strip(kk)}': vv for k, v in sd.items() if isinstance(v, dict) and k.startswith('retarget_') for kk, vv in v.items() if torch.is_tensor(vv)}
    save_file({k: v.contiguous() for k, v in sd.items()}, f'{D}/{d}.safetensors'); print('converted', d, len(sd))
import shutil; shutil.copy('/workspace/lp_official/liveportrait/landmark.onnx', f'{D}/landmark.onnx')
P
for i in $(seq 1 60); do grep -q "CKPT_OK\|CKPT_FAIL" /workspace/ckpt.log && break; sleep 3; done; tail -c 40 /workspace/ckpt.log
curl -s -o /dev/null -w 'reboot %{http_code}\n' -X POST --max-time 10 http://127.0.0.1:8188/api/manager/reboot || true
for i in $(seq 1 60); do sleep 3; curl -fsS --max-time 5 http://127.0.0.1:8188/object_info/LivePortraitProcess 2>/dev/null | grep -q LivePortraitProcess && { echo LP_NODES_OK; break; }; done
echo ALL_DONE
