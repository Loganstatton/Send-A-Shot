#!/bin/bash
# Sienna identity LoRA on Wan2.2-Animate-2-14B (official bf16 weights), DiffSynth-Studio, two stages:
#   1) data_process: VAE/T5/CLIP encode every sample once (text encoder never loads during training)
#   2) train: LoRA on the DiT only, identity loss (face_loss.py) via train_identity.py
# Run inside a DiffSynth-Studio checkout. DATA=prepared folder from build_metadata.py. 48 GB GPU recommended;
# on a 24 GB card add: --fp8_models "Wan-AI/Wan2.2-Animate-2-14B:wan_animate_2/wan_animate_2_bf16.safetensors" --enable_model_cpu_offload
set -euo pipefail
DATA=${DATA:?prepared dataset folder}; OUT=${OUT:-./models/train/sienna_wa2_identity}; STEPS_EPOCHS=${EPOCHS:-12}
HERE=$(cd "$(dirname "$0")" && pwd)
export WA2_DATASET_BASE="$(cd "$DATA" && pwd)"   # loss_mask paths in metadata are relative to the dataset folder
COMMON=(--data_file_keys "video,animate2_reference_image,animate2_reference_video" --height 768 --width 528 --num_frames 9
  --lora_base_model dit --lora_target_modules "self_attn.q,self_attn.k,self_attn.v" --lora_rank 32
  --extra_inputs "animate2_prompt_ref,animate2_reference_image,animate2_reference_video,face_box,loss_mask" --use_gradient_checkpointing
  --remove_prefix_in_ckpt "pipe.dit.")
accelerate launch examples/wanvideo/model_training/train.py --dataset_base_path "$DATA" --dataset_metadata_path "$DATA/metadata.json" \
  --dataset_repeat 1 --model_id_with_origin_paths "Wan-AI/Wan2.2-Animate-2-14B:videomodel/Wan-AI/models_t5_umt5-xxl-enc-bf16.pth,Wan-AI/Wan2.2-Animate-2-14B:videomodel/Wan-AI/models_clip_open-clip-xlm-roberta-large-vit-huge-14.pth,Wan-AI/Wan2.1-T2V-14B:Wan2.1_VAE.pth" \
  --learning_rate 1e-4 --num_epochs 1 --output_path "${OUT}_cache" "${COMMON[@]}" --task "sft:data_process"
accelerate launch "$HERE/train_identity.py" --dataset_base_path "${OUT}_cache" \
  --dataset_repeat 1 --model_id_with_origin_paths "Wan-AI/Wan2.2-Animate-2-14B:wan_animate_2/wan_animate_2_bf16.safetensors" \
  --learning_rate 1e-4 --num_epochs "$STEPS_EPOCHS" --save_steps 250 --output_path "$OUT" "${COMMON[@]}" --task "sft:train"
