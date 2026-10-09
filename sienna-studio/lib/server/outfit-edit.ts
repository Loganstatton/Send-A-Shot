/**
 * Edit Outfit server side (see lib/outfit-edit.ts for the pipeline and the reasons behind it).
 *
 * Optional and off by default: the button and API only exist when SIENNA_OUTFIT_EDIT=true. It needs
 * the Qwen-Image-Edit-2509 files (~30 GB, `comfyui-bootstrap.sh --with-qwen-edit`) and the Sienna
 * custom nodes on the GPU server; availability() says what is missing.
 *
 * Results are new history records (parentId = the edited record) whose only image is the edit. The
 * source record and its files are never modified. Polling reuses GET /api/history/:id/status, which
 * routes edit records here.
 */

import 'server-only';
import { ComfyBackend, ComfyError, createBackend } from '../comfy/client';
import { builtinWorkflows, PRIMARY_WORKFLOW_ID } from '../comfy/builtin-workflows';
import { MIN_CHARACTER_AGE } from '../defaults';
import { applyIdentityLock } from '../guard';
import {
  bodyCheckWarnings,
  BodyProtect,
  buildEditPrompt,
  expectedPieces,
  legsHidden,
  NO_PROTECT,
  parseBodyReport,
  PERSON_SEGM_FILE,
  PROTECT_NODES,
  buildOutfitEditGraph,
  CROP_NOTES,
  EDIT_NODES,
  FACE_DENOISE,
  FaceRestoreSpec,
  OUTFIT_EDIT_NODE_CLASSES,
  OutfitEditFace,
  OutfitEditFootwear,
  OutfitEditScope,
  parseCropInfo,
  QWEN_EDIT_FILES,
  resultOutfitText,
} from '../outfit-edit';
import { buildPrompt } from '../prompt';
import { MIN_BODY_REFS } from '../body-refs';
import { resolveLockedLora } from '../sienna-models';
import type { ContentMode, GenerationRecord, StoredImage } from '../types';
import { describeMissing, GenerationError } from './generate';
import { preflight } from './jobs';
import {
  adultContentAllowed,
  experimentsEnabled,
  getCharacter,
  getComfyUrl,
  getRecord,
  getSettings,
  mimeFromBytes,
  newId,
  patchRecord,
  readImage,
  saveRecord,
  storeImage,
} from './store';

export const OUTFIT_EDIT_WORKFLOW_ID = 'outfit-edit-qwen';
export const OUTFIT_EDIT_WORKFLOW_NAME = 'Edit Outfit · Qwen-Image-Edit-2509';

export function outfitEditEnabled(): boolean {
  return process.env.SIENNA_OUTFIT_EDIT === 'true';
}

export interface OutfitEditRequest {
  sourceId: string;
  /** Which image of the source record (records can hold a batch). */
  imageIndex: number;
  reference: StoredImage;
  /** The reference was already cropped by hand in the editor: skip the automatic crop. */
  manualCrop: boolean;
  description: string;
  scope: OutfitEditScope;
  footwear: OutfitEditFootwear;
  face: OutfitEditFace;
  /** -1 = random */
  seed: number;
  /** Experimental body protection; ignored unless SIENNA_EXPERIMENTAL=true. */
  protect?: Partial<BodyProtect>;
}

export interface OutfitEditAvailability {
  enabled: boolean;
  available: boolean;
  backend: 'comfyui' | 'mock';
  missing: string[];
  /** Experimental body protection: whether shown at all, and what each option still needs. */
  experiments: boolean;
  protectMissing: Record<keyof BodyProtect, string[]>;
  bodyRefCount: number;
}

