#!/usr/bin/env bash
# Restore what Sienna Studio's face-refinement pass needs on a ComfyUI server:
#   - ComfyUI-Impact-Pack     (FaceDetailer)
#   - ComfyUI-Impact-Subpack  (UltralyticsDetectorProvider)
#   - their Python requirements (installed into ComfyUI's own Python)
#   - models/ultralytics/bbox/face_yolov8m.pt
#
# With --with-outfit it also installs what the Outfit Reference feature needs:
#   - ComfyUI_IPAdapter_plus  (IPAdapterAdvanced, PrepImageForClipVision)
#   - ComfyUI-Florence2       (outfit description)
#   - ComfyUI-KJNodes         (GetImageSizeAndCount; kept as-is if already installed)
#   - custom_nodes/sienna_text_output (returns the description to the app)
#   - models/ipadapter/ip-adapter-plus_sdxl_vit-h.safetensors          (h94/IP-Adapter)
#   - models/clip_vision/CLIP-ViT-H-14-laion2B-s32B-b79K.safetensors   (h94/IP-Adapter image_encoder)
#   - models/ultralytics/segm/person_yolov8m-seg.pt                    (Bingsu/adetailer)
#   - models/LLM/Florence-2-large                                      (microsoft/Florence-2-large)
# Before downloading, it prints each model repo's declared license and stops
# if one isn't on the expected list (override: OUTFIT_LICENSE_OK=1).
#
# Safe to re-run: existing repos/files are kept. Run it on the GPU machine
# (e.g. a RunPod web terminal) after every fresh Pod start, then restart ComfyUI.
#
#   bash comfyui-bootstrap.sh [--with-outfit] [--restart]
#
# Options / environment:
#   --with-outfit      also install the Outfit Reference nodes and models (~4.5 GB)
#   --with-pose        also install pose copying: comfyui_controlnet_aux (DWPose skeleton
#                      extractor, minimal deps) + models/controlnet/sdxl_openpose.safetensors
#                      (xinsir/controlnet-openpose-sdxl-1.0, ~2.5 GB)
#   --restart          restart ComfyUI afterwards via ComfyUI-Manager (if installed)
#   COMFYUI_DIR        ComfyUI folder (default: auto-detect)
#   COMFYUI_PYTHON     Python used by ComfyUI (default: auto-detect its venv)
#   COMFYUI_PORT       port for --restart (default 8188)
#   IMPACT_PACK_REF / IMPACT_SUBPACK_REF / IPADAPTER_REF / FLORENCE2_REF / KJNODES_REF
#                      git commits to check out
#                      (default: the versions tested with Sienna Studio; "latest" = newest)
set -euo pipefail

IMPACT_PACK_REF="${IMPACT_PACK_REF:-429d015}"
IMPACT_SUBPACK_REF="${IMPACT_SUBPACK_REF:-50c7b71}"
IPADAPTER_REF="${IPADAPTER_REF:-a0f451a}"
FLORENCE2_REF="${FLORENCE2_REF:-9ece3de}"
KJNODES_REF="${KJNODES_REF:-d3cfe21}"
CNAUX_REF="${CNAUX_REF:-0cd2904}"
HF="https://huggingface.co"
FACE_MODEL_URL="$HF/Bingsu/adetailer/resolve/main/face_yolov8m.pt"
FACE_MODEL_MIN_BYTES=50000000
RESTART=0
OUTFIT=0
POSE=0
for arg in "$@"; do
  case "$arg" in
    --restart) RESTART=1 ;;
    --with-outfit) OUTFIT=1 ;;
    --with-pose) POSE=1 ;;
    *) echo "unknown option: $arg" >&2; exit 2 ;;
  esac
done

log() { printf '\n==> %s\n' "$*"; }
die() { printf '\nERROR: %s\n' "$*" >&2; exit 1; }

# ── Locate ComfyUI and its Python ─────────────────────────────────────────────
if [[ -z "${COMFYUI_DIR:-}" ]]; then
  for d in /workspace/runpod-slim/ComfyUI /workspace/ComfyUI /opt/ComfyUI "$HOME/ComfyUI" "$PWD/ComfyUI" "$PWD"; do
    if [[ -f "$d/main.py" && -d "$d/custom_nodes" ]]; then COMFYUI_DIR="$d"; break; fi
  done
fi
[[ -n "${COMFYUI_DIR:-}" && -f "$COMFYUI_DIR/main.py" ]] || die "ComfyUI not found. Set COMFYUI_DIR=/path/to/ComfyUI."

