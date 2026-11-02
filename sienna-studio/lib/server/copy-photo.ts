import 'server-only';
import { NUDE_RE } from '../ai-prompts';
import { bustPhrases, bustWords, COPY_EYEWEAR_AVOID, copyKeepsEyewear, dropEyewear, dropStudEarrings, COPY_BODY_PACKS, buildCopyGateGraph, cleanCaption, COPY_CAPTION_NODE, COPY_EXPOSURE_NODE, COPY_GARMENT_STRENGTH, COPY_WHY, copyGarmentPhrases, copyRequestText } from '../copy-photo';
import { buildGarmentIsolationGraph, GARMENT_ISOLATE_NODE, OUTFIT_PREVIEW_NODE } from '../outfit';
import { parseExposure } from '../exposure';
import { interpretPrompt } from '../interpret';
import { offeredGuides } from '../pose-presets';
import { createBackend } from '../comfy/client';
import type { GenerateRequest, StoredImage } from '../types';
import { aiDescribePhoto, aiEnabled, aiRead } from './ai';
import { queueImageJob, settledJobState } from './jobs';
import { applyAiReading } from './reading';
import { readLessons } from './copy-lessons';
import { lessonsFor } from '../copy-lessons';
import { sceneSize } from '../comfy/keep-scene';
import { GARMENT_PACK_IDS } from '../style-packs';
import { adultContentAllowed, getComfyUrl, getSettings, mimeFromBytes, readImage, storeImage } from './store';