/** What the GPU server lacks for Edit Outfit (node packages and model files). */
export async function availability(): Promise<OutfitEditAvailability> {
  const enabled = outfitEditEnabled();
  const backend = createBackend(await getComfyUrl());
  const experiments = experimentsEnabled();
  const bodyRefCount = (await getCharacter()).bodyReferences?.length ?? 0;
  const protectMissing: Record<keyof BodyProtect, string[]> = { garmentOnly: [], bodyRef: [], bodyCheck: [] };
  const base = { enabled, backend: backend.kind, experiments, bodyRefCount };
  if (!enabled) return { ...base, available: false, missing: [], protectMissing };
  if (bodyRefCount < MIN_BODY_REFS) protectMissing.bodyRef.push(`${MIN_BODY_REFS} approved body references (${bodyRefCount} chosen)`);
  if (backend.kind === 'mock') return { ...base, available: true, missing: [], protectMissing };
  if (experiments) {
    for (const key of Object.keys(PROTECT_NODES) as (keyof BodyProtect)[]) {
      const absent: string[] = [];
      for (const c of PROTECT_NODES[key]) {
        try {
          if (!(await backend.nodeInfo(c))) absent.push(c);
        } catch {}
      }
      if (absent.length) protectMissing[key].push(describeMissing(absent));
    }
    try {
      const segm = await backend.inputChoices('UltralyticsDetectorProvider', 'model_name');
      if (segm.length && !segm.includes(PERSON_SEGM_FILE)) for (const k of ['garmentOnly', 'bodyCheck'] as const) protectMissing[k].push(`model file ${PERSON_SEGM_FILE}`);
    } catch {}
  }
  const missing: string[] = [];
  try {
    const absent: string[] = [];
    await Promise.all(
      OUTFIT_EDIT_NODE_CLASSES.map(async (c) => {
        if (!(await backend.nodeInfo(c))) absent.push(c);
      }),
    );
    const core = absent.filter((c) => QWEN_CORE_NODES.includes(c));
    const sienna = absent.filter((c) => c.startsWith('Sienna'));
    const other = absent.filter((c) => !core.includes(c) && !sienna.includes(c));
    if (core.length) missing.push(`${core.sort().join(', ')} (built into ComfyUI since September 2025 — update ComfyUI)`);
    if (sienna.length) missing.push(`${sienna.join(', ')} (Sienna nodes — run comfyui-bootstrap.sh --with-qwen-edit)`);
    if (other.length) missing.push(describeMissing(other.sort()));
    const files: [string, string, string][] = [
      ['UNETLoader', 'unet_name', QWEN_EDIT_FILES.unet],
      ['CLIPLoader', 'clip_name', QWEN_EDIT_FILES.clip],
      ['VAELoader', 'vae_name', QWEN_EDIT_FILES.vae],
    ];
    for (const [cls, input, file] of files) {
      const choices = await backend.inputChoices(cls, input);
      if (!choices.includes(file)) missing.push(`model file ${file}`);
    }
  } catch (e: any) {
    missing.push(`GPU server not reachable (${e.message})`);
  }
  return { ...base, available: missing.length === 0, missing, protectMissing };
}

const QWEN_CORE_NODES = ['TextEncodeQwenImageEditPlus', 'ModelSamplingAuraFlow', 'CFGNorm'];

const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, Number.isFinite(n) ? n : lo));

/** Static (non-link) inputs of the production workflow's FaceDetailer — "our existing Sienna FaceDetailer". */
function productionDetailerInputs(): { inputs: Record<string, unknown>; checkpoint: string } {
  const wf = builtinWorkflows().find((w) => w.id === PRIMARY_WORKFLOW_ID)!;
  const id = wf.bindings.face_refine_denoise?.[0]?.nodeId;
  const node = id ? wf.graph[id] : undefined;
  if (!node || node.class_type !== 'FaceDetailer') throw new GenerationError('The production workflow has no FaceDetailer to copy settings from.', 500);
  const inputs = Object.fromEntries(Object.entries(node.inputs).filter(([, v]) => !Array.isArray(v)));
  const ckptNode = Object.values(wf.graph).find((n) => n.class_type === 'CheckpointLoaderSimple');
  return { inputs, checkpoint: String(ckptNode?.inputs.ckpt_name ?? '') };
}

async function upload(backend: ComfyBackend, img: StoredImage) {
  const { bytes, mime } = await readImage(img.file);
  return backend.uploadImage(bytes, img.file, mime);
}