if [[ -z "${COMFYUI_PYTHON:-}" ]]; then
  for p in "$COMFYUI_DIR"/.venv*/bin/python "$COMFYUI_DIR"/venv/bin/python "$COMFYUI_DIR"/../venv/bin/python; do
    if [[ -x "$p" ]]; then COMFYUI_PYTHON="$p"; break; fi
  done
  COMFYUI_PYTHON="${COMFYUI_PYTHON:-$(command -v python3 || command -v python)}"
fi
[[ -x "$COMFYUI_PYTHON" ]] || die "Python not found. Set COMFYUI_PYTHON=/path/to/python."
echo "ComfyUI: $COMFYUI_DIR"
echo "Python:  $COMFYUI_PYTHON"

# ── Custom nodes ──────────────────────────────────────────────────────────────
install_repo() {
  local name="$1" url="$2" ref="$3" dir="$COMFYUI_DIR/custom_nodes/$1" reqs_mode="${4:-reqs}"
  log "$name"
  if [[ -d "$dir/.git" ]]; then
    echo "already present"
  elif [[ -d "$dir" ]]; then
    echo "already present (not a git checkout) — kept as-is"
    return 0
  else
    # Clone to local temp first: cloning straight onto some cloud network
    # volumes fails intermittently ("remote end hung up").
    local tmp; tmp=$(mktemp -d)
    local ok=0
    for _ in 1 2 3; do
      if git clone -q "$url" "$tmp/$name"; then ok=1; break; fi
      rm -rf "${tmp:?}/$name"; sleep 3
    done
    (( ok )) || die "could not clone $url"
    mv "$tmp/$name" "$dir"; rm -rf "$tmp"
  fi
  if [[ "$ref" != "latest" ]]; then
    git -C "$dir" fetch -q origin || true
    git -C "$dir" checkout -q "$ref" && echo "at $ref"
  fi
  if [[ "$reqs_mode" == "reqs" && -f "$dir/requirements.txt" ]]; then
    # git+ requirements (e.g. sam2) are optional extras that FaceDetailer doesn't
    # need; GitHub fetches fail intermittently on cloud GPUs, so don't let them
    # block the rest.
    local reqs; reqs=$(mktemp)
    grep -v '^git+' "$dir/requirements.txt" > "$reqs" || true
    "$COMFYUI_PYTHON" -m pip install -q --disable-pip-version-check -r "$reqs"
    rm -f "$reqs"
    echo "requirements installed"
    while read -r extra; do
      "$COMFYUI_PYTHON" -m pip install -q --disable-pip-version-check "$extra" \
        || echo "optional package skipped (install failed): $extra"
    done < <(grep '^git+' "$dir/requirements.txt" || true)
  fi
}
install_repo ComfyUI-Impact-Pack https://github.com/ltdrdata/ComfyUI-Impact-Pack "$IMPACT_PACK_REF"
install_repo ComfyUI-Impact-Subpack https://github.com/ltdrdata/ComfyUI-Impact-Subpack "$IMPACT_SUBPACK_REF"

# fetch_model <url> <dest> <min bytes>: download once, atomically.
fetch_model() {
  local url="$1" dest="$2" min="$3"
  log "$(basename "$dest")"
  mkdir -p "$(dirname "$dest")"
  local size; size=$(stat -c %s "$dest" 2>/dev/null || echo 0)
  if (( size < min )); then
    if command -v wget >/dev/null; then wget -q -O "$dest.part" "$url"; else curl -fsSL -o "$dest.part" "$url"; fi
    mv "$dest.part" "$dest"
  fi
  size=$(stat -c %s "$dest")
  (( size >= min )) || die "$dest is only $size bytes — download incomplete?"
  echo "$size bytes"
}

# ── Face detector model ───────────────────────────────────────────────────────
fetch_model "$FACE_MODEL_URL" "$COMFYUI_DIR/models/ultralytics/bbox/face_yolov8m.pt" "$FACE_MODEL_MIN_BYTES"

# check_licenses "<hf repo>:<expected license>" … — prints each declared license and
# stops if one differs (override after reviewing: OUTFIT_LICENSE_OK=1).
license_of() {
  curl -fsS --max-time 20 "$HF/api/models/$1" | "$COMFYUI_PYTHON" -c \
    'import json,sys; d=json.load(sys.stdin); c=d.get("cardData") or {}; t=[x[8:] for x in d.get("tags",[]) if x.startswith("license:")]; print(c.get("license") or (t[0] if t else "unknown"))'
}
check_licenses() {
  local bad=0 entry repo want got
  for entry in "$@"; do
    repo="${entry%%:*}" want="${entry##*:}"
    got=$(license_of "$repo" || echo "unreachable")
    printf '  %-36s %s\n' "$repo" "$got"
    [[ "$got" == "$want" ]] || bad=1
  done
  if (( bad )) && [[ "${OUTFIT_LICENSE_OK:-0}" != "1" ]]; then
    die "a model license differs from the expected one — review it, then re-run with OUTFIT_LICENSE_OK=1 to continue."
  fi
}

