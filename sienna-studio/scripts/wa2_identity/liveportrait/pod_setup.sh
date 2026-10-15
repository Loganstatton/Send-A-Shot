#!/bin/bash
# Driver-animation pod, step 1 (no LivePortrait weights yet): ComfyUI-LivePortraitKJ code (MIT) pinned, MediaPipe
# cropper dependencies, RealVisXL base checkpoint, and a LICENSE CHECK of the weight repo. InsightFace is never
# installed or downloaded (its models are non-commercial). Step 2 (pod_weights.sh) runs only after the license is read.
C=/workspace/runpod-slim/ComfyUI; PY=$C/.venv-cu128/bin/python
KJ_REF=4d9dc6205b793ffd0fb319816136d9b8c0dbfdff
(bash /workspace/dl_ckpt.sh > /workspace/ckpt.log 2>&1 &)
cd $C/custom_nodes && rm -rf ComfyUI-LivePortraitKJ && git clone -q https://github.com/kijai/ComfyUI-LivePortraitKJ && cd ComfyUI-LivePortraitKJ && git checkout -q $KJ_REF && echo "KJ at $(git rev-parse HEAD)"
head -3 LICENSE
$PY -c "import numpy; print('numpy before', numpy.__version__)"
$PY -m pip install -q "numpy<2" "mediapipe==0.10.14" pykalman kornia onnxruntime scipy 2>&1 | grep -v -i "warning\|notice" | tail -3
$PY -c "import numpy, mediapipe; print('numpy', numpy.__version__, 'mediapipe', mediapipe.__version__)"
$PY -c "import insightface" 2>/dev/null && echo "insightface PACKAGE present (code only, MIT; no models will be fetched)" || echo "no insightface package"
ls -d $C/models/insightface ~/.insightface 2>/dev/null && echo "WARNING insightface model dir exists" || echo "no insightface models on disk"
$PY - <<'P'
from huggingface_hub import HfApi
api = HfApi()
for rid in ('Kijai/LivePortrait_safetensors', 'KlingTeam/LivePortrait'):
    try:
        i = api.model_info(rid, files_metadata=False)
        lic = (i.card_data or {}).get('license') if i.card_data else None
        tags = [t for t in (i.tags or []) if t.startswith('license')]
        print('LICENSE', rid, lic, tags)
        print('FILES', rid, sorted(s.rfilename for s in i.siblings))
    except Exception as e:
        print('LICENSE', rid, 'ERROR', e)
P
echo SETUP1_DONE
