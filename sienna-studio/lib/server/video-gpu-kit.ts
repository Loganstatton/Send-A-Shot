/**
 * The setup kit a temporary video GPU downloads from this app when it boots (see video-gpu.ts):
 *   setup.sh               waits for the image's ComfyUI, downloads the models in parallel, installs sienna_nodes
 *                          (Lock Camera, face check, segmenter) + the idle auto-stop, and restarts ComfyUI
 *   comfyui-bootstrap.sh   this repo's installer (run with --with-wan-i2v, plus --with-wan-animate2 for Copy Motion)
 *   sienna_nodes.tgz       scripts/comfy_nodes/{sienna_nodes,sienna_autostop}
 * No secrets are in the kit; it is served only to the pod being started (one-time token).
 */

import 'server-only';
import { execFile } from 'node:child_process';
import { promises as fs } from 'node:fs';
import path from 'node:path';

const SCRIPTS = path.join(process.cwd(), 'scripts');

export const KIT_FILES = ['setup.sh', 'comfyui-bootstrap.sh', 'sienna_nodes.tgz'] as const;
export type KitFile = (typeof KIT_FILES)[number];

const W22 = 'https://huggingface.co/Comfy-Org/Wan_2.2_ComfyUI_Repackaged/resolve/main/split_files';
const W21 = 'https://huggingface.co/Comfy-Org/Wan_2.1_ComfyUI_repackaged/resolve/main/split_files';

/** The same steps as the validated manual sessions (round 12), run unattended. */
export const SETUP_SH = `#!/usr/bin/env bash
# Sienna Studio video GPU setup (runs in the background while /start.sh boots ComfyUI). Log: /tmp/sienna-setup.log
set -u
log() { echo "$(date +%T) $*"; }
C=/workspace/runpod-slim/ComfyUI; M=$C/models
get() { [ -s "$2" ] && return 0; mkdir -p "$(dirname "$2")"; for t in 1 2 3; do curl -fsSL --retry 5 -o "$2.part" "$1" && mv "$2.part" "$2" && log "OK $(basename "$2")" && return 0; done; log "FAIL $1"; return 1; }
log "waiting for ComfyUI to be installed by /start.sh"
for i in $(seq 1 180); do [ -f "$C/main.py" ] && pgrep -f "main\\.py" >/dev/null && break; sleep 5; done
log "downloading models"
pids=""
for f in wan2.2_i2v_high_noise_14B_fp8_scaled wan2.2_i2v_low_noise_14B_fp8_scaled; do get ${W22}/diffusion_models/$f.safetensors $M/diffusion_models/$f.safetensors & pids="$pids $!"; done
for f in wan2.2_i2v_lightx2v_4steps_lora_v1_high_noise wan2.2_i2v_lightx2v_4steps_lora_v1_low_noise; do get ${W22}/loras/$f.safetensors $M/loras/$f.safetensors & pids="$pids $!"; done
get ${W21}/text_encoders/umt5_xxl_fp8_e4m3fn_scaled.safetensors $M/text_encoders/umt5_xxl_fp8_e4m3fn_scaled.safetensors & pids="$pids $!"
get ${W22}/vae/wan_2.1_vae.safetensors $M/vae/wan_2.1_vae.safetensors & pids="$pids $!"
fail=0; for p in $pids; do wait $p || fail=1; done
[ $fail = 0 ] || { log "SETUP_FAILED model download"; exit 1; }
log "installing Sienna nodes"
curl -fsSL --retry 5 "$SIENNA_KIT/comfyui-bootstrap.sh" -o /tmp/comfyui-bootstrap.sh || { log "SETUP_FAILED kit download"; exit 1; }
mkdir -p /tmp/sn && curl -fsSL --retry 5 "$SIENNA_KIT/sienna_nodes.tgz" | tar xz -C /tmp/sn || { log "SETUP_FAILED kit download"; exit 1; }
FLAGS="--with-wan-i2v"; [ "\${SIENNA_COPY_MOTION:-0}" = 1 ] && FLAGS="$FLAGS --with-wan-animate2"
SIENNA_NODES_DIR=/tmp/sn/sienna_nodes bash /tmp/comfyui-bootstrap.sh $FLAGS; log "BOOTSTRAP_RC=$?"
rm -rf "$C/custom_nodes/sienna_autostop" && cp -r /tmp/sn/sienna_autostop "$C/custom_nodes/sienna_autostop"
log "restarting ComfyUI"
CMD=$(ps -eo args | grep -E "python[0-9.]* .*main\\.py" | grep -v grep | head -1); PID=$(pgrep -f "main\\.py" | head -1)
kill $PID; sleep 5
cd "$C" && nohup $CMD > /tmp/comfyui.log 2>&1 &
log "SETUP_DONE"
`;

export async function kitFile(name: KitFile): Promise<{ body: Buffer; type: string }> {
  if (name === 'setup.sh') return { body: Buffer.from(SETUP_SH), type: 'text/x-shellscript' };
  if (name === 'comfyui-bootstrap.sh') return { body: await fs.readFile(path.join(SCRIPTS, 'comfyui-bootstrap.sh')), type: 'text/x-shellscript' };
  const body = await new Promise<Buffer>((resolve, reject) =>
    execFile(
      'tar',
      ['-czf', '-', '--exclude=__pycache__', '--exclude=*.pyc', '-C', path.join(SCRIPTS, 'comfy_nodes'), 'sienna_nodes', 'sienna_autostop'],
      { encoding: 'buffer', maxBuffer: 50 * 1024 * 1024 },
      (err, out) => (err ? reject(err) : resolve(out)),
    ),
  );
  return { body, type: 'application/gzip' };
}
