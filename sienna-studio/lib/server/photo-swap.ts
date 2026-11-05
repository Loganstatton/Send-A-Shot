/**
 * Photo Swap: a photo from the cleared library (a model the owner confirmed agreed to her photos being used with
 * Sienna's face) with Sienna in place of the woman in it. Qwen-Image-Edit-2511 takes the photo and Sienna's face
 * reference and keeps everything but her face and hair; Sienna's FaceDetailer (her LoRA) then redraws the face.
 *
 * Only cleared photos can be swapped: any other photo goes through Copy Photo, which redraws the whole person (the owner,
 * 5 Nov: the record of who she is and that she agreed is what separates a cleared photo from anyone's screenshot).
 *
 * Results are history records like Edit Outfit's (their status polling and face check are reused); a swap also runs
 * the nudity check, and in SFW mode a result showing nudity is not kept.
 */
import 'server-only';
import { ComfyError, createBackend } from '../comfy/client';
import { MIN_CHARACTER_AGE } from '../defaults';
import { EXPOSURE_NODE_ID, exposureNode } from '../exposure';
import { buildOutfitEditGraph, EDIT_NODES, type FaceRestoreSpec } from '../outfit-edit';
import { buildPrompt } from '../prompt';
import { resolveLockedLora } from '../sienna-models';
import { FACE_NODE_ID, faceNode } from '../identity';
import { UI_MASK_CLASS } from '../comfy/keep-scene';
import { EMPTY_FIELDS } from '../defaults';
import type { ContentMode, GenerationRecord, StoredImage } from '../types';
import { describeMissing, GenerationError, missingClasses } from './generate';
import { productionDetailerInputs } from './outfit-edit';
import { ensurePhotoGpu, photoGpuEnabled, photoGpuReady, touchPhotoGpu } from './photo-gpu';
import { preflight } from './jobs';
import { adultContentAllowed, getCharacter, getClearedPhoto, getComfyUrl, getSettings, listHistory, newId, readImage, saveRecord } from './store';

export const PHOTO_SWAP_WORKFLOW_ID = 'photo-swap-qwen';
export const PHOTO_SWAP_WORKFLOW_NAME = 'Photo Swap · Qwen-Image-Edit-2511';
/** Qwen-Image-Edit (2509) ran out of memory on the 24 GB RTX 4090 (18 Oct). */
export const SWAP_MIN_VRAM_GB = 32;
/** The face redraw after the swap: its working size and strength. */
// 384 / 0.45 left a small face soft (0.63); 768 / 0.5 sharp but generic (0.54); 512 / 0.45 in between (5 Nov)
export const SWAP_FACE_GUIDE = 512;
export const SWAP_FACE_DENOISE = 0.45;

/** Her whole face from picture 2, nothing of picture 1's; everything else kept (the wording the 5 Nov test used). */
/** Her whole face from picture 2, nothing of picture 1's; everything else kept. No garment words: asked to keep
 * "straps, strings and gathers", the editor put a bikini on a woman in a towel (5 Nov). */
/** Her face from picture 2, her hair keeps picture 1's style and only changes colour (asked for Sienna's "long dark-brown
 * hair", the editor drew a flat, airbrushed wig, 5 Nov), nothing else changed. Mirrors are not mentioned: asked to
 * change her reflection too, the editor invented a large new mirror with a second her in it (5 Nov). */
export const SWAP_PROMPT =
  'Replace the woman in Picture 1 with the woman from Picture 2. Her whole face must be the face of the woman in Picture 2, with nothing of the face in ' +
  "Picture 1: Picture 2's face shape, eyes, nose, lips, freckles and eyebrows, and her light skin tone. Her hair keeps Picture 1's hairstyle exactly (how it " +
  'falls, its length, volume, parting and fine loose strands, natural real hair texture), only its colour changes to dark brown with softly lighter brown ' +
  'ends. Take nothing else from Picture 2. Keep everything else in Picture 1 exactly as it is: her clothing exactly as it is (add, remove or change nothing ' +
  'she is wearing or holding), her pose and head angle, her hands and fingers, her body shape, how her skin looks, the lighting and shadows, the background ' +
  'and the camera framing. Her face is ' +
  'uncovered: no sunglasses or glasses. Her skin is clear: remove any tattoo in Picture 1. No text, icons or app interface: where Picture 1 has blurred or ' +
  'smudged patches (app buttons painted out), paint in the scene that belongs there, as sharp as the rest of the photo.';
