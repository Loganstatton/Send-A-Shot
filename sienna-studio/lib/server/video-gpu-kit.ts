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
FLAGS="--with-wan-i2v"
if [ "\${SIENNA_COPY_MOTION:-0}" = 1 ]; then
  case "\${SIENNA_MOTION_ENGINE:-scail2}" in animate2) FLAGS="$FLAGS --with-wan-animate2" ;; animate1) FLAGS="$FLAGS --with-wan-animate" ;; *) FLAGS="$FLAGS --with-scail2" ;; esac
fi
SIENNA_NODES_DIR=/tmp/sn/sienna_nodes bash /tmp/comfyui-bootstrap.sh $FLAGS; log "BOOTSTRAP_RC=$?"
rm -rf "$C/custom_nodes/sienna_autostop" && cp -r /tmp/sn/sienna_autostop "$C/custom_nodes/sienna_autostop"
log "restarting ComfyUI"
# Restart with the exact command, environment and folder /start.sh used (its venv and settings are in that
# environment: a plain re-run of the command line from this shell starts a ComfyUI that dies at once).
python3 - <<'PY'
import os, subprocess, sys, time
def comfy_pid():
    # the python process running ComfyUI's main.py (not a shell that merely mentions it)
    for p in os.listdir('/proc'):
        try: a = open(f'/proc/{p}/cmdline').read().split('\\0')
        except (OSError, ValueError): continue
        if p.isdigit() and 'python' in os.path.basename(a[0]) and any(x.endswith('main.py') for x in a[1:]): return p
pid = comfy_pid()
if not pid: sys.exit('ComfyUI process not found')
env = dict(kv.split('=', 1) for kv in open(f'/proc/{pid}/environ').read().split('\\0') if '=' in kv)
args = open(f'/proc/{pid}/cmdline').read().split('\\0')[:-1]
cwd = os.readlink(f'/proc/{pid}/cwd')
os.kill(int(pid), 15)
for _ in range(30):
    try:
        if open(f'/proc/{pid}/stat').read().split(')')[-1].split()[0] == 'Z': break  # exited, not yet reaped
    except OSError: break
    time.sleep(1)
subprocess.Popen(args, cwd=cwd, env=env, stdout=open('/tmp/comfyui.log', 'w'), stderr=subprocess.STDOUT, start_new_session=True)
print('restarted:', ' '.join(args), 'in', cwd)
PY
for i in $(seq 1 100); do curl -fs localhost:8188/system_stats >/dev/null && break; sleep 3; done
curl -fs localhost:8188/system_stats >/dev/null && log "SETUP_DONE" || { log "SETUP_FAILED ComfyUI did not come back after the restart"; tail -20 /tmp/comfyui.log; }
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
