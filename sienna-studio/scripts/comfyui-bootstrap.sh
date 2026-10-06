#!/usr/bin/env bash
# Restore what Sienna Studio's face-refinement pass needs on a ComfyUI server:
#   - ComfyUI-Impact-Pack     (FaceDetailer)
#   - ComfyUI-Impact-Subpack  (UltralyticsDetectorProvider)
#   - their Python requirements (installed into ComfyUI's own Python)
#   - models/ultralytics/bbox/face_yolov8m.pt
#
# Safe to re-run: existing repos/files are kept. Run it on the GPU machine
# (e.g. a RunPod web terminal) after every fresh Pod start, then restart ComfyUI.
#
#   bash comfyui-bootstrap.sh [--restart]
#
# Options / environment:
#   --restart          restart ComfyUI afterwards via ComfyUI-Manager (if installed)
#   COMFYUI_DIR        ComfyUI folder (default: auto-detect)
#   COMFYUI_PYTHON     Python used by ComfyUI (default: auto-detect its venv)
#   COMFYUI_PORT       port for --restart (default 8188)
#   IMPACT_PACK_REF / IMPACT_SUBPACK_REF   git commits to check out
#                      (default: the versions tested with Sienna Studio; "latest" = newest)
set -euo pipefail

IMPACT_PACK_REF="${IMPACT_PACK_REF:-429d015}"
IMPACT_SUBPACK_REF="${IMPACT_SUBPACK_REF:-50c7b71}"
FACE_MODEL_URL="https://huggingface.co/Bingsu/adetailer/resolve/main/face_yolov8m.pt"
FACE_MODEL_MIN_BYTES=50000000
RESTART=0
[[ "${1:-}" == "--restart" ]] && RESTART=1

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
  local name="$1" url="$2" ref="$3" dir="$COMFYUI_DIR/custom_nodes/$1"
  log "$name"
  if [[ -d "$dir/.git" ]]; then
    echo "already present"
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
  if [[ -f "$dir/requirements.txt" ]]; then
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

# ── Face detector model ───────────────────────────────────────────────────────
log "face_yolov8m.pt"
model_dir="$COMFYUI_DIR/models/ultralytics/bbox"
model="$model_dir/face_yolov8m.pt"
mkdir -p "$model_dir"
size=$(stat -c %s "$model" 2>/dev/null || echo 0)
if (( size < FACE_MODEL_MIN_BYTES )); then
  if command -v wget >/dev/null; then wget -q -O "$model.part" "$FACE_MODEL_URL"; else curl -fsSL -o "$model.part" "$FACE_MODEL_URL"; fi
  mv "$model.part" "$model"
fi
echo "$(stat -c %s "$model") bytes"

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
      echo "Open Sienna Studio → Diagnostics and check “Face refinement”."
    else
      echo "ComfyUI did not come back with FaceDetailer within 3 minutes — check the ComfyUI log, or restart it yourself."
    fi
  fi
else
  echo
  echo "Done. Restart ComfyUI so it loads the new nodes (re-run with --restart, or use ComfyUI-Manager → Restart),"
  echo "then open Sienna Studio → Diagnostics and check “Face refinement”."
fi