export async function startOutfitEdit(req: OutfitEditRequest): Promise<GenerationRecord> {
  if (!outfitEditEnabled()) throw new GenerationError('Edit Outfit is turned off on this server (SIENNA_OUTFIT_EDIT is not "true").', 403);
  const source = await getRecord(req.sourceId);
  if (!source) throw new GenerationError('The image to edit was not found.', 404);
  const sourceImage = source.images[req.imageIndex] ?? null;
  if (source.status !== 'done' || !sourceImage) throw new GenerationError('That generation has no finished image to edit.');

  const [settings, character, comfyUrl] = await Promise.all([getSettings(), getCharacter(), getComfyUrl()]);
  if ((character.age ?? 0) < MIN_CHARACTER_AGE) throw new GenerationError(`The character profile age must be at least ${MIN_CHARACTER_AGE}.`);
  const backend = createBackend(comfyUrl);
  const warnings: string[] = [];

  let contentMode: ContentMode = source.contentMode === 'adult' ? 'adult' : 'sfw';
  if (contentMode === 'adult' && !adultContentAllowed()) {
    contentMode = 'sfw';
    warnings.push('Adult mode is disabled on this server; edited as SFW.');
  }

  // The description goes through the same safety checks and Sienna Lock as the generator's outfit field.
  const lock = applyIdentityLock(req.description, character.extraLockedTerms);
  for (const r of lock.removed) warnings.push(`Sienna Lock removed “${r.term}” from the clothing description (${r.category} is locked).`);
  const description = lock.text.trim();
  if (!description) throw new GenerationError('Describe the clothing in the photo.');
  const originalOutfit = source.fields.outfit ?? '';
  const outfitAfter = resultOutfitText(req.scope, description, originalOutfit);
  const built = buildPrompt({ fields: { ...source.fields, outfit: outfitAfter }, character, siennaLock: true, contentMode });
  if (built.blocked.length) {
    throw new GenerationError(`Blocked: ${built.blocked.map((b) => `“${b.term}” — ${b.reason}`).join(' ')}`, 422, built.blocked);
  }

  // ── Experimental body protection ────────────────────────────────────────
  const protect: BodyProtect = experimentsEnabled() ? { ...NO_PROTECT, ...(req.protect ?? {}) } : NO_PROTECT;
  if (protect.garmentOnly && req.manualCrop) {
    protect.garmentOnly = false;
    warnings.push('Clothing-only isolation needs the uncropped photo (it learns the skin colour from the face) — skipped because the photo was cropped by hand.');
  }
  const bodyRefs = protect.bodyRef || protect.bodyCheck ? character.bodyReferences ?? [] : [];
  if (protect.bodyRef && bodyRefs.length < MIN_BODY_REFS) {
    throw new GenerationError(`“Use Sienna’s body references” needs at least ${MIN_BODY_REFS} approved body references (${bodyRefs.length} chosen on the Sienna page).`);
  }
  const prompt = buildEditPrompt({ scope: req.scope, description, originalOutfit, footwear: req.footwear, protect });
  const seed = req.seed >= 0 ? Math.floor(req.seed) : Math.floor(Math.random() * 2 ** 48);

  // ── Sienna FaceDetailer (production settings, Sienna LoRA) ──────────────
  let faceRestore: FaceRestoreSpec | null = null;
  let lora: GenerationRecord['lora'] = null;
  if (req.face !== 'off') {
    const prod = productionDetailerInputs();
    const d = settings.defaultParams;
    lora = source.lora
      ? { ...source.lora, injected: false }
      : (() => {
          const file = resolveLockedLora(character.loraFilename, source.params.siennaModel).file;
          return file ? { name: file, strength: clamp(d.loraStrength, -2, 2), clipStrength: clamp(d.loraClipStrength, -2, 2), injected: false } : null;
        })();
    if (!lora) {
      warnings.push('Face restore skipped — no Sienna LoRA is set in the profile.');
    } else {
      faceRestore = {
        denoise: FACE_DENOISE[req.face],
        checkpoint: source.params.checkpoint || d.checkpoint || prod.checkpoint,
        lora: { name: lora.name, strength: lora.strength, clipStrength: lora.clipStrength },
        positive: built.positive,
        negative: built.negative,
        detailerInputs: { ...prod.inputs, guide_size: Math.round(clamp(source.params.faceRefineThreshold || d.faceRefineThreshold, 64, 2048)) },
      };
    }
  }

  const sourceSize = { width: sourceImage.width ?? source.params.width, height: sourceImage.height ?? source.params.height };
  const graphExtras = {
    protect,
    expect: expectedPieces(req.scope, description),
    dropFeet: req.footwear !== 'reference',
    footwearChanged: req.footwear !== 'keep',
    legsHidden: legsHidden(description, originalOutfit),
  };
  const graphFor = (sourceName: string, referenceName: string, bodyRefNames: string[] = bodyRefs.map((r) => `probe_${r.image.file}`)) =>
    buildOutfitEditGraph({ sourceName, sourceSize, referenceName, autoCrop: !req.manualCrop, prompt, seed, faceRestore, bodyRefNames, ...graphExtras });
  if (backend.kind !== 'mock') {
    const avail = await availability();
    if (!avail.available) throw new GenerationError(`Edit Outfit can't run — the GPU server is missing ${avail.missing.join('; ')}.`);
    await preflight(backend, graphFor('probe.png', 'probe.png'), 'Edit Outfit');
  }

  let graph;
  try {
    const refNames: string[] = [];
    for (const r of bodyRefs) refNames.push(await upload(backend, r.image));
    graph = graphFor(await upload(backend, sourceImage), await upload(backend, req.reference), refNames);
  } catch (e) {
    if (e instanceof ComfyError) throw new GenerationError(`Uploading images failed: ${e.message}`, e.status, e.details);
    throw e;
  }

  const clientId = newId('sienna-edit-');
  const record: GenerationRecord = {
    id: newId('g'),
    createdAt: new Date().toISOString(),
    status: 'queued',
    clientId,
    backend: backend.kind,
    presetId: source.presetId,
    presetName: 'Edit outfit',
    workflowId: OUTFIT_EDIT_WORKFLOW_ID,
    workflowName: OUTFIT_EDIT_WORKFLOW_NAME,
    siennaLock: true,
    contentMode,
    fields: { ...source.fields, outfit: outfitAfter },
    params: { ...source.params, seed, batchSize: 1, width: sourceSize.width, height: sourceSize.height },
    seed,
    positivePrompt: prompt,
    negativePrompt: '',
    lora: faceRestore ? lora : null,
    faceReference: null,
    initImage: sourceImage,
    poseImage: null,
    outfitReference: null,
    warnings,
    prunedModules: [],
    faceRefine: faceRestore ? { status: 'on', denoise: faceRestore.denoise } : { status: 'off', reason: req.face === 'off' ? 'turned off' : 'no Sienna LoRA' },
    submittedGraph: graph,
    images: [],
    favorite: false,
    review: {},
    notes: '',
    parentId: source.id,
    outfitEdit: {
      model: 'qwen-image-edit-2509',
      sourceId: source.id,
      sourceImage,
      reference: req.reference,
      manualCrop: req.manualCrop,
      referenceCrop: null,
      crop: null,
      scope: req.scope,
      footwear: req.footwear,
      face: req.face,
      description,
      originalOutfit,
      ...(protect.garmentOnly || protect.bodyRef || protect.bodyCheck ? { protect, bodyRefIds: bodyRefs.map((r) => r.image.id) } : {}),
    },
  };
  try {
    const { promptId } = await backend.queuePrompt(graph, clientId);
    return saveRecord({ ...record, promptId });
  } catch (e) {
    if (!(e instanceof ComfyError)) throw e;
    return saveRecord({ ...record, status: 'error', error: e.message, errorDetails: e.details, completedAt: new Date().toISOString() });
  }
}

