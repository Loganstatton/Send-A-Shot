// End-to-end smoke test against a RUNNING server (use mock mode):
//   COMFYUI_URL=mock npm start   (in one terminal)
//   npm run smoke                (in another; BASE_URL defaults to http://localhost:3000)
// Exercises the production build, so it also catches minifier/bundling issues
// that unit tests can't.
const BASE = process.env.BASE_URL || 'http://localhost:3000';
const headers = { 'Content-Type': 'application/json' };
if (process.env.APP_PASSWORD) {
  const r = await fetch(`${BASE}/api/auth/login`, { method: 'POST', headers, body: JSON.stringify({ password: process.env.APP_PASSWORD }) });
  headers.Cookie = r.headers.get('set-cookie')?.split(';')[0] ?? '';
}
const call = async (path, init = {}) => {
  const r = await fetch(BASE + path, { ...init, headers: { ...headers, ...(init.headers ?? {}) } });
  const body = await r.json().catch(() => null);
  return { status: r.status, body };
};
const assert = (cond, msg) => {
  if (!cond) {
    console.error('✗', msg);
    process.exit(1);
  }
  console.log('✓', msg);
};

const fields = { outfit: 'red hoodie, blonde hair', pose: '', bodyPresentation: '', expression: '', setting: 'kitchen', lighting: '', camera: '', framing: '', realism: '', extra: '' };
const params = {
  checkpoint: '', sampler: 'euler', scheduler: 'karras', seed: 1234, width: 832, height: 1216, steps: 20, cfg: 5, denoise: 1,
  loraName: '', loraStrength: 0.8, loraClipStrength: 0.8, faceStrength: 0.8, controlStrength: 0.6, controlnetModel: '', batchSize: 1,
};
const images = { initImage: null, poseImage: null, faceReferenceId: null };

const test = await call('/api/comfy/test', { method: 'POST', body: '{}' });
assert(test.status === 200 && test.body.ok, `backend reachable (${test.body?.backend})`);

const gen = await call('/api/generate', {
  method: 'POST',
  body: JSON.stringify({ presetId: 'iphone-selfie', workflowId: 'builtin-sdxl-txt2img', siennaLock: true, contentMode: 'sfw', fields, params, images }),
});
assert(gen.status === 202, 'generation queued');
assert(!/blonde/.test(gen.body.positivePrompt) && !/,\s*hair,/.test(gen.body.positivePrompt), 'Sienna Lock stripped "blonde hair" entirely');
assert(gen.body.seed === 1234, 'fixed seed honoured');

let rec = gen.body;
for (let i = 0; i < 120 && rec.status !== 'done' && rec.status !== 'error'; i++) {
  await new Promise((r) => setTimeout(r, 1000));
  rec = (await call(`/api/history/${rec.id}/status`)).body;
}
assert(rec.status === 'done', `generation finished (${rec.error ?? rec.images.length + ' image(s)'})`);
const img = await fetch(`${BASE}/api/files/${rec.images[0].file}`, { headers });
assert(img.ok && img.headers.get('content-type')?.startsWith('image/'), 'output image served');

const blocked = await call('/api/generate', {
  method: 'POST',
  body: JSON.stringify({ presetId: null, workflowId: null, siennaLock: false, contentMode: 'sfw', fields: { ...fields, outfit: 'schoolgirl' }, params, images }),
});
assert(blocked.status === 422, 'minor-coded prompt blocked');

const trav = await fetch(`${BASE}/api/files/..%2Fconfig.json`, { headers });
assert(trav.status === 400, 'path traversal rejected');
console.log('\nAll smoke checks passed.');
