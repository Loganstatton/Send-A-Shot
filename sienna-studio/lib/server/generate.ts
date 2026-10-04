/**
 * Generation pipeline:
 *   request → build prompt (+ guard) → resolve workflow → apply Sienna Lock
 *   (LoRA + face reference) → upload images to ComfyUI → write values into the
 *   graph via bindings → POST /prompt → record in history.
 *
 * Completion is pulled, not pushed: the browser polls
 * GET /api/history/:id/status, which calls refreshStatus() below. That keeps
 * every request short (works on any host, no websockets needed through
 * proxies) and survives the phone locking mid-generation.
 */

import 'server-only';
import { applyBindings, bypassLora, capabilities, ControlValue, injectLora, validateBindings } from '../comfy/adapter';
import { ComfyError, createBackend } from '../comfy/client';
import { MIN_CHARACTER_AGE } from '../defaults';
import { buildPrompt } from '../prompt';
import type { ControlKey, GenerateRequest, GenerationRecord, StoredImage, WorkflowBindings } from '../types';
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

async function uploadStored(backend: ReturnType<typeof createBackend>, img: StoredImage): Promise<string> {
  const { bytes, mime } = await readImage(img.file);
  return backend.uploadImage(bytes, img.file, mime);
}

export async function startGeneration(req: GenerateRequest): Promise<GenerationRecord> {
  const [settings, character, presets, comfyUrl] = await Promise.all([getSettings(), getCharacter(), listPresets(), getComfyUrl()]);

  // ── Content mode & age policy ──────────────────────────────────────────
  let contentMode = req.contentMode === 'adult' ? 'adult' : 'sfw';
  const warnings: string[] = [];
  if (contentMode === 'adult' && !adultContentAllowed()) {
    contentMode = 'sfw';
    warnings.push('Adult mode is disabled on this server (ALLOW_ADULT_CONTENT is not "true"); generated as SFW.');
  }
  if ((character.age ?? 0) < MIN_CHARACTER_AGE) {
    throw new GenerationError(`The character profile age must be at least ${MIN_CHARACTER_AGE}.`);
  }

  // ── Prompt ─────────────────────────────────────────────────────────────
  const built = buildPrompt({ fields: req.fields, character, siennaLock: req.siennaLock, contentMode: contentMode as 'sfw' | 'adult' });
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
  const loraName = req.siennaLock ? character.loraFilename.trim() : (p.loraName || '').trim();
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

  // ── Images (face ref / init / pose) ────────────────────────────────────
  const refs = [character.faceReference, ...character.secondaryReferences].filter(Boolean) as StoredImage[];
  const chosenRef = refs.find((i) => i.id === req.images.faceReferenceId) ?? null;
  // Sienna Lock always conditions on a profile reference; without the lock the
  // profile reference is only used if the workflow requires one.
  let faceReference: StoredImage | null =
    req.siennaLock || caps.faceReference ? chosenRef ?? character.faceReference ?? null : chosenRef;
  if (faceReference && !caps.faceReference) {
    if (req.siennaLock) warnings.push('This workflow has no face-reference input; identity relies on the LoRA + trigger token.');
    faceReference = null;
  }
  if (caps.faceReference && !faceReference) {
    throw new GenerationError('This workflow needs a face reference image. Upload one on the Sienna tab.');
  }
  const initImage = caps.img2img ? req.images.initImage : null;
  const poseImage = caps.pose ? req.images.poseImage : null;
  if (req.images.initImage && !caps.img2img) warnings.push('Init image ignored: this workflow has no img2img input.');
  if (req.images.poseImage && !caps.pose) warnings.push('Pose image ignored: this workflow has no ControlNet/pose input.');
  if (caps.img2img && !initImage) throw new GenerationError('This workflow is image-to-image — add an init image.');
  if (caps.pose && !poseImage) throw new GenerationError('This workflow needs a pose image — add one under Reference images.');

  // ── Seed ───────────────────────────────────────────────────────────────
  const seed = p.seed >= 0 ? Math.floor(p.seed) : Math.floor(Math.random() * 2 ** 48);

  // ── Talk to ComfyUI ────────────────────────────────────────────────────
  const backend = createBackend(comfyUrl);
  const clientId = newId('sienna-');
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
    denoise: clamp(initImage ? p.denoise : caps.img2img ? p.denoise : 1, 0, 1),
    face_strength: faceReference ? clamp(p.faceStrength, 0, 3) : undefined,
    control_strength: poseImage ? clamp(p.controlStrength, 0, 3) : undefined,
    controlnet_model: p.controlnetModel || undefined,
    filename_prefix: 'sienna/sienna',
  };

  let promptId: string;
  try {
    if (faceReference) values.face_reference_image = await uploadStored(backend, faceReference);
    if (initImage) values.init_image = await uploadStored(backend, initImage);
    if (poseImage) values.pose_image = await uploadStored(backend, poseImage);
    const applied = applyBindings(graph, bindings, values);
    ({ promptId } = await backend.queuePrompt(applied.graph, clientId));
  } catch (e) {
    if (e instanceof ComfyError) throw new GenerationError(e.message, e.status, e.details);
    throw e;
  }

  const rec: GenerationRecord = {
    id: newId('g'),
    createdAt: new Date().toISOString(),
    status: 'queued',
    backend: backend.kind,
    promptId,
    clientId,
    presetId: preset?.id ?? null,
    presetName: preset?.name ?? null,
    workflowId: workflow.id,
    workflowName: workflow.name,
    siennaLock: req.siennaLock,
    contentMode: contentMode as 'sfw' | 'adult',
    fields: req.fields,
    params: { ...p, loraName: lora?.name ?? '' },
    seed,
    positivePrompt: built.positive,
    negativePrompt: built.negative,
    lora,
    faceReference,
    initImage,
    poseImage,
    warnings,
    images: [],
    favorite: false,
    review: {},
    notes: '',
    parentId: req.parentId,
  };
  return saveRecord(rec);
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
      return patchRecord(id, { status: 'error', error: state.message, completedAt: new Date().toISOString() });
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
