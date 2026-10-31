import 'server-only';
import { NUDE_RE } from '../ai-prompts';
import { bustPhrases, COPY_BODY_PACKS, buildCopyGateGraph, cleanCaption, COPY_CAPTION_NODE, COPY_EXPOSURE_NODE, COPY_GARMENT_STRENGTH, COPY_WHY, copyGarmentPhrases, copyRequestText } from '../copy-photo';
import { buildGarmentIsolationGraph, GARMENT_ISOLATE_NODE, OUTFIT_PREVIEW_NODE } from '../outfit';
import { parseExposure } from '../exposure';
import { interpretPrompt } from '../interpret';
import { offeredGuides } from '../pose-presets';
import { createBackend } from '../comfy/client';
import type { GenerateRequest, StoredImage } from '../types';
import { aiDescribePhoto, aiEnabled, aiRead } from './ai';
import { queueImageJob, settledJobState } from './jobs';
import { applyAiReading } from './reading';
import { sceneSize } from '../comfy/keep-scene';
import { GARMENT_PACK_IDS } from '../style-packs';
import { adultContentAllowed, getComfyUrl, getSettings, mimeFromBytes, readImage, storeImage } from './store';

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

/** Runs a small graph on the photo and waits for it (the photo GPU is up: this runs just before the photo is made). */
async function runJob(ref: StoredImage, build: (name: string) => import('../types').ComfyGraph, what: string, prefix: string) {
  const { promptId } = await queueImageJob(ref, build, what, prefix);
  const backend = createBackend(await getComfyUrl());
  const until = Date.now() + GATE_TIMEOUT_MS;
  while (Date.now() < until) {
    const s = await settledJobState(backend, promptId);
    if (s.state === 'done') return { s, backend };
    if (s.state === 'error' || s.state === 'unknown') throw new Error(s.state === 'error' ? s.message : 'the GPU lost the job');
    await sleep(2000);
  }
  throw new Error('it took too long');
}

/**
 * The garment cut out of the photo (Florence-2 segments the named pieces; face, hair and body are replaced by a flat
 * silhouette), for the outfit IP-Adapter: words drew an ordinary triangle top where the photo had tall, narrow sliver
 * cups (31 Oct). Null when no garment was found (a nude photo, or nothing segmented): never the whole person.
 */
