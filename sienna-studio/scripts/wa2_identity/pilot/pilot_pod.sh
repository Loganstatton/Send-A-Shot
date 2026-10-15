#!/bin/bash
# WA2 identity-LoRA pilot: runs ON the training pod. Not run yet.
# Durable outputs go to the NEW pilot network volume mounted at /workspace (never the production 'sienna-studio' volume):
#   /workspace/wa2_pilot/dataset/   frozen dataset tgz + verified extraction
#   /workspace/wa2_pilot/ckpt/      step-100/200/300 LoRAs (DiffSynth + ComfyUI keys) + SHA256SUMS, written as they are saved
#   /workspace/wa2_pilot/logs/      train/data_process logs, loss + step time, RAM/VRAM, stage markers
# Large, re-downloadable files (models ~70 GB, latent cache) stay on the pod's container disk (/root), which is discarded.
set -uo pipefail
V=/workspace/wa2_pilot; L=$V/logs; C=/root/work; M=/root/m; mkdir -p $V/dataset $V/ckpt $L $C $M
exec > >(tee -a $L/pod.log) 2>&1
log() { echo "STAGE $(date -u +%H:%M:%S) $*"; }
HARD_MIN=${HARD_MIN:-240}   # on-pod hard deadline: the pod removes itself after this many minutes, even if this session is idle
( sleep $((HARD_MIN * 60)); echo "HARD DEADLINE"; sync; runpodctl remove pod "$RUNPOD_POD_ID" ) &
PY=/workspace/runpod-slim/ComfyUI/.venv-cu128/bin/python; [ -x $PY ] || PY=python3
log env; nvidia-smi --query-gpu=name,memory.total --format=csv,noheader; free -g | sed -n 2p; df -h /workspace /root | tail -2
# dataset: verify the frozen bundle before use
cd $V/dataset && sha256sum -c dataset.tgz.sha256 || { log DATASET_CHECKSUM_FAIL; exit 2; }
tar -xzf dataset.tgz && (cd wa2_dataset_frozen_v* && sha256sum -c --quiet SHA256SUMS) || { log DATASET_FILES_FAIL; exit 2; }
FROZEN=$(ls -d $V/dataset/wa2_dataset_frozen_v* | tail -1)
log deps; (cd /root && git clone -q https://github.com/modelscope/DiffSynth-Studio dss && cd dss && git fetch -q --depth 1 origin 4a2d8af77849b20702b2639338f6fe4512f2f93e && git checkout -q FETCH_HEAD)
cd /root/dss && $PY -m pip install -q --no-deps -e . && $PY -m pip install -q "imageio[ffmpeg]" ftfy modelscope peft accelerate pandas psutil "huggingface_hub[hf_xet]" opencv-python-headless
(HF_DL_DIR=$M HF_XET_HIGH_PERFORMANCE=1 $PY /workspace/wa2_identity/smoke/hf_dl.py > $L/dl.log 2>&1 &)   # models -> container disk, never the volume
log build_dataset; $PY /workspace/wa2_identity/make_pilot.py $FROZEN $C/manifest.json ${INCLUDE:+--include $INCLUDE} | tee $L/composition.json
$PY /workspace/wa2_identity/build_metadata.py $C/manifest.json $C/data | tee -a $L/composition.json
export WA2_DATASET_BASE=$C/data
until grep -q ALL_DOWNLOADS_DONE $L/dl.log; do sleep 10; grep -q MISSING $L/dl.log && { log DOWNLOAD_MISSING; exit 4; }; done
T5=$(find $M -name "models_t5_umt5-xxl-enc-bf16.pth" | head -1); CLIP=$(find $M -name "models_clip_open-clip*.pth" | head -1)
VAE=$(find $M -name Wan2.1_VAE.pth | head -1); TOK=$(dirname $(find $M -path "*umt5-xxl/*" -name "*.json" | head -1)); DIT=$(find $M -name wan_animate_2_bf16.safetensors | head -1)
COMMON=(--data_file_keys "video,animate2_reference_image,animate2_reference_video" --height 768 --width 528 --num_frames 9 --lora_base_model dit
  --lora_target_modules "self_attn.q,self_attn.k,self_attn.v" --lora_rank 32 --extra_inputs "animate2_prompt_ref,animate2_reference_image,animate2_reference_video,face_box,loss_mask"
  --use_gradient_checkpointing --remove_prefix_in_ckpt "pipe.dit." --dataset_num_workers 0)
ACC="$PY -m accelerate.commands.launch --num_processes 1 --mixed_precision no"
log data_process; $ACC examples/wanvideo/model_training/train.py --dataset_base_path $C/data --dataset_metadata_path $C/data/metadata.json --dataset_repeat 1 \
  --model_paths "[\"$T5\",\"$CLIP\",\"$VAE\"]" --tokenizer_path "$TOK" --learning_rate 1e-4 --num_epochs 1 --output_path $C/cache "${COMMON[@]}" --task "sft:data_process" > $L/data_process.log 2>&1 || { log DP_FAIL; exit 5; }
# checkpoint mirror: every saved LoRA is converted, checksummed and copied to the volume the moment it appears
( while true; do for f in $C/out/*.safetensors; do [ -f "$f" ] || continue; b=$(basename "$f"); [ -f "$V/ckpt/$b" ] && continue; sleep 20
    cp "$f" $V/ckpt/$b.tmp && mv $V/ckpt/$b.tmp $V/ckpt/$b && $PY /workspace/wa2_identity/convert_lora.py $V/ckpt/$b $V/ckpt/comfy_$b >> $L/convert.log 2>&1
    (cd $V/ckpt && sha256sum *.safetensors > SHA256SUMS); sync; echo "CKPT_SAVED $b"; done; sleep 15; done ) &
( while true; do echo "$(date -u +%T) $(free -g | awk 'NR==2{print $3}') $(nvidia-smi --query-gpu=memory.used --format=csv,noheader)" >> $L/mem.log; sleep 10; done ) &
log train; $ACC /workspace/wa2_identity/train_identity.py --dataset_base_path $C/cache --dataset_repeat 1 --model_paths "[\"$DIT\"]" \
  --learning_rate 1e-4 --num_epochs 3 --save_steps 100 --output_path $C/out "${COMMON[@]}" --task "sft:train" > $L/train.log 2>&1; echo "train exit $?"
sleep 60; ls -la $V/ckpt; cat $V/ckpt/SHA256SUMS; log train_done