const GATE_TIMEOUT_MS = 4 * 60_000;
// 0.85 kept her hand on the bikini string but threw her head back (the photo's sunglasses confuse the head points): 0.75
const COPY_POSE_STRENGTH = 0.75;
/** Source-locked copy: the photo's own pose and hands, held firmly. */
const COPY_LOCK_POSE_STRENGTH = 0.9;
/** Source-locked copy (testing switch, or SIENNA_COPY_SOURCE_LOCK=on): nothing about the photo's garment is adapted. */
export function copySourceLocked(req: GenerateRequest): boolean {
  return req.params.copySourceLock ?? process.env.SIENNA_COPY_SOURCE_LOCK === 'on';
}
// the Natural skin pack's tested strength (above 0.4 her face starts to change)
const COPY_SKIN_PACK = 0.3;
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
  // the pose guide held harder than a normal request's 0.65: her hands went elsewhere (behind her back, under her breast)
  // where the photo's pulled the bikini string at her hip (1 Nov)
  const scene = keepScene ? { ...sceneSize(ref.width ?? 0, ref.height ?? 0), keepScene: true, denoise: 1, hires: false, controlStrength: copySourceLocked(req) ? COPY_LOCK_POSE_STRENGTH : COPY_POSE_STRENGTH } : {};
  const sceneImages = keepScene ? { initImage: ref } : {};
  const sceneNote = keepScene ? ['The photo itself is kept as the picture; only the person in it (and any app buttons or text on a screenshot) is redrawn, as Sienna.'] : [];
  let description = '';
  let by: 'ai' | 'gpu-caption' | undefined;
  let nudePhoto = true;
  let error: string | undefined;
  let aiFailed: string | undefined;
  let bustAnswer: { size: string; gap: string } | undefined;
  try {
    const g = await gate(req);
    nudePhoto = !g.exposure?.available || g.exposure.exposed;
    if (aiEnabled() && !nudePhoto && !NUDE_RE.test(copy.userText)) {
      const { bytes, mime } = await readImage(req.images.poseImage.file);
      const d = await aiDescribePhoto(bytes, mime);
      if ('description' in d) [description, by, bustAnswer] = [d.description, 'ai', d.bust];
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
  // the AI's fixed answers win over its prose (the prose said "pressed close" for a bust with a clear gap, 1 Nov)
  const BUST_TALK = /[^,]*\b(breasts?|bust|cleavage)\b[^,]*/gi;
  if (bustAnswer) {
    const w = bustWords(bustAnswer);
    for (const k of ['outfit', 'bodyPresentation'] as const)
      it.fields[k] = it.fields[k].replace(BUST_TALK, (m) => (/\b(bikini|cups?|top|bra|strings?|fabric|ring|straps?|cover)/i.test(m) ? m.replace(/,?\s*(deep cleavage|cleavage line)\b/gi, '') : '')).replace(/(,\s*){2,}/g, ', ').replace(/^,\s*|,\s*$/g, '');
    it.fields.bodyPresentation = [it.fields.bodyPresentation, w.positive].filter(Boolean).join(', ');
    if (w.avoid) it.fields.avoid = [it.fields.avoid, w.avoid].filter(Boolean).join(', ');
  }
  // what the AI checker grades against: the same bust as the prompt, not the prose it replaced
  const checkText = bustAnswer
    ? `${text.replace(BUST_TALK, (m) => (/\b(bikini|cups?|top|bra|strings?|fabric|ring|straps?|cover)/i.test(m) ? m : '')).replace(/(,\s*){2,}/g, ', ')}. Her bust: ${bustWords(bustAnswer).positive.replace(/[()]|:[\d.]+/g, '')}.`
    : text;
  if (!bustAnswer) {
    const bust = bustPhrases(description).filter((b) => !it.fields.bodyPresentation.toLowerCase().includes(b.toLowerCase()));
    if (bust.length) it.fields.bodyPresentation = [it.fields.bodyPresentation, ...bust].filter(Boolean).join(', ');
  }
  for (const id of COPY_BODY_PACKS) delete it.packs[id];
  // a micro top: the Natural skin pack and the soft-breast wording made every boat try bare the nipples beside its tiny
  // cups (three runs in a row, 1 Nov; the same photo passed before them), so they stay off
  const microTop = /\b(micro|tiny|very small|sliver|narrow)\b[^,]*\b(cups?|top|triangles?)\b/i.test(it.fields.outfit);
  // a cup is always centred over the nipple: "cups set slightly toward the outer sides" left the nipples bare on every
  // try of the boat copy (1 Nov)
  // (source-locked: the photo's cups stay where they are; if that bares a nipple the copy is rejected, never redesigned)
  const locked = copySourceLocked(req);
  for (const k of ['outfit', 'bodyPresentation'] as const)
    if (!locked) it.fields[k] = it.fields[k].replace(/,?\s*[^,]*\bcups?\b[^,]*\b(?:toward|towards|to|on)\s+the\s+(?:outer|inner)\s+(?:sides?|edges?)\b[^,]*/gi, '').replace(/^,\s*/, '').trim();
  // a see-through top is copied as an opaque one: the top check rejects any nipple showing through, so every try of a
  // sheer copy was thrown away (boat photo, 1 Nov)
  let sheerNote = '';
  if (!locked && /\b(sheer|see-through|transparent)\b/i.test(it.fields.outfit)) {
    it.fields.outfit = it.fields.outfit.replace(/,?\s*\b(?:slightly |semi-?|very |thin,? )?(?:sheer|see-through|transparent)\b(?:\s+white)?/gi, (m) => (/white/i.test(m) ? ' white' : '')).replace(/\s{2,}/g, ' ').trim();
    sheerNote = 'The photo’s top is see-through; the copy’s is opaque, as see-through tops showing nipples aren’t allowed.';
  }
  // what earlier copies kept getting wrong, avoided here too (never something this photo shows)
  const learned = process.env.SIENNA_COPY_LESSONS === 'off' ? [] : lessonsFor(await readLessons(), `${description} ${copy.userText}`);
  if (learned.length) it.fields.avoid = [it.fields.avoid, ...learned.map((l) => l.phrase)].filter(Boolean).join(', ');
  const learnedNote = learned.length ? `Learned from earlier copies, avoided here: ${learned.map((l) => `${l.phrase} (${l.count}×)`).join(', ')}.` : '';
  // small stud earrings are left off and earrings avoided: the words drew gold hoops (1 Nov)
  let studs = false;
  {
    for (const k of Object.keys(it.fields) as (keyof typeof it.fields)[]) {
      if (k === 'avoid' || typeof it.fields[k] !== 'string') continue;
      const d = dropStudEarrings(it.fields[k] as string);
      if (d.dropped) [studs, (it.fields as unknown as Record<string, string>)[k]] = [true, d.text];
    }
    if (studs) it.fields.avoid = [it.fields.avoid, 'earrings, hoop earrings'].filter(Boolean).join(', ');
  }
  // sunglasses are left off (SIENNA_COPY_EYEWEAR=keep copies them): they hid her face, so the face check could
  // never confirm her and each copy went to Needs Review (1 Nov)
  let eyewearNote = '';
  let checked = studs ? dropStudEarrings(checkText).text : checkText;
  // every field: the reader also put them in the pose and expression ("eyes hidden behind sunglasses" at 1.4 drew them
  // back, 1 Nov)
  const EYEWEAR = /\b(sunglasses|glasses|shades|aviators|eyewear)\b/i;
  const fieldKeys = (Object.keys(it.fields) as (keyof typeof it.fields)[]).filter((k) => k !== 'avoid' && typeof it.fields[k] === 'string');
  if (!copyKeepsEyewear() && fieldKeys.some((k) => EYEWEAR.test(it.fields[k] as string))) {
    for (const k of fieldKeys) (it.fields as unknown as Record<string, string>)[k] = dropEyewear(it.fields[k] as string);
    it.fields.avoid = [it.fields.avoid, COPY_EYEWEAR_AVOID].filter(Boolean).join(', ');
    checked = `${dropEyewear(checked)}. No sunglasses or glasses: her eyes are uncovered.`;
    eyewearNote = 'The photo’s sunglasses were left off so her face shows and can be confirmed as Sienna.';
  }
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
      // Natural skin (matte, pores) on every copy: the copies' skin and body looked airbrushed (1 Nov)
      // no outfit pack on a copy: the photo's own garment outline shapes it, and the reader's Micro bikini pack at 0.85
      // shrank the cups off the nipples on every try of the boat copy (1 Nov)
      stylePacks: { ...(garment || keepScene ? Object.fromEntries(Object.entries(it.packs).filter(([id]) => !GARMENT_PACK_IDS.has(id))) : it.packs), ...(it.packs.natural_skin === undefined && !microTop ? { natural_skin: COPY_SKIN_PACK } : {}) },
      posePreset: null,
      ...(aiRan ? { autoPosePreset: false } : {}),
      ...(garment ? { outfitIsolation: 'garment' as const, outfitStrength: COPY_GARMENT_STRENGTH, outfitMode: 'design' as const } : {}),
      ...scene,
      ...(keepScene ? { keepSceneGarment: copyGarmentPhrases(it.fields.outfit) } : {}),
    },
    images: { ...req.images, ...sceneImages, ...(garment ? { outfitImage: req.images.poseImage, outfitGarmentImage: garment } : {}) },
    simple: {
      ...simple,
      notes: [...it.notes, ...sceneNote, `Your photo, ${how}: ${description}`, ...(garmentNote ? [garmentNote] : []), ...(eyewearNote ? [eyewearNote] : []), ...(learnedNote ? [learnedNote] : []), ...(sheerNote ? [sheerNote] : [])],
      ai: { ...(simple.ai ?? { read: false, check: false }), read: aiRan, check: !!simple.ai?.check && aiOk },
      copy: { ...copy, status: 'done', description, by, text: checked },
    },
  };
}
