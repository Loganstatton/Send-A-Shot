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
  body: JSON.stringify({ presetId: 'iphone-selfie', workflowId: 'sienna-sdxl-production', siennaLock: true, contentMode: 'sfw', fields, params, images }),
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

const diag = await call('/api/diagnostics?workflowId=sienna-sdxl-production');
assert(diag.status === 200 && diag.body.checks.find((c) => c.id === 'reachable')?.status === 'pass', 'diagnostics: server reachable');
assert(diag.body.checks.find((c) => c.id === 'executable')?.status !== undefined, `diagnostics: executable check ran (${diag.body.checks.find((c) => c.id === 'executable')?.status})`);

const first = await call('/api/diagnostics/first-test', { method: 'POST', body: JSON.stringify({ workflowId: 'sienna-sdxl-production' }) });
assert(first.status === 202 && first.body.seed === 424242 && (first.body.lora === null || first.body.lora.strength === 1), 'first test queued with fixed seed and the tested LoRA strength (1.0)');

// ── Edit Outfit (only when SIENNA_OUTFIT_EDIT=true on the server) ──
const avail = await call('/api/outfit-edit');
if (avail.status === 200 && avail.body.enabled) {
  assert(avail.body.available, `Edit Outfit available (missing: ${avail.body.missing?.join(', ') || 'none'})`);
  // a 64×96 PNG as the clothing photo, from the generated image itself
  const png = Buffer.from(await (await fetch(`${BASE}/api/files/${rec.images[0].file}`, { headers })).arrayBuffer());
  const form = new FormData();
  form.append('file', new Blob([png], { type: 'image/png' }), 'clothing.png');
  form.append('purpose', 'up');
  const upH = { ...headers }; delete upH['Content-Type'];
  const up = await (await fetch(`${BASE}/api/uploads`, { method: 'POST', headers: upH, body: form })).json();
  assert(!!up.file, 'clothing photo uploaded');
  const before = (await call(`/api/history/${rec.id}/status`)).body;
  for (const [scope, description, footwear] of [['full', 'red string bikini', 'barefoot'], ['top', 'white linen shirt', 'keep'], ['bottom', 'black mini skirt', 'reference']]) {
    const q = await call('/api/outfit-edit', {
      method: 'POST',
      body: JSON.stringify({ sourceId: rec.id, reference: up, description, scope, footwear, face: 'standard', seed: 7,
        protect: { garmentOnly: true, bodyRef: true, bodyCheck: true } }),
    });
    assert(q.status === 202, `edit queued (${scope}, ${footwear})`);
    let e = q.body;
    for (let i = 0; i < 120 && e.status !== 'done' && e.status !== 'error'; i++) {
      await new Promise((r) => setTimeout(r, 1000));
      e = (await call(`/api/history/${e.id}/status`)).body;
    }
    assert(e.status === 'done' && e.images.length === 1 && e.id !== rec.id, `edit saved as a new image (${scope})`);
    assert(e.outfitEdit?.sourceId === rec.id && e.outfitEdit?.scope === scope && e.outfitEdit?.footwear === footwear, `edit record links its source (${scope})`);
    assert(!!e.identityCheck && (e.identityCheck.status !== 'verified' || typeof e.identityCheck.similarity === 'number'), `edit records a face-check outcome (${scope}: ${e.identityCheck?.status})`);
    assert(!e.outfitEdit?.protect || Object.values(e.outfitEdit.protect).every((v) => !v) || avail.body.experiments, 'experimental body protection ignored while experiments are off');
  }
  // garment-only redraw + Avoid
  const rq = await call('/api/outfit-edit', {
    method: 'POST',
    body: JSON.stringify({ sourceId: rec.id, reference: up, description: 'black micro string bikini. No wide cups.', scope: 'full', footwear: 'barefoot', face: 'standard', seed: 7, redraw: true, avoid: 'thick straps, beige fabric' }),
  });
  assert(rq.status === 202 && rq.body.outfitEdit?.redraw?.grow === 'garment' && rq.body.outfitEdit?.avoid === 'thick straps, beige fabric', 'clothes-only redraw queued with Avoid list');
  assert(rq.body.submittedGraph?.q_neg?.inputs?.prompt === 'thick straps, beige fabric, wide cups', 'Avoid + "no …" sentences reach the editor negative prompt');
  let re = rq.body;
  for (let i = 0; i < 120 && re.status !== 'done' && re.status !== 'error'; i++) {
    await new Promise((r) => setTimeout(r, 1000));
    re = (await call(`/api/history/${re.id}/status`)).body;
  }
  assert(re.status === 'done' && re.outfitEdit?.redraw?.info?.mask > 0, `clothes-only redraw finished (${re.error ?? 'redraw area ' + re.outfitEdit?.redraw?.info?.mask})`);
  const after = (await call(`/api/history/${rec.id}/status`)).body;
  assert(after.images[0].file === before.images[0].file, 'original image untouched');
  assert(JSON.stringify(after.identityCheck) === JSON.stringify(before.identityCheck) && JSON.stringify(after.review) === JSON.stringify(before.review), 'original face check and review untouched');
} else {
  console.log('– Edit Outfit is off on this server (SIENNA_OUTFIT_EDIT), skipped');
}

