import 'server-only';
import { NUDE_RE } from '../ai-prompts';
import { buildCopyGateGraph, cleanCaption, COPY_CAPTION_NODE, COPY_EXPOSURE_NODE, COPY_WHY, copyRequestText } from '../copy-photo';
import { parseExposure } from '../exposure';
import { interpretPrompt } from '../interpret';
import { offeredGuides } from '../pose-presets';
import { createBackend } from '../comfy/client';
import type { GenerateRequest } from '../types';
import { aiDescribePhoto, aiEnabled, aiRead } from './ai';
import { queueImageJob, settledJobState } from './jobs';
import { applyAiReading } from './reading';
import { adultContentAllowed, getComfyUrl, getSettings, readImage } from './store';

const GATE_TIMEOUT_MS = 4 * 60_000;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** The photo GPU's look at the photo: NudeNet's verdict and Florence-2's caption (null when the job failed). */
async function gate(req: GenerateRequest) {
  const ref = req.images.poseImage!;
  const { promptId } = await queueImageJob(ref, buildCopyGateGraph, 'Reading the photo', 'copy-');
  const backend = createBackend(await getComfyUrl());
  const until = Date.now() + GATE_TIMEOUT_MS;
  while (Date.now() < until) {
    const s = await settledJobState(backend, promptId);
    if (s.state === 'done') {
      return { exposure: parseExposure(s.texts?.[COPY_EXPOSURE_NODE]), caption: cleanCaption((s.texts?.[COPY_CAPTION_NODE] ?? []).join(' ')) };
    }
    if (s.state === 'error' || s.state === 'unknown') throw new Error(s.state === 'error' ? s.message : 'the GPU lost the job');
    await sleep(2000);
  }
  throw new Error('it took too long');
}

/**
 * Copy Photo, run when the photo GPU is up and before the photo is made: the uploaded photo read into words (the AI
 * for a photo with nothing exposed, else the GPU's own caption), then read into prompt fields like a typed
 * description. Never throws: when reading fails the request goes ahead as before (pose only, the owner's words).
 */
export async function readCopyPhoto(req: GenerateRequest): Promise<GenerateRequest> {
  const copy = req.simple?.copy;
  if (!copy || copy.status !== 'pending' || !req.images.poseImage || !req.simple) return req;
  const simple = req.simple;
  let description = '';
  let by: 'ai' | 'gpu-caption' | undefined;
  let nudePhoto = true;
  let error: string | undefined;
  try {
    const g = await gate(req);
    nudePhoto = !g.exposure?.available || g.exposure.exposed;
    if (aiEnabled() && !nudePhoto && !NUDE_RE.test(copy.userText)) {
      const { bytes, mime } = await readImage(req.images.poseImage.file);
      const d = await aiDescribePhoto(bytes, mime);
      if (d) [description, by] = [d.description, 'ai'];
    }
    if (!description && g.caption) [description, by] = [g.caption, 'gpu-caption'];
  } catch (e: any) {
    error = `The photo couldn’t be read (${e?.message ?? e}): only its pose was copied.`;
    console.warn(`[copy-photo] ${req.images.poseImage.file}: ${e?.message ?? e}`);
  }
  if (!description) {
    return { ...req, simple: { ...simple, notes: [...simple.notes, error ?? 'Nothing could be read from the photo: only its pose was copied.'], copy: { ...copy, status: 'done', error: error ?? 'nothing read' } } };
  }

  const text = copyRequestText(description, copy.userText);
  const settings = await getSettings();
  const adultOk = adultContentAllowed();
  const it = interpretPrompt(text, { hasReference: true, adultAllowed: adultOk, defaultMode: settings.contentMode });
  it.notes = it.notes.filter((n) => n !== it.reference.why);
  it.reference = { mode: 'pose', denoise: null, why: COPY_WHY };
  it.notes.push(COPY_WHY);
  // the AI reader never gets nudity; the GPU caption of a nude photo goes through the rule-based reader
  const aiOk = aiEnabled() && !NUDE_RE.test(text) && !nudePhoto;
  let aiRan = false;
  if (aiOk) {
    const guides = offeredGuides(process.env.SIENNA_POSE_GUIDE === 'true');
    const r = await aiRead(text, 'pose', adultOk, guides);
    if (r) {
      applyAiReading(it, r, text, adultOk, guides, true);
      aiRan = true;
    }
  }
  const how = by === 'ai' ? 'described by the AI' : 'described by the GPU (no AI for photos with nudity)';
  return {
    ...req,
    fields: it.fields,
    contentMode: req.contentMode === 'adult' || it.contentMode === 'adult' ? 'adult' : it.contentMode,
    params: { ...req.params, stylePacks: it.packs, posePreset: null, ...(aiRan ? { autoPosePreset: false } : {}) },
    simple: {
      ...simple,
      notes: [...it.notes, `Your photo, ${how}: ${description}`],
      ai: { ...(simple.ai ?? { read: false, check: false }), read: aiRan, check: !!simple.ai?.check && aiOk },
      copy: { ...copy, status: 'done', description, by, text },
    },
  };
}