async function garmentCrop(ref: StoredImage, outfit: string): Promise<StoredImage | null> {
  const phrases = copyGarmentPhrases(outfit);
  if (!phrases.length) return null;
  const { s, backend } = await runJob(ref, (name) => buildGarmentIsolationGraph(name, phrases), 'Cutting out the outfit', 'copygarment-');
  if (s.texts?.[GARMENT_ISOLATE_NODE]?.[0] !== 'garment') return null;
  const img = s.images.find((i) => i.nodeId === OUTFIT_PREVIEW_NODE);
  if (!img) return null;
  const { bytes, mime } = await backend.fetchImage(img);
  return storeImage(bytes, mimeFromBytes(bytes) ?? mime, 'up', 'Copy Photo: garment cut out of the photo');
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
  // keep-scene (default): the photo itself is the picture, at its own shape; only the person is redrawn
  const ref = req.images.poseImage;
  const keepScene = process.env.SIENNA_COPY_SCENE !== 'off';
  const scene = keepScene ? { ...sceneSize(ref.width ?? 0, ref.height ?? 0), keepScene: true, denoise: 1, hires: false } : {};
  const sceneImages = keepScene ? { initImage: ref } : {};
  const sceneNote = keepScene ? ['The photo itself is kept as the picture; only the person in it (and any app buttons or text on a screenshot) is redrawn, as Sienna.'] : [];
  let description = '';
  let by: 'ai' | 'gpu-caption' | undefined;
  let nudePhoto = true;
  let error: string | undefined;
  let aiFailed: string | undefined;
  try {
    const g = await gate(req);
    nudePhoto = !g.exposure?.available || g.exposure.exposed;
    if (aiEnabled() && !nudePhoto && !NUDE_RE.test(copy.userText)) {
      const { bytes, mime } = await readImage(req.images.poseImage.file);
      const d = await aiDescribePhoto(bytes, mime);
      if ('description' in d) [description, by] = [d.description, 'ai'];
      else aiFailed = d.failed;
    }
    if (!description && g.caption) [description, by] = [g.caption, 'gpu-caption'];
  } catch (e: any) {
    error = `The photo couldn’t be read (${e?.message ?? e}): only its pose was copied.`;
    console.warn(`[copy-photo] ${req.images.poseImage.file}: ${e?.message ?? e}`);
  }
  if (!description) {
    return {
      ...req,
      params: { ...req.params, ...scene },
      images: { ...req.images, ...sceneImages },
      simple: { ...simple, notes: [...simple.notes, ...sceneNote, error ?? 'Nothing could be read from the photo: only its pose was copied.'], copy: { ...copy, status: 'done', error: error ?? 'nothing read' } },
    };
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
  // her figure as the photo shows it: the description's bust phrases, never a body-reshaping pack
  const bust = bustPhrases(description).filter((b) => !it.fields.bodyPresentation.toLowerCase().includes(b.toLowerCase()));
  if (bust.length) it.fields.bodyPresentation = [it.fields.bodyPresentation, ...bust].filter(Boolean).join(', ');
  if (/\b(gap|space|apart|no cleavage)\b/i.test(bust.join(' ')) && !/\bpressed (together|close)\b/i.test(bust.join(' '))) {
    for (const k of ['outfit', 'bodyPresentation'] as const) it.fields[k] = it.fields[k].replace(/,?\s*deep cleavage\b/gi, '');
    it.fields.avoid = [it.fields.avoid, 'deep cleavage, pushed-up breasts, breasts pressed together'].filter(Boolean).join(', ');
  }
  for (const id of COPY_BODY_PACKS) delete it.packs[id];
  const how =
    by === 'ai' ? 'described by the AI'
    : aiFailed ? `described by the GPU only, a much rougher description, because the AI couldn’t read it (${aiFailed})`
    : 'described by the GPU (no AI for photos with nudity)';
  // the outfit itself, as a picture (only for a photo with nothing exposed: a nude photo has no garment to copy)
  let garment: StoredImage | null = null;
  let garmentNote = '';
  // opt-in: in the first live test (31 Oct) the crop's grey background crept into the sky as a grey band and the cups
  // still came out as triangles
  if (!nudePhoto && process.env.SIENNA_COPY_GARMENT === 'on') {
    try {
      garment = await garmentCrop(req.images.poseImage, it.fields.outfit);
      garmentNote = garment ? 'The outfit was also cut out of your photo and used as a picture reference for its exact shape.' : 'No garment could be cut out of the photo: the outfit follows the description only.';
    } catch (e: any) {
      garmentNote = `The outfit couldn’t be cut out of the photo (${e?.message ?? e}): it follows the description only.`;
    }
  }
  return {
    ...req,
    fields: it.fields,
    contentMode: req.contentMode === 'adult' || it.contentMode === 'adult' ? 'adult' : it.contentMode,
    params: {
      ...req.params,
      // an outfit pack draws its own garment over the photo's (String Swimsuit drew ordinary triangle cups)
      stylePacks: garment ? Object.fromEntries(Object.entries(it.packs).filter(([id]) => !GARMENT_PACK_IDS.has(id))) : it.packs,
      posePreset: null,
      ...(aiRan ? { autoPosePreset: false } : {}),
      ...(garment ? { outfitIsolation: 'garment' as const, outfitStrength: COPY_GARMENT_STRENGTH, outfitMode: 'design' as const } : {}),
      ...scene,
      ...(keepScene ? { keepSceneGarment: copyGarmentPhrases(it.fields.outfit) } : {}),
    },
    images: { ...req.images, ...sceneImages, ...(garment ? { outfitImage: req.images.poseImage, outfitGarmentImage: garment } : {}) },
    simple: {
      ...simple,
      notes: [...it.notes, ...sceneNote, `Your photo, ${how}: ${description}`, ...(garmentNote ? [garmentNote] : [])],
      ai: { ...(simple.ai ?? { read: false, check: false }), read: aiRan, check: !!simple.ai?.check && aiOk },
      copy: { ...copy, status: 'done', description, by, text },
    },
  };
}
