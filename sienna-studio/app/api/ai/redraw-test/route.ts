import { z } from 'zod';
import { addImageRedraw, stripKeepPerson } from '@/lib/comfy/keep-person';
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
  id: z.string().min(1),
  attempt: z.number().int().min(0),
  /** start image (PNG, base64) and optional mask (PNG, white = redraw) */
  init: z.string().min(100).max(20_000_000),
  mask: z.string().min(100).max(20_000_000).optional(),
  denoise: z.number().min(0.05).max(1),
  /** 'room': the attempt's prompt plus its room and light fixes; 'base': the original prompt */
  prompt: z.enum(['room', 'base']),
  timeoutSec: z.number().int().min(30).max(240).default(120),
});

/**
 * Test only: one redraw of a saved attempt from a given start image (and mask) with that attempt's model, LoRA, face
 * reference, seed and prompt. No retries, no AI call. Needs the photo GPU running; never starts it.
 */
export const POST = handle(async (req: Request) => {
  const body = await parseBody(req, schema);
  if (photoGpuEnabled() && !(await photoGpuReady())) return json({ error: 'The photo GPU is not running.' }, 503);
  const rec = await getRecord(body.id);
  const guard = rec?.exposureGuard;
  const a = guard?.attempts[body.attempt];
  if (!rec?.submittedGraph || !guard || !a) return json({ error: 'No such photo attempt.' }, 404);
  const base = guard.base ?? { positive: rec.positivePrompt, negative: rec.negativePrompt };
  let graph = stripKeepPerson(swapPrompts(rec.submittedGraph, { positive: rec.positivePrompt, negative: rec.negativePrompt }, base));
  graph = reseed(graph, rec.seed, a.seed);
  let prompts = base;
  let fixes: string[] = [];
  if (body.prompt === 'room') {
    const fix = buildCorrection(backgroundFixes(a.aiFixes ?? []), base, 6);
    prompts = { positive: placeCorrection(base.positive, fix.positive, guard.anchor), negative: fix.negative ? `${base.negative}, ${fix.negative}` : base.negative };
    fixes = fix.summary;
  }
  graph = swapPrompts(graph, base, prompts);
  const backend = createBackend(await getComfyUrl());
  const tag = `${rec.id}_${body.attempt}_${Date.now()}`;
  const init = await backend.uploadImage(Buffer.from(body.init, 'base64'), `redraw_init_${tag}.png`, 'image/png');
  const mask = body.mask ? await backend.uploadImage(Buffer.from(body.mask, 'base64'), `redraw_mask_${tag}.png`, 'image/png') : undefined;
  const g = addImageRedraw(graph, init, body.denoise, mask);
  if (!g) return json({ error: 'This workflow has no first pass to redraw from.' }, 400);
  const t0 = Date.now();
  touchPhotoGpu();
  const { promptId } = await backend.queuePrompt(g, newId('redraw-'));
  const outputs = (await getWorkflow(rec.workflowId))?.outputNodeIds ?? [];
  while (true) {
    await new Promise((r) => setTimeout(r, 3000));
    const st = await backend.jobState(promptId, outputs);
    if (st.state === 'done') {
      const { bytes } = await backend.fetchImage(st.images[0]);
      const face = parseFace(st.texts?.[FACE_NODE_ID]);
      touchPhotoGpu();
      return json({ seconds: Math.round((Date.now() - t0) / 1000), image: bytes.toString('base64'), similarity: face?.available ? face.similarity : null, fixes, positive: prompts.positive });
    }
    if (st.state === 'error') return json({ error: st.message, details: st.details }, 500);
    if (Date.now() - t0 > body.timeoutSec * 1000) {
      await backend.interrupt().catch(() => {});
      return json({ error: `Gave up after ${body.timeoutSec} s; the GPU job was interrupted.` }, 504);
    }
  }
});
