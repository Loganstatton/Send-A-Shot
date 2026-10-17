// A stand-in for RunPod's REST API (/v1/pods) for testing the on-demand video GPU without spending money.
// Creating a pod starts scripts/fake-comfyui.mjs (--wan-video --face-check) on FAKE_COMFY_PORT after
// FAKE_READY_SECONDS, and fetches the setup kit from the URL in the pod's start command (like a real pod would).
//
//   node scripts/fake-runpod.mjs [--port 8189]
//   FAKE_NO_CAPACITY="NVIDIA A40"   GPU types that answer "no capacity" (comma-separated; "*" = all)
//   FAKE_NEVER_READY=1              the pod never gets a working ComfyUI (startup-timeout test)
//   FAKE_COMFY_FLAGS="--hang-exec"  extra flags for the fake ComfyUI
//   FAKE_BAD_KEY=1                  every call answers 401
// GET /debug → { creates, deletes, kit: [{file, status}], pods }
import http from 'node:http';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const PORT = Number(process.argv[process.argv.indexOf('--port') + 1]) || 8189;
const COMFY_PORT = Number(process.env.FAKE_COMFY_PORT || 8190);
const READY_S = Number(process.env.FAKE_READY_SECONDS || 3);
const noCap = (process.env.FAKE_NO_CAPACITY || '').split(',').map((s) => s.trim()).filter(Boolean);
const here = path.dirname(fileURLToPath(import.meta.url));
const pods = new Map();
const debug = { creates: [], deletes: [], kit: [] };
let comfy = null;

const send = (res, code, body) => {
  res.writeHead(code, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(body));
};
async function fetchKit(cmd) {
  const m = /curl[^']*'([^']+)\/setup\.sh'/.exec(cmd);
  if (!m) return debug.kit.push({ file: 'setup.sh', status: 'no kit url in start command' });
  for (const f of ['setup.sh', 'comfyui-bootstrap.sh', 'sienna_nodes.tgz']) {
    try {
      const r = await fetch(`${m[1]}/${f}`);
      const b = Buffer.from(await r.arrayBuffer());
      debug.kit.push({ file: f, status: r.status, bytes: b.length });
    } catch (e) {
      debug.kit.push({ file: f, status: String(e.message) });
    }
  }
  // a wrong token must be refused
  const r = await fetch(m[1].replace(/kit\/[^/]+$/, 'kit/wrongtoken') + '/setup.sh').catch(() => null);
  debug.kit.push({ file: 'setup.sh (wrong token)', status: r ? r.status : 'error' });
}
function startComfy() {
  if (comfy || process.env.FAKE_NEVER_READY === '1') return;
  const flags = (process.env.FAKE_COMFY_FLAGS || '').split(' ').filter(Boolean);
  comfy = spawn('node', [path.join(here, 'fake-comfyui.mjs'), '--port', String(COMFY_PORT), '--wan-video', '--face-check', ...flags], { stdio: 'ignore' });
}
function stopComfy() {
  if (comfy) comfy.kill();
  comfy = null;
}

http
  .createServer(async (req, res) => {
    const url = new URL(req.url, 'http://x');
    const p = url.pathname;
    if (p === '/debug') return send(res, 200, { ...debug, pods: [...pods.values()] });
    if (process.env.FAKE_BAD_KEY === '1') return send(res, 401, { error: 'invalid api key' });
    if (req.headers.authorization !== 'Bearer test-key') return send(res, 401, { error: 'invalid api key' });
    let body = '';
    for await (const c of req) body += c;
    const j = body ? JSON.parse(body) : {};
    if (p === '/v1/pods' && req.method === 'GET') return send(res, 200, [...pods.values()].filter((x) => x.desiredStatus === 'RUNNING'));
    if (p === '/v1/pods' && req.method === 'POST') {
      const gpu = j.gpuTypeIds?.[0];
      debug.creates.push({ name: j.name, gpu, ports: j.ports, volumeInGb: j.volumeInGb, networkVolumeId: j.networkVolumeId ?? null, env: j.env, image: j.imageName, startCmd: j.dockerStartCmd });
      if (noCap.includes('*') || noCap.includes(gpu)) return send(res, 500, { error: `There are no longer any instances available with the requested specifications (${gpu}).` });
      const id = 'fakepod' + Math.random().toString(36).slice(2, 9);
      const pod = { id, name: j.name, desiredStatus: 'RUNNING', costPerHr: gpu.includes('A40') ? 0.59 : 0.69, gpu };
      pods.set(id, pod);
      fetchKit((j.dockerStartCmd || []).join(' '));
      setTimeout(startComfy, READY_S * 1000);
      return send(res, 200, pod);
    }
    const m = /^\/v1\/pods\/([^/]+)$/.exec(p);
    if (m) {
      const pod = pods.get(m[1]);
      if (!pod) return send(res, 404, { error: 'pod not found' });
      if (req.method === 'GET') return send(res, 200, pod);
      if (req.method === 'DELETE') {
        pod.desiredStatus = 'TERMINATED';
        debug.deletes.push(m[1]);
        if (![...pods.values()].some((x) => x.desiredStatus === 'RUNNING')) stopComfy();
        return send(res, 200, {});
      }
    }
    send(res, 404, { error: 'not found' });
  })
  .listen(PORT, () => console.log(`fake RunPod on :${PORT}`));
process.on('SIGTERM', () => {
  stopComfy();
  process.exit(0);
});