/** Enough to give the painted-out patch texture, not enough to invent objects (0.8 drew rocks). */
export const SWAP_SCENE_DENOISE = 0.55;
export const SWAP_SCENE_POSITIVE = 'the same surface continued seamlessly, natural photo texture, sharp';
export const SWAP_SCENE_NEGATIVE = 'text, letters, numbers, icons, logo, buttons, watermark, person, face, hand, rock, boulder, ice, crystal, object, blur, smudge';
export const SWAP_NEGATIVE = 'airbrushed hair, painted hair, wig, flat hair, blonde hair, different clothing, changed outfit, sunglasses, glasses, tattoo, text, watermark, extra fingers, deformed hands, blurry, cartoon';

export interface PhotoSwapRequest {
  clearedId: string;
  seed: number;
  /** Testing: the face redraw's strength (default SWAP_FACE_DENOISE). */
  faceDenoise?: number;
}

/** Photo jobs still using the photo GPU. */
const photoBusy = (r: GenerationRecord) => !r.video && (r.status === 'queued' || r.status === 'running');

/**
 * The photo GPU, big enough for a swap. While it starts (or a smaller one finishes its photos) this answers 503 and
 * the page tries again.
 */
async function wakeSwapGpu(): Promise<void> {
  if (!photoGpuEnabled()) return;
  const busy = (await listHistory()).filter(photoBusy).length;
  try {
    const s = await ensurePhotoGpu({ minVramGb: SWAP_MIN_VRAM_GB, replaceIdle: busy === 0 });
    if (s.status === 'ready' && (await photoGpuReady())) return;
  } catch (e: any) {
    throw new GenerationError(e.message, e?.status === 402 ? 402 : 503);
  }
  throw new GenerationError('The photo GPU for Photo Swap is starting (a 32 GB or larger one; usually 1–3 minutes). Try again in a moment.', 503);
}