# ── Outfit reference ──────────────────────────────────────────────────────────
if (( OUTFIT )); then
  # Declared licenses, read from the Hub before anything is downloaded.
  log "Model licenses (Hugging Face model cards)"
  check_licenses "h94/IP-Adapter:apache-2.0" "microsoft/Florence-2-large:mit" "Bingsu/adetailer:apache-2.0"
  echo "  Note: the YOLOv8 detectors (face_yolov8m.pt, person_yolov8m-seg.pt) are Ultralytics models — Ultralytics"
  echo "        licenses YOLOv8 under AGPL-3.0 (or a paid Enterprise license) regardless of the repo's tag."

  install_repo ComfyUI_IPAdapter_plus https://github.com/cubiq/ComfyUI_IPAdapter_plus "$IPADAPTER_REF"
  install_repo ComfyUI-Florence2 https://github.com/kijai/ComfyUI-Florence2 "$FLORENCE2_REF"
  if [[ -d "$COMFYUI_DIR/custom_nodes/ComfyUI-KJNodes" ]]; then
    log "ComfyUI-KJNodes"; echo "already installed — kept as-is"
  else
    install_repo ComfyUI-KJNodes https://github.com/kijai/ComfyUI-KJNodes "$KJNODES_REF"
  fi

  log "sienna_text_output"
  mkdir -p "$COMFYUI_DIR/custom_nodes/sienna_text_output"
  cat > "$COMFYUI_DIR/custom_nodes/sienna_text_output/__init__.py" <<'PY'
# Publishes a STRING to the ComfyUI job history so Sienna Studio can read it
# (used for the Florence-2 outfit description).
class SiennaTextOutput:
    @classmethod
    def INPUT_TYPES(cls):
        return {"required": {"text": ("STRING", {"forceInput": True})}}

    RETURN_TYPES = ()
    FUNCTION = "run"
    OUTPUT_NODE = True
    CATEGORY = "sienna"

    def run(self, text):
        items = text if isinstance(text, list) else [text]
        return {"ui": {"text": [str(t) for t in items]}}


NODE_CLASS_MAPPINGS = {"SiennaTextOutput": SiennaTextOutput}
NODE_DISPLAY_NAME_MAPPINGS = {"SiennaTextOutput": "Sienna Text Output"}
PY
  echo "written"

  fetch_model "$HF/h94/IP-Adapter/resolve/main/sdxl_models/ip-adapter-plus_sdxl_vit-h.safetensors" \
    "$COMFYUI_DIR/models/ipadapter/ip-adapter-plus_sdxl_vit-h.safetensors" 800000000
  fetch_model "$HF/h94/IP-Adapter/resolve/main/models/image_encoder/model.safetensors" \
    "$COMFYUI_DIR/models/clip_vision/CLIP-ViT-H-14-laion2B-s32B-b79K.safetensors" 2000000000
  fetch_model "$HF/Bingsu/adetailer/resolve/main/person_yolov8m-seg.pt" \
    "$COMFYUI_DIR/models/ultralytics/segm/person_yolov8m-seg.pt" 40000000

  log "Florence-2-large"
  "$COMFYUI_PYTHON" - "$COMFYUI_DIR/models/LLM/Florence-2-large" <<'PY'
import os, sys
from huggingface_hub import snapshot_download
dest = sys.argv[1]
snapshot_download(repo_id="microsoft/Florence-2-large", local_dir=dest,
                  allow_patterns=["*.json", "*.safetensors", "*.bin", "*.txt", "*.model"])
print(sorted(os.listdir(dest)))
PY
fi

