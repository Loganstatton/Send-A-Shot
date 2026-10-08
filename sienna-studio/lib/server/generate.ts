/**
 * Generation pipeline:
 *   request → build prompt (+ guard) → resolve workflow → Sienna Lock (LoRA,
 *   face reference) → prune unused / unavailable optional modules → upload
 *   images to ComfyUI → write values into the graph via bindings →
 *   POST /prompt → record in history.
 *
 * prepareGeneration() does everything except queueing, so diagnostics can
 * dry-run the exact graph a real generation would send.
 *
 * Completion is pulled, not pushed: the browser polls
 * GET /api/history/:id/status, which calls refreshStatus() below. That keeps
 * every request short (works on any host, no websockets needed through
 * proxies) and survives the phone locking mid-generation.
 */

import 'server-only';
import { applyBindings, bypassLora, capabilities, ControlValue, injectLora, validateBindings } from '../comfy/adapter';
import { ComfyBackend, ComfyError, createBackend } from '../comfy/client';
import { missingModelFile } from '../comfy/model-files';
import {
  bypassNode,
  bypassNodeIds,
  filterBindings,
  garbageCollect,
  MODULE_KEYS,
  MODULE_LABELS,
  ModuleKey,
  moduleNodeIds,
  pruneModule,
} from '../comfy/modules';
import { packageFor } from '../comfy/packages';
import { MIN_CHARACTER_AGE } from '../defaults';
import { OUTFIT_MAX_STRENGTH, OUTFIT_MODES_OFFERED, OUTFIT_WEIGHT_TYPE, REVEALING_OUTFIT_RE } from '../outfit';
import { buildPrompt } from '../prompt';
import { resolveLockedLora } from '../sienna-models';
import type { ComfyGraph, ContentMode, ControlKey, GenerateRequest, GenerationRecord, OutfitMode, StoredImage, WorkflowBindings } from '../types';
import {
  adultContentAllowed,
  getCharacter,
  getComfyUrl,
  getRecord,
  getSettings,
  getWorkflow,
  listPresets,
  mimeFromBytes,
  newId,
  patchRecord,
  readImage,
  saveRecord,
  storeImage,
} from './store';

const NO_FACE_REF = 'no face reference uploaded on the Sienna tab';

export class GenerationError extends Error {
  constructor(
    message: string,
    public status = 400,
    public details?: unknown,
  ) {
    super(message);
  }
}

const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, Number.isFinite(n) ? n : lo));

async function uploadStored(backend: ComfyBackend, img: StoredImage): Promise<string> {
  const { bytes, mime } = await readImage(img.file);
  return backend.uploadImage(bytes, img.file, mime);
}

/** Node classes in `ids` that the server does not have (empty if the server can't be asked). */
async function missingClasses(backend: ComfyBackend, graph: ComfyGraph, ids: string[]): Promise<string[]> {
  const classes = [...new Set(ids.map((id) => graph[id]?.class_type).filter(Boolean))];
  const missing: string[] = [];
  await Promise.all(
    classes.map(async (cls) => {
      try {
        if (!(await backend.nodeInfo(cls))) missing.push(cls);
      } catch {
        // unreachable server → let /prompt report the real problem
      }
    }),
  );
  return missing.sort();
}

export function describeMissing(classes: string[]): string {
  const pkgs = [...new Set(classes.map((c) => packageFor(c)?.name).filter(Boolean))];
  return `${classes.join(', ')}${pkgs.length ? ` (install ${pkgs.join(', ')})` : ''}`;
}

export interface PreparedGeneration {
  backend: ComfyBackend;
  graph: ComfyGraph;
  record: Omit<GenerationRecord, 'id' | 'createdAt' | 'status' | 'promptId' | 'clientId'>;
}

