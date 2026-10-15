#!/bin/bash
# WA2 training smoke test. Everything logs to /workspace/smoke.log; markers start with STAGE / SMOKE / CHECK.
set -x
PY=/workspace/runpod-slim/ComfyUI/.venv-cu128/bin/python; cd /workspace
log() { echo "STAGE $(date -u +%H:%M:%S) $*"; }
log env; nvidia-smi --query-gpu=name,memory.total,driver_version --format=csv,noheader; free -g | sed -n 2p; df -h /workspace | tail -1; nproc
$PY -c "import torch;print('torch',torch.__version__,torch.cuda.get_device_name(0));torch.zeros(1).cuda()" || { log CUDA_FAIL; exit 3; }
$PY -m pip install -q -U "huggingface_hub[hf_xet]" 2>&1 | tail -1
(HF_XET_HIGH_PERFORMANCE=1 $PY hf_dl.py > dl.log 2>&1 &)
log clone; git clone -q --depth 1 https://github.com/modelscope/DiffSynth-Studio dss && cd dss && (git cat-file -e 4a2d8af77849b20702b2639338f6fe4512f2f93e 2>/dev/null || (git fetch -q --depth 1 origin 4a2d8af77849b20702b2639338f6fe4512f2f93e && git checkout -q FETCH_HEAD)); git log -1 --format='%h %cd'
$PY -m pip install -q --no-deps -e . && $PY -m pip install -q "imageio[ffmpeg]" ftfy modelscope peft accelerate pandas psutil librosa 2>&1 | tail -2
$PY -c "import diffsynth, torch; print('diffsynth ok, torch', torch.__version__)"
log wait_small; until grep -q "DONE vae" /workspace/dl.log && grep -q "DONE t5" /workspace/dl.log && grep -q "DONE clip" /workspace/dl.log && [ $(grep -c "DONE tok" /workspace/dl.log) -ge 3 ]; do sleep 5; grep -q MISSING /workspace/dl.log && { log DOWNLOAD_MISSING; cat /workspace/dl.log; exit 4; }; done
M=/workspace/m; T5=$(ls $M/Wan-AI/Wan2.2-Animate-2-14B/**/models_t5*.pth $M/Wan-AI/Wan2.2-Animate-2-14B/*/*/models_t5*.pth 2>/dev/null | head -1); CLIP=$(find $M -name "models_clip_open-clip*.pth" | head -1); VAE=$(find $M -name Wan2.1_VAE.pth | head -1); TOK=$(dirname $(find $M -path "*umt5-xxl/*" -name "*.json" | head -1))
T5=$(find $M -name "models_t5_umt5-xxl-enc-bf16.pth" | head -1); echo "T5=$T5 CLIP=$CLIP VAE=$VAE TOK=$TOK"
COMMON=(--data_file_keys "video,animate2_reference_image,animate2_reference_video" --height 768 --width 528 --num_frames 9 --lora_base_model dit
  --lora_target_modules "self_attn.q,self_attn.k,self_attn.v" --lora_rank 32 --extra_inputs "animate2_prompt_ref,animate2_reference_image,animate2_reference_video,face_box"
  --use_gradient_checkpointing --remove_prefix_in_ckpt "pipe.dit." --dataset_num_workers 0)
ACC="$PY -m accelerate.commands.launch --num_processes 1 --mixed_precision no"
log data_process; $ACC examples/wanvideo/model_training/train.py --dataset_base_path /workspace/smoke/data --dataset_metadata_path /workspace/smoke/data/metadata.json \
  --dataset_repeat 1 --model_paths "[\"$T5\",\"$CLIP\",\"$VAE\"]" --tokenizer_path "$TOK" --learning_rate 1e-4 --num_epochs 1 --output_path /workspace/cache "${COMMON[@]}" --task "sft:data_process" > /workspace/dp.log 2>&1; echo "dp exit $?"; grep -vE "it/s\]|s/it\]" /workspace/dp.log | tail -15
ls -la /workspace/cache/0 2>/dev/null | head
log wait_dit; until grep -q "DONE dit" /workspace/dl.log; do sleep 5; done; grep DONE /workspace/dl.log
DIT=$(find $M -name wan_animate_2_bf16.safetensors | head -1)
log train; (while true; do free -g | sed -n 2p >> /workspace/ram.log; nvidia-smi --query-gpu=memory.used --format=csv,noheader >> /workspace/vram.log; sleep 3; done &) ; SMOKE=1 $ACC /workspace/wa2_identity/train_identity.py --dataset_base_path /workspace/cache --dataset_repeat 1 --model_paths "[\"$DIT\"]" \
  --learning_rate 1e-4 --num_epochs 1 --output_path /workspace/out "${COMMON[@]}" --task "sft:train" > /workspace/train.log 2>&1; echo "train exit $?"; grep -E "SMOKE|Error|Traceback" /workspace/train.log | tail -40; echo "peak RAM used (GB): $(awk '{print $3}' /workspace/ram.log | sort -n | tail -1) | peak VRAM: $(sort -n /workspace/vram.log | tail -1)"
ls -la /workspace/out; nvidia-smi --query-gpu=memory.used --format=csv,noheader; df -h /workspace | tail -1
L=$(ls /workspace/out/*.safetensors | head -1); log convert; $PY /workspace/wa2_identity/convert_lora.py "$L" /workspace/out/comfy_lora.safetensors
log wait_int8; until grep -q "DONE int8" /workspace/dl.log; do sleep 5; done
log comfy_check; $PY /workspace/comfy_check.py /workspace/out/comfy_lora.safetensors 2>&1 | grep -E "CHECK|Error|Traceback|error" | tail -30
log done; df -h /workspace | tail -1; du -sh /workspace/m /workspace/cache /workspace/out
