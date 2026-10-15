#!/bin/bash
# WA2 identity-LoRA pilot: runs ON the training pod (started by pilot_guard.py create-pod). Not run yet.
# Required env: HARD_MIN (minutes, from pilot_guard: the budget left under the absolute cap). Optional: INCLUDE (approved
# review pairs, e.g. R1-17,P3,P12,P41), FROZEN_TGZ (dataset bundle name).
#
# Where things are written:
#   /root/m, /root/work            models (~70 GB) and latent cache: container disk, discarded at termination (re-downloadable)
#   /workspace/wa2_pull/           staging area served by the pod's JupyterLab; this session pulls every new checkpoint from
#                                  here and verifies its SHA-256 (pull_ckpts.py), then sends you a copy
#   /pilotvol/wa2_pilot/           ONLY if the owner approved a pilot network volume (mounted at /pilotvol, never /workspace,
#                                  never the production 'sienna-studio' volume): dataset, checkpoints, logs, eval outputs
# Gates before any spend-heavy step: on-pod deadline armed, dataset checksums, and a 100 MB transfer test the puller must
# confirm (gate.ok). If the transfer test fails, the pod stops before downloading models or training.
set -uo pipefail
: "${HARD_MIN:?HARD_MIN (minutes) from pilot_guard.py is required}"
# paths are overridable only so tests can run this script locally with a fake runpodctl (tests/test_wa2_identity.py)
P=${PULL_DIR:-/workspace/wa2_pull}; mkdir -p $P/ckpt $P/logs; L=$P/logs
VMNT=${VOL_MOUNT:-/pilotvol}; VOLD=""; [ -d $VMNT ] && { VOLD=$VMNT/wa2_pilot; mkdir -p $VOLD/ckpt $VOLD/logs $VOLD/dataset; }
R=${WORK_ROOT:-/root}; C=$R/work; M=$R/m; mkdir -p $C $M
UP=${UPLOAD_DIR:-/workspace/wa2_upload}
exec > >(tee -a $L/pod.log) 2>&1
log() { echo "STAGE $(date -u +%H:%M:%S) $*"; [ -n "$VOLD" ] && cp $L/*.log $VOLD/logs/ 2>/dev/null; true; }
# 1. absolute deadline: the pod deletes itself even if the controlling session is gone
command -v runpodctl >/dev/null && [ -n "${RUNPOD_API_KEY:-}" ] && [ -n "${RUNPOD_POD_ID:-}" ] || { log NO_SELF_DELETE_ABORT; exit 9; }
DEADLINE_S=${DEADLINE_SECONDS:-$((HARD_MIN * 60))}
( sleep $DEADLINE_S; log HARD_DEADLINE; sync; runpodctl remove pod "$RUNPOD_POD_ID" ) &
# any failed step removes the pod at once (no idle billing until the deadline); a normal finish leaves it up for eval
trap 'rc=$?; if [ $rc -ne 0 ]; then log "FAILED rc=$rc - removing pod"; sync; runpodctl remove pod "$RUNPOD_POD_ID"; fi' EXIT
log "deadline armed: ${DEADLINE_S}s"; nvidia-smi --query-gpu=name,memory.total --format=csv,noheader 2>/dev/null; free -g | sed -n 2p; df -h $P $R ${VOLD:+$VMNT} 2>/dev/null | tail -3
PY=/workspace/runpod-slim/ComfyUI/.venv-cu128/bin/python; [ -x $PY ] || PY=python3
# 2. dataset bundle (uploaded next to this script) must match its checksum
cd $UP && sha256sum -c dataset.tgz.sha256 || { log DATASET_CHECKSUM_FAIL; exit 2; }
tar -xzf dataset.tgz -C $C && (cd $C/wa2_dataset_frozen_v* && sha256sum -c --quiet SHA256SUMS) || { log DATASET_FILES_FAIL; exit 2; }
[ -n "$VOLD" ] && cp dataset.tgz dataset.tgz.sha256 $VOLD/dataset/
FROZEN=$(ls -d $C/wa2_dataset_frozen_v* | tail -1)
# 3. transfer gate: 100 MB test file must be pulled and verified by the session before we spend on downloads/training
head -c ${GATE_BYTES:-100000000} /dev/urandom > $P/gate.bin && (cd $P && sha256sum gate.bin > gate.sha256); log transfer_gate_waiting
for i in $(seq 1 ${GATE_POLLS:-60}); do [ -f $P/gate.ok ] && break; sleep ${GATE_SLEEP:-10}; done
[ -f $P/gate.ok ] || { log TRANSFER_GATE_FAIL; exit 3; }
rm -f $P/gate.bin; log transfer_gate_ok
[ -n "${STOP_AFTER_GATE:-}" ] && { log STOP_AFTER_GATE; exit 0; }   # test hook: everything below needs a GPU
# 4. trainer + models (models on container disk only)
log deps; (cd /root && git clone -q https://github.com/modelscope/DiffSynth-Studio dss && cd dss && git fetch -q --depth 1 origin 4a2d8af77849b20702b2639338f6fe4512f2f93e && git checkout -q FETCH_HEAD)
cd /root/dss && $PY -m pip install -q --no-deps -e . && $PY -m pip install -q "imageio[ffmpeg]" ftfy modelscope peft accelerate pandas psutil "huggingface_hub[hf_xet]" opencv-python-headless
(HF_DL_DIR=$M HF_XET_HIGH_PERFORMANCE=1 $PY /workspace/wa2_identity/smoke/hf_dl.py > $L/dl.log 2>&1 &)
log build_dataset; $PY /workspace/wa2_identity/make_pilot.py $FROZEN $C/manifest.json ${INCLUDE:+--include $INCLUDE} | tee $L/composition.log
$PY /workspace/wa2_identity/build_metadata.py $C/manifest.json $C/data | tee -a $L/composition.log
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
# 5. checkpoint publisher: each saved LoRA -> staging (+ volume), ComfyUI-key copy, SHA256SUMS, as soon as it is complete
( while true; do for f in $C/out/*.safetensors; do [ -f "$f" ] || continue; b=$(basename "$f"); [ -f "$P/ckpt/$b" ] && continue
    s1=$(stat -c %s "$f"); sleep 20; [ "$s1" = "$(stat -c %s "$f")" ] || continue          # wait until the file stops growing
    cp "$f" $P/ckpt/$b.tmp && mv $P/ckpt/$b.tmp $P/ckpt/$b && $PY /workspace/wa2_identity/convert_lora.py $P/ckpt/$b $P/ckpt/comfy_$b >> $L/convert.log 2>&1
    (cd $P/ckpt && sha256sum *.safetensors > SHA256SUMS)
    [ -n "$VOLD" ] && cp $P/ckpt/$b $P/ckpt/comfy_$b $P/ckpt/SHA256SUMS $VOLD/ckpt/ && (cd $VOLD/ckpt && sha256sum -c --quiet SHA256SUMS)
    sync; log "CKPT_PUBLISHED $b"; done; sleep 15; done ) &
( while true; do echo "$(date -u +%T) $(free -g | awk 'NR==2{print $3}') $(nvidia-smi --query-gpu=memory.used --format=csv,noheader)" >> $L/mem.log; sleep 10; done ) &
log train; $ACC /workspace/wa2_identity/train_identity.py --dataset_base_path $C/cache --dataset_repeat 1 --model_paths "[\"$DIT\"]" \
  --learning_rate 1e-4 --num_epochs 3 --save_steps 100 --output_path $C/out "${COMMON[@]}" --task "sft:train" > $L/train.log 2>&1; echo "train exit $?"
sleep 90; ls -la $P/ckpt; cat $P/ckpt/SHA256SUMS; log train_done
# evaluation renders are queued from the session through ComfyUI on this same pod (eval_graphs.py); the pod stays up for them