export async function prepareGeneration(req: GenerateRequest, opts: { dryRun?: boolean } = {}): Promise<PreparedGeneration> {
  const [settings, character, presets, comfyUrl] = await Promise.all([getSettings(), getCharacter(), listPresets(), getComfyUrl()]);
  const backend = createBackend(comfyUrl);

  // ── Content mode & age policy ──────────────────────────────────────────
  let contentMode: ContentMode = req.contentMode === 'adult' ? 'adult' : 'sfw';
  const warnings: string[] = [];
  if (contentMode === 'adult' && !adultContentAllowed()) {
    contentMode = 'sfw';
    warnings.push('Adult mode is disabled on this server (ALLOW_ADULT_CONTENT is not "true"); generated as SFW.');
  }
  if ((character.age ?? 0) < MIN_CHARACTER_AGE) {
    throw new GenerationError(`The character profile age must be at least ${MIN_CHARACTER_AGE}.`);
  }

  // ── Prompt ─────────────────────────────────────────────────────────────
  const built = buildPrompt({ fields: req.fields, character, siennaLock: req.siennaLock, contentMode });
  if (built.blocked.length) {
    throw new GenerationError(
      `Prompt blocked: ${built.blocked.map((b) => `“${b.term}” — ${b.reason}`).join(' ')}`,
      422,
      built.blocked,
    );
  }
  warnings.push(...built.warnings);

  // ── Workflow ───────────────────────────────────────────────────────────
  const preset = req.presetId ? presets.find((p) => p.id === req.presetId) ?? null : null;
  const workflowId = req.workflowId || preset?.workflowId || settings.defaultWorkflowId;
  if (!workflowId) throw new GenerationError('No workflow selected. Pick one in Library → Workflows.');
  const workflow = await getWorkflow(workflowId);
  if (!workflow) throw new GenerationError(`Workflow ${workflowId} not found.`);
  const problems = validateBindings(workflow.graph, workflow.bindings);
  if (problems.length) throw new GenerationError(`Workflow mapping is broken: ${problems.join('; ')}`);

  let graph = workflow.graph;
  let bindings: WorkflowBindings = workflow.bindings;
  const caps = capabilities(bindings);
  const p = req.params;

  // ── Sienna Lock: LoRA ──────────────────────────────────────────────────
  let lora: GenerationRecord['lora'] = null;
  let loraName = (p.loraName || '').trim();
  if (req.siennaLock) {
    const locked = resolveLockedLora(character.loraFilename, p.siennaModel);
    loraName = locked.file;
    if (locked.ignored) warnings.push(`“${locked.ignored}” isn't an approved Sienna model — used the profile's LoRA instead.`);
  }
  const loraStrength = clamp(p.loraStrength, -2, 2);
  const loraClip = clamp(p.loraClipStrength, -2, 2);
  if (loraName) {
    if (caps.lora) {
      lora = { name: loraName, strength: loraStrength, clipStrength: loraClip, injected: false };
    } else if (workflow.allowLoraInjection) {
      const inj = injectLora(graph, loraName, loraStrength, loraClip);
      graph = inj.graph;
      bindings = {
        ...bindings,
        lora_name: [{ nodeId: inj.nodeId, inputName: 'lora_name' }],
        lora_strength: [{ nodeId: inj.nodeId, inputName: 'strength_model' }],
        ...(graph[inj.nodeId].class_type === 'LoraLoader'
          ? { lora_clip_strength: [{ nodeId: inj.nodeId, inputName: 'strength_clip' }] }
          : {}),
      };
      lora = { name: loraName, strength: loraStrength, clipStrength: loraClip, injected: true };
      warnings.push('Workflow had no LoRA node — Sienna LoRA was spliced in automatically.');
    } else {
      warnings.push('This workflow has no LoRA input and auto-injection is off; the Sienna LoRA was NOT applied.');
    }
  } else {
    if (req.siennaLock) {
      warnings.push('Sienna Lock is on but no LoRA filename is set in the profile — identity relies on prompt/face reference only.');
    }
    if (caps.lora) {
      // No LoRA chosen: bypass the template's LoRA node so ComfyUI doesn't try
      // to load whatever filename happened to be saved in the workflow.
      graph = bypassLora(graph, bindings.lora_name![0].nodeId);
      const { lora_name, lora_strength, lora_clip_strength, ...rest } = bindings;
      bindings = rest;
    }
  }

  // ── Requested images ───────────────────────────────────────────────────
  const refs = [character.faceReference, ...character.secondaryReferences].filter(Boolean) as StoredImage[];
  const chosenRef = refs.find((i) => i.id === req.images.faceReferenceId) ?? null;
  // Sienna Lock conditions on the chosen (or preferred) profile reference.
  const wanted: Record<ModuleKey, StoredImage | null> = {
    face_reference_image: req.siennaLock ? chosenRef ?? character.faceReference ?? null : chosenRef,
    init_image: req.images.initImage,
    pose_image: req.images.poseImage,
    outfit_reference_image: req.images.outfitImage ?? null,
  };
  // Images the user picked for this run must be used or fail loudly; only the
  // profile's automatic face reference may be skipped with a warning.
  const userSupplied = (key: ModuleKey) => key !== 'face_reference_image' || !!req.images.faceReferenceId;

  // The chosen ControlNet file must be in the graph before model files are checked.
  if (wanted.pose_image && p.controlnetModel && bindings.controlnet_model?.length) {
    graph = applyBindings(graph, { controlnet_model: bindings.controlnet_model }, { controlnet_model: p.controlnetModel }).graph;
  }

  // ── Optional modules: keep, prune, or fail ─────────────────────────────
  const prunedModules: string[] = [];
  for (const key of MODULE_KEYS) {
    const present = (bindings[key]?.length ?? 0) > 0;
    const optional = workflow.optionalModules?.includes(key) ?? false;
    const label = MODULE_LABELS[key];
    if (!present) {
      if (wanted[key] && key === 'outfit_reference_image') {
        throw new GenerationError(
          `${workflow.name} has no outfit-reference input. Use the Sienna Production · SDXL workflow` +
            ' (if it was edited, Reset it in Library → Workflows to get the outfit nodes).',
        );
      }
      if (wanted[key] && userSupplied(key)) {
        warnings.push(`${label} image ignored: this workflow has no ${label.toLowerCase()} input.`);
      } else if (key === 'face_reference_image' && wanted[key] && req.siennaLock) {
        warnings.push('This workflow has no face-reference input; identity relies on the LoRA + trigger token.');
      }
      wanted[key] = null;
      continue;
    }
    let reason: string | null = null;
    if (!wanted[key]) {
      reason = key === 'face_reference_image' && req.siennaLock ? NO_FACE_REF : 'not used';
    } else {
      const ids = moduleNodeIds(graph, bindings, key);
      const missing = await missingClasses(backend, graph, ids);
      if (missing.length) reason = `server is missing ${describeMissing(missing)}`;
      else reason = await missingModelFile(backend, graph, ids);
    }
    if (!reason) continue;
    if (wanted[key] && userSupplied(key)) {
      // Never generate without an image the user explicitly supplied.
      throw new GenerationError(`${label} image can't be used — ${reason}. Remove the image or install what's missing.`);
    }
    if (!optional) {
      throw new GenerationError(
        wanted[key]
          ? `${label} module can't run — ${reason}.`
          : `This workflow requires a ${label.toLowerCase()} image (mark the module optional in Library → Workflows to skip it).`,
      );
    }
    try {
      ({ graph, bindings } = pruneModule(graph, bindings, key));
    } catch (e: any) {
      throw new GenerationError(`${label} module could not be removed: ${e.message}`);
    }
    prunedModules.push(key);
    wanted[key] = null;
    // No face photo on the Sienna tab is the normal setup (identity comes from the LoRA), not a problem worth flagging.
    if (reason !== 'not used' && reason !== NO_FACE_REF) warnings.push(`${label} module skipped — ${reason}.`);
  }
  const { face_reference_image: faceReference, init_image: initImage, pose_image: poseImage, outfit_reference_image: outfitImage } = wanted;
  let outfitMode: OutfitMode = p.outfitMode === 'close' ? 'close' : 'design';
  if (outfitImage && !OUTFIT_MODES_OFFERED.includes(outfitMode)) {
    warnings.push('“Match reference closely” is disabled (it copied the reference person’s pose and look in testing) — used “Keep design”.');
    outfitMode = 'design';
  }
  const outfitStrength = clamp(p.outfitStrength ?? 0.7, 0, OUTFIT_MAX_STRENGTH);
  if (outfitImage && contentMode === 'sfw' && REVEALING_OUTFIT_RE.test(req.fields.outfit)) {
    warnings.push('SFW mode: the negative prompt still steers away from nudity, so very revealing outfits may come out with more coverage.');
  }

  // ── Small-face refinement pass (no reference image; same model/LoRA/prompts) ──
  let faceRefine: GenerationRecord['faceRefine'];
  const refineId = bindings.face_refine_denoise?.[0]?.nodeId;
  if (refineId && graph[refineId]) {
    let reason: string | null = p.faceRefine ? null : 'turned off';
    if (!reason) {
      const ids = [...new Set([refineId, ...bypassNodeIds(graph, refineId)])];
      const missing = await missingClasses(backend, graph, ids);
      if (missing.length) reason = `server is missing ${describeMissing(missing)}`;
      else reason = await missingModelFile(backend, graph, ids);
    }
    if (reason) {
      try {
        graph = bypassNode(graph, refineId);
      } catch (e: any) {
        throw new GenerationError(`Face refinement could not be removed: ${e.message}`);
      }
      bindings = filterBindings(graph, bindings);
      faceRefine = { status: p.faceRefine ? 'skipped' : 'off', reason };
      if (p.faceRefine) warnings.push(`Face refinement skipped — ${reason}.`);
    } else {
      faceRefine = { status: 'on', denoise: clamp(p.faceRefineDenoise, 0.05, 1), threshold: Math.round(clamp(p.faceRefineThreshold, 64, 2048)) };
    }
  }

  // Drop anything no output uses any more (e.g. the empty latent when img2img is active).
  graph = garbageCollect(graph);
  bindings = filterBindings(graph, bindings);

  // ── Seed & values ──────────────────────────────────────────────────────
  const seed = p.seed >= 0 ? Math.floor(p.seed) : Math.floor(Math.random() * 2 ** 48);
  const values: Partial<Record<ControlKey, ControlValue | undefined>> = {
    positive_prompt: built.positive,
    negative_prompt: built.negative,
    checkpoint: p.checkpoint || undefined,
    lora_name: lora?.name,
    lora_strength: lora?.strength,
    lora_clip_strength: lora?.clipStrength,
    seed,
    width: Math.round(clamp(p.width, 256, 2048) / 8) * 8,
    height: Math.round(clamp(p.height, 256, 2048) / 8) * 8,
    batch_size: Math.round(clamp(p.batchSize, 1, 8)),
    steps: Math.round(clamp(p.steps, 1, 150)),
    cfg: clamp(p.cfg, 0, 30),
    guidance: clamp(p.cfg, 0, 30),
    sampler: p.sampler || undefined,
    scheduler: p.scheduler || undefined,
    denoise: initImage ? clamp(p.denoise, 0, 1) : 1,
    face_strength: faceReference ? clamp(p.faceStrength, 0, 3) : undefined,
    control_strength: poseImage ? clamp(p.controlStrength, 0, 3) : undefined,
    controlnet_model: poseImage ? p.controlnetModel || undefined : undefined,
    outfit_strength: outfitImage ? outfitStrength : undefined,
    outfit_weight_type: outfitImage ? OUTFIT_WEIGHT_TYPE[outfitMode] : undefined,
    face_refine_denoise: faceRefine?.status === 'on' ? faceRefine.denoise : undefined,
    face_refine_threshold: faceRefine?.status === 'on' ? faceRefine.threshold : undefined,
    filename_prefix: 'sienna/sienna',
  };

  const upload = async (img: StoredImage) => (opts.dryRun ? `sienna/${img.file}` : uploadStored(backend, img));
  try {
    if (faceReference) values.face_reference_image = await upload(faceReference);
    if (initImage) values.init_image = await upload(initImage);
    if (poseImage) values.pose_image = await upload(poseImage);
    if (outfitImage) values.outfit_reference_image = await upload(outfitImage);
  } catch (e) {
    if (e instanceof ComfyError) throw new GenerationError(`Uploading reference images failed: ${e.message}`, e.status, e.details);
    throw e;
  }
  graph = applyBindings(graph, bindings, values).graph;

  return {
    backend,
    graph,
    record: {
      backend: backend.kind,
      presetId: preset?.id ?? null,
      presetName: preset?.name ?? null,
      workflowId: workflow.id,
      workflowName: workflow.name,
      siennaLock: req.siennaLock,
      contentMode,
      fields: req.fields,
      params: { ...p, loraName: lora?.name ?? '' },
      seed,
      positivePrompt: built.positive,
      negativePrompt: built.negative,
      lora,
      faceReference,
      initImage,
      poseImage,
      outfitReference: outfitImage ? { image: outfitImage, strength: outfitStrength, mode: outfitMode } : null,
      warnings,
      prunedModules,
      faceRefine,
      submittedGraph: graph,
      images: [],
      favorite: false,
      review: {},
      notes: '',
      parentId: req.parentId,
    },
  };
}