export async function startPhotoSwap(req: PhotoSwapRequest): Promise<GenerationRecord> {
  const cleared = await getClearedPhoto(req.clearedId);
  if (!cleared) throw new GenerationError('Only photos in the cleared library can be swapped. Add the photo there first (her name or handle and that she agreed).', 404);
  if (cleared.adult !== true) throw new GenerationError(`Confirm that ${cleared.model} is 18 or older before swapping this photo (Swap tab: Confirm 18+).`, 403);
  const [settings, character] = await Promise.all([getSettings(), getCharacter()]);
  if ((character.age ?? 0) < MIN_CHARACTER_AGE) throw new GenerationError(`The character profile age must be at least ${MIN_CHARACTER_AGE}.`);
  if (!character.faceReference) throw new GenerationError('Photo Swap needs Sienna’s face reference (set it on the Sienna page).');
  await wakeSwapGpu();

  const backend = createBackend(await getComfyUrl());
  const warnings: string[] = [];
  const contentMode: ContentMode = settings.contentMode === 'adult' && adultContentAllowed() ? 'adult' : 'sfw';
  const seed = req.seed >= 0 ? Math.floor(req.seed) : Math.floor(Math.random() * 2 ** 48);

  // Sienna's FaceDetailer with her LoRA, as Edit Outfit runs it
  const prod = productionDetailerInputs();
  const d = settings.defaultParams;
  const loraFile = resolveLockedLora(character.loraFilename, d.siennaModel).file;
  const lora = loraFile ? { name: loraFile, strength: d.loraStrength, clipStrength: d.loraClipStrength, injected: false } : null;
  if (!lora) warnings.push('Face redraw skipped — no Sienna LoRA is set in the profile.');
  const built = buildPrompt({ fields: { ...EMPTY_FIELDS }, character, siennaLock: true, contentMode });
  const faceRestore: FaceRestoreSpec | null = lora
    ? {
        // the strong redraw: at the standard 0.3 the swapped face scored 0.54 against Sienna (0.74 needed), 5 Nov
        denoise: req.faceDenoise ?? SWAP_FACE_DENOISE,
        checkpoint: d.checkpoint || prod.checkpoint,
        lora: { name: lora.name, strength: lora.strength, clipStrength: lora.clipStrength },
        positive: built.positive,
        negative: built.negative,
        // the face rebuilt at 768 px: the editor works at about 1 MP, so a small face in a large photo came back ~80 px wide
        // and, scaled up, soft and smudged; at 384 the redraw could not sharpen it (lavender hot tub, 5 Nov)
        detailerInputs: { ...prod.inputs, guide_size: SWAP_FACE_GUIDE, max_size: 1536 },
      }
    : null;

  const photo = cleared.image;
  const sourceSize = { width: photo.width ?? 832, height: photo.height ?? 1216 };
  const uiClean = backend.kind !== 'mock' && !!(await backend.nodeInfo(UI_MASK_CLASS).catch(() => null));
  if (!uiClean) warnings.push('The GPU server has no app-overlay remover (SiennaUiMask): screenshot icons and text may stay.');
  const graphFor = (sourceName: string, referenceName: string) => {
    const g = buildOutfitEditGraph({ sourceName, sourceSize, referenceName, autoCrop: false, prompt: SWAP_PROMPT, negativePrompt: SWAP_NEGATIVE, seed, faceRestore });
    // the save node's prefix says what it is
    g[EDIT_NODES.final] = { ...g[EDIT_NODES.final], inputs: { ...g[EDIT_NODES.final].inputs, filename_prefix: 'sienna/photo-swap' } };
    // (IP-Adapter Plus Face in this redraw, 0.8, overcooked the face: orange patches, a pasted box, 0.35 against Sienna,
    // lavender hot tub, 5 Nov; not used)
    // a screenshot's app overlays painted out first: the account's profile picture (her face) stayed in the corner
    // of the first live swap, 5 Nov
    if (uiClean) {
      g.swap_ui = { class_type: UI_MASK_CLASS, inputs: { image: ['src', 0] }, _meta: { title: 'Photo Swap: app overlays painted out' } };
      g.src_scale = { ...g.src_scale, inputs: { ...g.src_scale.inputs, image: ['swap_ui', 2] } };
      // ... and those patches redrawn as the scene afterwards, with Sienna's checkpoint: the editor kept the painted-out
      // smudges, blurry, in the white-bikini swap (5 Nov). An empty mask (no overlays) changes nothing.
      if (g.fr_ckpt) {
        const img = g[EDIT_NODES.final].inputs.images as [string, number];
        Object.assign(g, {
          swap_uigrow: { class_type: 'GrowMask', inputs: { mask: ['swap_ui', 0], expand: 10, tapered_corners: true } },
          swap_uienc: { class_type: 'VAEEncode', inputs: { pixels: img, vae: ['fr_ckpt', 2] } },
          swap_uinoise: { class_type: 'SetLatentNoiseMask', inputs: { samples: ['swap_uienc', 0], mask: ['swap_uigrow', 0] } },
          swap_uipos: { class_type: 'CLIPTextEncode', inputs: { clip: ['fr_ckpt', 1], text: SWAP_SCENE_POSITIVE } },
          swap_uineg: { class_type: 'CLIPTextEncode', inputs: { clip: ['fr_ckpt', 1], text: SWAP_SCENE_NEGATIVE } },
          swap_uiks: {
            class_type: 'KSampler',
            inputs: { model: ['fr_ckpt', 0], positive: ['swap_uipos', 0], negative: ['swap_uineg', 0], latent_image: ['swap_uinoise', 0], seed, steps: 20, cfg: 5, sampler_name: 'dpmpp_2m', scheduler: 'karras', denoise: SWAP_SCENE_DENOISE },
            _meta: { title: 'Photo Swap: painted-out overlays redrawn as the scene' },
          },
          swap_uidec: { class_type: 'VAEDecode', inputs: { samples: ['swap_uiks', 0], vae: ['fr_ckpt', 2] } },
          swap_uifix: { class_type: 'ImageCompositeMasked', inputs: { destination: img, source: ['swap_uidec', 0], x: 0, y: 0, resize_source: false, mask: ['swap_uigrow', 0] } },
        });
        g[EDIT_NODES.final] = { ...g[EDIT_NODES.final], inputs: { ...g[EDIT_NODES.final].inputs, images: ['swap_uifix', 0] } };
      }
    }
    return g;
  };
  if (backend.kind !== 'mock') await preflight(backend, graphFor('probe.png', 'probe.png'), 'Photo Swap');

  const upload = async (img: StoredImage) => {
    const { bytes, mime } = await readImage(img.file);
    return backend.uploadImage(bytes, img.file, mime);
  };
  let graph;
  try {
    graph = graphFor(await upload(photo), await upload(character.faceReference));
  } catch (e) {
    if (e instanceof ComfyError) throw new GenerationError(`Uploading images failed: ${e.message}`, e.status, e.details);
    throw e;
  }

  // the face check (Sienna, the same rule as Create) and the nudity check (SFW mode keeps no nude result)
  let faceCheck: { status: 'on' } | { status: 'unavailable'; reason: string } = { status: 'unavailable', reason: 'the swap has no output to check' };
  const fNode = faceNode(graph, EDIT_NODES.final);
  const xNode = exposureNode(graph, EDIT_NODES.final);
  const extra = { ...(fNode ? { [FACE_NODE_ID]: fNode } : {}), ...(xNode ? { [EXPOSURE_NODE_ID]: xNode } : {}) };
  const missing = backend.kind === 'mock' ? [] : await missingClasses(backend, extra, Object.keys(extra));
  if (fNode && !missing.includes(fNode.class_type)) {
    graph = { ...graph, [FACE_NODE_ID]: fNode };
    faceCheck = { status: 'on' };
  } else if (fNode) faceCheck = { status: 'unavailable', reason: `the face check could not run (server is missing ${describeMissing([fNode.class_type])})` };
  if (xNode && !missing.includes(xNode.class_type)) graph = { ...graph, [EXPOSURE_NODE_ID]: xNode };
  else if (contentMode === 'sfw') throw new GenerationError('Photo Swap can’t run in SFW mode without the nudity check on the GPU server (SiennaExposureCheck).');

  const clientId = newId('sienna-swap-');
  const record: GenerationRecord = {
    id: newId('g'),
    createdAt: new Date().toISOString(),
    status: 'queued',
    clientId,
    backend: backend.kind,
    presetId: null,
    presetName: 'Photo swap',
    workflowId: PHOTO_SWAP_WORKFLOW_ID,
    workflowName: PHOTO_SWAP_WORKFLOW_NAME,
    siennaLock: true,
    contentMode,
    fields: { ...EMPTY_FIELDS },
    params: { ...d, seed, batchSize: 1, width: sourceSize.width, height: sourceSize.height },
    seed,
    positivePrompt: SWAP_PROMPT,
    negativePrompt: SWAP_NEGATIVE,
    lora,
    faceReference: character.faceReference,
    initImage: photo,
    poseImage: null,
    outfitReference: null,
    warnings,
    prunedModules: [],
    faceRefine: faceRestore ? { status: 'on', denoise: faceRestore.denoise } : { status: 'off', reason: 'no Sienna LoRA' },
    submittedGraph: graph,
    images: [],
    favorite: false,
    review: {},
    notes: '',
    identityPolicy: 1,
    editFaceCheck: faceCheck,
    swap: { clearedId: cleared.id, model: cleared.model },
    // the status polling and face check are Edit Outfit's
    outfitEdit: {
      model: 'qwen-image-edit-2511',
      sourceId: '',
      sourceImage: photo,
      imageIndex: 0,
      reference: character.faceReference,
      manualCrop: true,
      referenceCrop: null,
      crop: null,
      scope: 'full',
      footwear: 'keep',
      face: faceRestore ? 'strong' : 'off',
      description: 'Photo Swap',
      originalOutfit: '',
    },
  };
  try {
    const { promptId } = await backend.queuePrompt(graph, clientId);
    if (photoGpuEnabled()) await touchPhotoGpu().catch(() => {});
    return saveRecord({ ...record, promptId, promptAt: new Date().toISOString() });
  } catch (e) {
    if (!(e instanceof ComfyError)) throw e;
    return saveRecord({ ...record, status: 'error', error: e.message, errorDetails: e.details, completedAt: new Date().toISOString() });
  }
}