// ── Video Studio (only when SIENNA_VIDEO=true on the server) ──
const vAvail = await call('/api/video');
if (vAvail.status === 200 && vAvail.body.enabled) {
  assert(vAvail.body.modes.animate.available && vAvail.body.modes.motion.available, `Video Studio available (missing: ${[...vAvail.body.modes.animate.missing, ...vAvail.body.modes.motion.missing].join(', ') || 'none'})`);
  const before = (await call(`/api/history/${rec.id}/status`)).body;
  const poll = async (r) => {
    for (let i = 0; i < 180 && r.status !== 'done' && r.status !== 'error'; i++) {
      await new Promise((res) => setTimeout(res, 1000));
      r = (await call(`/api/history/${r.id}/status`)).body;
    }
    return r;
  };
  const checkVideo = async (v, label) => {
    assert(v.status === 'done' && v.video?.result?.file?.endsWith('.mp4') && v.images.length === 1, `${label}: finished with a video and a poster (${v.error ?? v.video?.result?.seconds + ' s'})`);
    assert(v.parentId === rec.id && v.video.sourceId === rec.id && v.identityPolicy === 1, `${label}: new record linked to its photo`);
    assert(!!v.identityCheck && v.identityCheck.status !== 'verified', `${label}: face check outcome recorded, never verified in mock mode (${v.identityCheck?.status})`);
    const full = await fetch(`${BASE}/api/files/${v.video.result.file}`, { headers });
    assert(full.ok && full.headers.get('content-type') === 'video/mp4' && full.headers.get('accept-ranges') === 'bytes', `${label}: served as video/mp4 with byte ranges`);
    const part = await fetch(`${BASE}/api/files/${v.video.result.file}`, { headers: { ...headers, Range: 'bytes=0-1023' } });
    const partBytes = Buffer.from(await part.arrayBuffer());
    assert(part.status === 206 && partBytes.length === 1024 && /^bytes 0-1023\/\d+$/.test(part.headers.get('content-range') ?? ''), `${label}: Range request answered with 206 (iPhone playback)`);
    assert(partBytes.indexOf(Buffer.from('moov')) > 0 && partBytes.indexOf(Buffer.from('moov')) < partBytes.indexOf(Buffer.from('mdat')) || partBytes.indexOf(Buffer.from('mdat')) < 0, `${label}: MP4 index at the front (fast start)`);
  };

  // Animate Image
  const an = await call('/api/video', { method: 'POST', body: JSON.stringify({ mode: 'animate', sourceId: rec.id, seed: 11, quality: 'fast', resolution: '480p', motion: 'she smiles and waves', camera: 'push_in', seconds: 2 }) });
  assert(an.status === 202 && an.body.video?.frames === 33 && an.body.submittedGraph?.v_i2v?.inputs?.length === 33, 'Animate Image queued (2 s = 33 frames)');
  await checkVideo(await poll(an.body), 'Animate Image');

  const bad = await call('/api/video', { method: 'POST', body: JSON.stringify({ mode: 'animate', sourceId: rec.id, seed: 1, motion: 'she dances like a schoolgirl' }) });
  assert(bad.status === 422, 'minor-coded motion text blocked');

  // Copy Motion: a 3 s, 30 fps, 1280×720 clip stands in for a phone video
  const { execFileSync } = await import('node:child_process');
  const { default: ffmpeg } = await import('ffmpeg-static');
  const { mkdtempSync, readFileSync } = await import('node:fs');
  const { join } = await import('node:path');
  const { tmpdir } = await import('node:os');
  const clip = join(mkdtempSync(join(tmpdir(), 'smoke-')), 'clip.mp4');
  execFileSync(ffmpeg, ['-hide_banner', '-loglevel', 'error', '-f', 'lavfi', '-i', 'testsrc=size=1280x720:rate=30', '-t', '3', '-pix_fmt', 'yuv420p', clip]);
  const upH = { ...headers, 'Content-Type': 'video/mp4' };
  const up = await (await fetch(`${BASE}/api/video/upload`, { method: 'POST', headers: upH, body: readFileSync(clip) })).json();
  assert(up.video?.fps === 16 && up.video.frames === 48 && Math.max(up.video.width, up.video.height) <= 832 && !!up.poster?.file, `driving video normalised (${up.error ?? `${up.video?.frames} frames, ${up.video?.width}×${up.video?.height}`})`);
  const junk = await fetch(`${BASE}/api/video/upload`, { method: 'POST', headers: upH, body: 'not a video' });
  assert(junk.status === 415, 'non-video upload rejected');

  const mo = await call('/api/video', { method: 'POST', body: JSON.stringify({ mode: 'motion', sourceId: rec.id, seed: 12, quality: 'fast', resolution: '480p', drive: up, start: 0.5, seconds: 2, scene: 'in a sunny kitchen' }) });
  assert(mo.status === 202 && mo.body.video?.frames === 32 && mo.body.submittedGraph?.v_drive_part?.inputs?.batch_index === 8, 'Copy Motion queued (0.5 s → 2.5 s of the clip)');
  assert(mo.body.submittedGraph?.v_anim_0?.inputs?.background_video === undefined, 'Copy Motion uses move mode (the person in the video never appears)');
  const moDone = await poll(mo.body);
  await checkVideo(moDone, 'Copy Motion');

  const after = (await call(`/api/history/${rec.id}/status`)).body;
  assert(after.images[0].file === before.images[0].file && JSON.stringify(after.identityCheck) === JSON.stringify(before.identityCheck) && JSON.stringify(after.review) === JSON.stringify(before.review), 'photo record untouched by videos');

  const del = await call(`/api/history/${moDone.id}`, { method: 'DELETE' });
  const gone = await fetch(`${BASE}/api/files/${moDone.video.result.file}`, { headers });
  const driveGone = await fetch(`${BASE}/api/files/${up.video.file}`, { headers });
  const photoKept = await fetch(`${BASE}/api/files/${rec.images[0].file}`, { headers });
  assert(del.status < 300 && gone.status === 404 && driveGone.status === 404 && photoKept.ok, 'deleting a video removes its files, never the photo');
} else {
  console.log('– Video Studio is off on this server (SIENNA_VIDEO), skipped');
  const off = await call('/api/video', { method: 'POST', body: JSON.stringify({ mode: 'animate', sourceId: rec.id, seed: 1, motion: 'smile' }) });
  assert(off.status === 403, 'video API refuses requests while Video Studio is off');
}

const trav = await fetch(`${BASE}/api/files/..%2Fconfig.json`, { headers });
assert(trav.status === 400, 'path traversal rejected');
console.log('\nAll smoke checks passed.');