// ── Polling ──────────────────────────────────────────────────────────────────

const inflight = new Map<string, Promise<GenerationRecord | null>>();

export function refreshOutfitEdit(id: string): Promise<GenerationRecord | null> {
  const existing = inflight.get(id);
  if (existing) return existing;
  const p = doRefresh(id).finally(() => inflight.delete(id));
  inflight.set(id, p);
  return p;
}

async function doRefresh(id: string): Promise<GenerationRecord | null> {
  const rec = await getRecord(id);
  if (!rec || !rec.outfitEdit || rec.status === 'done' || rec.status === 'error' || !rec.promptId) return rec;
  const [settings, comfyUrl] = await Promise.all([getSettings(), getComfyUrl()]);
  const backend = createBackend(rec.backend === 'mock' ? 'mock' : comfyUrl);
  let state;
  try {
    state = await backend.jobState(rec.promptId, []);
  } catch (e: any) {
    return { ...rec, warnings: [...rec.warnings.filter((w) => !w.startsWith('Status check:')), `Status check: ${e.message}`] };
  }
  const ageSec = (Date.now() - Date.parse(rec.createdAt)) / 1000;
  switch (state.state) {
    case 'pending':
      return patchRecord(id, { status: 'queued', queuePosition: state.position });
    case 'running':
      return patchRecord(id, { status: 'running', queuePosition: 0 });
    case 'error':
      return patchRecord(id, { status: 'error', error: state.message, errorDetails: state.details, completedAt: new Date().toISOString() });
    case 'unknown':
      if (ageSec > Math.max(60, settings.generationTimeoutSec)) {
        return patchRecord(id, { status: 'error', error: 'ComfyUI no longer knows this job (server restarted or history cleared).', completedAt: new Date().toISOString() });
      }
      return rec;
    case 'done': {
      const finalRef = state.images.find((i) => i.nodeId === EDIT_NODES.final);
      if (!finalRef) return patchRecord(id, { status: 'error', error: 'The edit finished but produced no image.', completedAt: new Date().toISOString() });
      const fetchStore = async (ref: typeof finalRef, prefix: 'gen' | 'up', label?: string) => {
        const { bytes, mime } = await backend.fetchImage(ref);
        return storeImage(bytes, mimeFromBytes(bytes) ?? mime, prefix, label);
      };
      const image = await fetchStore(finalRef, 'gen');
      const cropRef = state.images.find((i) => i.nodeId === EDIT_NODES.crop);
      const referenceCrop = cropRef ? await fetchStore(cropRef, 'up', 'Edit Outfit clothing crop') : null;
      const infoText = state.texts?.[EDIT_NODES.cropInfo]?.[0];
      let crop = rec.outfitEdit.manualCrop ? null : parseCropInfo(infoText);
      let isolation: { mode: string; reason?: string } | null = null;
      if (rec.outfitEdit.protect?.garmentOnly && infoText) {
        try {
          const j = JSON.parse(infoText);
          isolation = { mode: String(j.mode), reason: j.reason };
          crop = { mode: j.mode === 'garment-only' || j.chin === 'cropped' ? 'cropped' : j.chin === 'face-too-low' ? 'face-too-low' : 'no-face', cut: Number(j.cut) || 0 };
        } catch {}
      }
      const bodyCheck = parseBodyReport(state.texts?.[EDIT_NODES.bodyCheck]?.[0]);
      const warnings = [...rec.warnings];
      if (crop && CROP_NOTES[crop.mode]) warnings.push(CROP_NOTES[crop.mode]);
      if (isolation?.mode === 'fallback-chin-crop') warnings.push(`Clothing-only isolation fell back to the chin crop: ${isolation.reason}.`);
      warnings.push(...bodyCheckWarnings(bodyCheck));
      return patchRecord(id, {
        status: 'done',
        images: [image],
        warnings,
        outfitEdit: { ...rec.outfitEdit, referenceCrop, crop, ...(rec.outfitEdit.protect ? { isolation, bodyCheck } : {}) },
        completedAt: new Date().toISOString(),
        queuePosition: 0,
      });
    }
  }
}