export async function startGeneration(req: GenerateRequest): Promise<GenerationRecord> {
  const prep = await prepareGeneration(req);
  const clientId = newId('sienna-');
  const base = { ...prep.record, id: newId('g'), createdAt: new Date().toISOString(), clientId };
  try {
    const { promptId } = await prep.backend.queuePrompt(prep.graph, clientId);
    return saveRecord({ ...base, status: 'queued', promptId });
  } catch (e) {
    if (!(e instanceof ComfyError)) throw e;
    // ComfyUI rejected the graph (missing model file, bad value…): keep a
    // record so the error and full metadata are visible in the gallery.
    return saveRecord({ ...base, status: 'error', error: e.message, errorDetails: e.details, completedAt: new Date().toISOString() });
  }
}

// Avoid two concurrent polls downloading the same outputs twice.
const inflight = new Map<string, Promise<GenerationRecord | null>>();

export function refreshStatus(id: string): Promise<GenerationRecord | null> {
  const existing = inflight.get(id);
  if (existing) return existing;
  const p = doRefresh(id).finally(() => inflight.delete(id));
  inflight.set(id, p);
  return p;
}

async function doRefresh(id: string): Promise<GenerationRecord | null> {
  const rec = await getRecord(id);
  if (!rec || rec.status === 'done' || rec.status === 'error' || !rec.promptId) return rec;

  const [settings, comfyUrl, workflow] = await Promise.all([getSettings(), getComfyUrl(), getWorkflow(rec.workflowId)]);
  const backend = createBackend(rec.backend === 'mock' ? 'mock' : comfyUrl);

  let state;
  try {
    state = await backend.jobState(rec.promptId, workflow?.outputNodeIds ?? []);
  } catch (e: any) {
    // Transient network problems shouldn't fail the job; report and retry on next poll.
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
        return patchRecord(id, {
          status: 'error',
          error: 'ComfyUI no longer knows this job (server restarted or history cleared).',
          completedAt: new Date().toISOString(),
        });
      }
      return rec;
    case 'done': {
      if (state.images.length === 0) {
        return patchRecord(id, { status: 'error', error: 'Workflow finished but produced no images. Does it have a SaveImage node?' });
      }
      const images: StoredImage[] = [];
      for (const ref of state.images) {
        const { bytes, mime } = await backend.fetchImage(ref);
        images.push(await storeImage(bytes, mimeFromBytes(bytes) ?? mime, 'gen'));
      }
      return patchRecord(id, { status: 'done', images, completedAt: new Date().toISOString(), queuePosition: 0 });
    }
  }
}