# ── Pose copying (photo → skeleton → OpenPose ControlNet) ─────────────────────
if (( POSE )); then
  log "Pose model licenses (Hugging Face model cards)"
  check_licenses "xinsir/controlnet-openpose-sdxl-1.0:apache-2.0" "yzd-v/DWPose:apache-2.0"
  # The pack's full requirements pull mediapipe, trimesh and onnxruntime-gpu for
  # preprocessors we don't use; DWPose only needs these.
  install_repo comfyui_controlnet_aux https://github.com/Fannovel16/comfyui_controlnet_aux "$CNAUX_REF" noreqs
  "$COMFYUI_PYTHON" -m pip install -q --disable-pip-version-check \
    huggingface_hub opencv-python-headless scipy einops filelock scikit-image matplotlib pyyaml addict yacs omegaconf python-dateutil onnxruntime
  echo "DWPose requirements installed"
  fetch_model "$HF/xinsir/controlnet-openpose-sdxl-1.0/resolve/main/diffusion_pytorch_model.safetensors" \
    "$COMFYUI_DIR/models/controlnet/sdxl_openpose.safetensors" 2000000000
  log "DWPose models (yzd-v/DWPose → comfyui_controlnet_aux/ckpts)"
  for f in yolox_l.onnx dw-ll_ucoco_384.onnx; do
    fetch_model "$HF/yzd-v/DWPose/resolve/main/$f" "$COMFYUI_DIR/custom_nodes/comfyui_controlnet_aux/ckpts/yzd-v/DWPose/$f" 100000000
  done
fi

# ── Sienna custom nodes (pose retargeting, garment-only isolation) ─────────────
# Shipped in this repo (scripts/comfy_nodes/sienna_nodes). Copied when the script runs from
# a checkout, or when SIENNA_NODES_DIR points at an uploaded copy.
if (( OUTFIT || POSE )); then
  log "sienna_nodes"
  src="${SIENNA_NODES_DIR:-$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/comfy_nodes/sienna_nodes}"
  if [[ -f "$src/__init__.py" ]]; then
    rm -rf "$COMFYUI_DIR/custom_nodes/sienna_nodes"
    cp -r "$src" "$COMFYUI_DIR/custom_nodes/sienna_nodes"
    rm -rf "$COMFYUI_DIR/custom_nodes/sienna_nodes/__pycache__"
    echo "installed from $src"
  else
    echo "not found at $src — pose retargeting and garment-only isolation will be unavailable (set SIENNA_NODES_DIR)"
  fi
fi

# ── Check the Python side imports ─────────────────────────────────────────────
log "Checking Python packages"
"$COMFYUI_PYTHON" -c "import ultralytics, cv2, segment_anything, skimage, piexif; print('ultralytics', ultralytics.__version__, '· ok')"

# ── Restart ───────────────────────────────────────────────────────────────────
port="${COMFYUI_PORT:-8188}"
if (( RESTART )); then
  log "Restarting ComfyUI"
  base="http://127.0.0.1:$port"
  code=$(curl -s -o /dev/null -w '%{http_code}' -X POST --max-time 10 "$base/api/manager/reboot" || true)
  if [[ "$code" == "404" || "$code" == "405" ]]; then
    code=$(curl -s -o /dev/null -w '%{http_code}' --max-time 10 "$base/manager/reboot" || true)
  fi
  if [[ "$code" == "404" || "$code" == "405" ]]; then
    echo "ComfyUI-Manager's restart endpoint isn't available — restart ComfyUI yourself."
  else
    # The server drops the connection while it restarts; wait until FaceDetailer is loaded.
    ok=0
    for _ in $(seq 1 60); do
      sleep 3
      if curl -fsS --max-time 5 "$base/object_info/FaceDetailer" 2>/dev/null | grep -q '"FaceDetailer"'; then ok=1; break; fi
    done
    if (( ok )); then
      echo "ComfyUI restarted — FaceDetailer is loaded."
      if (( OUTFIT || POSE )); then
        for cls in IPAdapterAdvanced Florence2Run GetImageSizeAndCount SiennaTextOutput SegmDetectorCombined_v2 SiennaGarmentIsolate $( (( POSE )) && echo DWPreprocessor SiennaPoseRetarget ); do
          if curl -fsS --max-time 5 "$base/object_info/$cls" 2>/dev/null | grep -q "\"$cls\""; then echo "  ✓ $cls"; else echo "  ✗ $cls NOT loaded — check the ComfyUI log"; fi
        done
      fi
      if (( OUTFIT )); then echo "Open Sienna Studio → Diagnostics and check “Face refinement” and “Outfit reference”."
      else echo "Open Sienna Studio → Diagnostics and check “Face refinement”."; fi
    else
      echo "ComfyUI did not come back with FaceDetailer within 3 minutes — check the ComfyUI log, or restart it yourself."
    fi
  fi
else
  echo
  echo "Done. Restart ComfyUI so it loads the new nodes (re-run with --restart, or use ComfyUI-Manager → Restart),"
  echo "then open Sienna Studio → Diagnostics and check “Face refinement”."
fi
