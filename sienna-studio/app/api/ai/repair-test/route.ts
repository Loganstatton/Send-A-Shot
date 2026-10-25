import { z } from 'zod';
import { addKeepPerson, stripKeepPerson } from '@/lib/comfy/keep-person';
import { createBackend } from '@/lib/comfy/client';
import { backgroundFixes, buildCorrection } from '@/lib/corrections';
import { placeCorrection, reseed, swapPrompts } from '@/lib/exposure';
import { FACE_NODE_ID, parseFace } from '@/lib/identity';
import { handle, json, parseBody } from '@/lib/server/http';
import { photoGpuEnabled, photoGpuReady, touchPhotoGpu } from '@/lib/server/photo-gpu';
import { getComfyUrl, getRecord, getWorkflow, newId } from '@/lib/server/store';

export const dynamic = 'force-dynamic';
export const maxDuration = 300;

const schema = z.object({
  /** the studio photo whose attempt is repaired, and which attempt */
  id: z.string().min(1),
  attempt: z.number().int().min(0),
  /** that attempt's image (PNG, base64) — the GPU's copy may be gone */
  image: z.string().min(100).max(20_000_000),
  /** give up (and interrupt the GPU) after this long */
  timeoutSec: z.number().int().min(30).max(240).default(120),
});

/**
 * Test only: one keep-person correction of a saved attempt — the room and light redrawn around her from the checker's
 * findings for that attempt, her pasted back unchanged. No retries and no AI call (the caller checks the result with
 * /api/ai/check under its own cost limit). Needs the photo GPU running; never starts it.
 */
export const POST = handle(async (req: Request) => {
  const body = await parseBody(req, schema);
  if (photoGpuEnabled() && !(await photoGpuReady())) return json({ error: 'The photo GPU is not running.' }, 503);
  const rec = await getRecord(body.id);
  const guard = rec?.exposureGuard;
  const a = guard?.attempts[body.attempt];
  if (!rec?.submittedGraph || !guard || !a) return json({ error: 'No such photo attempt.' }, 404);
  const base = guard.base ?? { positive: rec.positivePrompt, negative: rec.negativePrompt };
  // the graph as that attempt ran it: original prompts, its seed, no earlier keep-person
  let graph = stripKeepPerson(swapPrompts(rec.submittedGraph, { positive: rec.positivePrompt, negative: rec.negativePrompt }, base));
  graph = reseed(graph, rec.seed, a.seed);
  const fixes = backgroundFixes(a.aiFixes ?? []);
  if (!fixes.length) return json({ error: 'That attempt has no room or light problems to fix.' }, 400);
  const fix = buildCorrection(fixes, base, 6);
  const positive = placeCorrection(base.positive, fix.positive, guard.anchor);
  const negative = fix.negative ? `${base.negative}, ${fix.negative}` : base.negative;
  graph = swapPrompts(graph, base, { positive, negative });

  const backend = createBackend(await getComfyUrl());
  const inputName = await backend.uploadImage(Buffer.from(body.image, 'base64'), `repair_${rec.id}_${body.attempt}.png`, 'image/png');
  const keep = addKeepPerson(graph, { inputName });
  if (!keep) return json({ error: 'This workflow has no first pass to attach the background redraw to.' }, 400);

  const t0 = Date.now();
  touchPhotoGpu();
  const { promptId } = await backend.queuePrompt(keep, newId('repair-'));
  const outputs = (await getWorkflow(rec.workflowId))?.outputNodeIds ?? [];
  while (true) {
    await new Promise((r) => setTimeout(r, 3000));
    const st = await backend.jobState(promptId, outputs);
    if (st.state === 'done') {
      const img = st.images[0];
      if (!img) return json({ error: 'The repair finished without saving an image.' }, 502);
      const { bytes } = await backend.fetchImage(img);
      const face = parseFace(st.texts?.[FACE_NODE_ID]);
      touchPhotoGpu();
      return json({
        seconds: Math.round((Date.now() - t0) / 1000),
        image: bytes.toString('base64'),
        similarity: face?.available ? face.similarity : null,
        fixes: fix.summary,
        positive,
      });
    }
    if (st.state === 'error') return json({ error: st.message, details: st.details }, 500);
    if (Date.now() - t0 > body.timeoutSec * 1000) {
      await backend.interrupt().catch(() => {});
      return json({ error: `Gave up after ${body.timeoutSec} s; the GPU job was interrupted.` }, 504);
    }
  }
});
