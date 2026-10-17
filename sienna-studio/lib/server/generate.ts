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
import { applyBindings, bypassLora, capabilities, chainLora, ControlValue, injectLora, isLink, validateBindings } from '../comfy/adapter';
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
import { applyQualityOptions, posePadding } from '../comfy/quality';
import { poseProportions } from '../pose-proportions';
import { OUTFIT_MAX_STRENGTH, OUTFIT_MODES_OFFERED, OUTFIT_WEIGHT_TYPE, REVEALING_OUTFIT_RE } from '../outfit';
import { buildPrompt, fullBodyFraming } from '../prompt';
import { matchPosePreset, POSE_PRESET_LABELS, posePreset } from '../pose-presets';
import { presetImage } from './pose-preset';
import { addHandRefine, HAND_DETECTOR_MODEL } from '../comfy/hand-refine';
import { addCoverage, EXPOSURE_MAX_ATTEMPTS, EXPOSURE_NODE_ID, exposureNode, exposureWarning, failed, outfitHasTop, parseExposure, pickAttempt, reseed, softenPacks } from '../exposure';
import { BODY_FRAME_NODE_ID, BODY_SEGM_MODEL, bodyFrameNodes, bodyFramingOk, parseBodyFrame } from '../body-frame';
import { FACE_NODE_ID, faceNode, faceVerdict, framingOk, missingIdentity, parseFace, rearRequest, type FacePolicy, type FaceReport } from '../identity';
import { resolveLockedLora } from '../sienna-models';
import { ensurePhotoGpu, photoGpuEnabled, photoGpuReady, tickPhotoGpu, touchPhotoGpu } from './photo-gpu';
import { activeStylePacks, nudeOnlyAllowed, packCoverage, STYLE_PACK_STACK_LIMIT, STYLE_PACKS, withPackNegatives, withPackOutfit, withTriggers } from '../style-packs';
import type { ComfyGraph, ContentMode, ControlKey, GenerateRequest, GenerationRecord, OutfitMode, StoredImage, WorkflowBindings } from '../types';
import {
  adultContentAllowed,
  getCharacter,
  getComfyUrl,
  getRecord,
  getSettings,
  listHistory,
  experimentsEnabled,
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
export async function missingClasses(backend: ComfyBackend, graph: ComfyGraph, ids: string[]): Promise<string[]> {
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
  // ── Pose preset: its skeleton stands in for a pose photo (wired straight to the ControlNet below) ──
  let posePre = !req.images.poseImage ? posePreset(req.params.posePreset) : undefined;
  if (!posePre && !req.images.poseImage && !req.params.posePreset && req.params.autoPosePreset !== false) {
    // no preset or pose photo chosen: use the preset the Pose text describes (text alone often loses the position)
    posePre = matchPosePreset(req.fields.pose, fullBodyFraming(req.fields).add);
    if (posePre) {
      warnings.push(`Used the “${POSE_PRESET_LABELS[posePre.id] ?? posePre.id}” pose preset to hold the position your Pose text describes.`);
      req = { ...req, params: { ...req.params, posePreset: posePre.id } };
    }
  }
  if (posePre) {
    req = {
      ...req,
      images: { ...req.images, poseImage: await presetImage(posePre.id) },
      fields: req.fields.pose.trim() ? req.fields : { ...req.fields, pose: posePre.pose },
      params: { ...req.params, width: posePre.width, height: posePre.height, poseRetarget: 0, controlStrength: posePre.strength },
    };
  }

  // Experiments not approved for production are ignored unless SIENNA_EXPERIMENTAL=true.
  if (!experimentsEnabled()) {
    req = { ...req, params: { ...req.params, poseRetarget: 0, outfitIsolation: 'person', promptCleanup: false } };
  }
  // Packs with outfit wording add it to the Outfit field (if the pack's file turns out to be missing below, the pack
  // is skipped but this wording stays — harmless).
  // Nude-only packs run only on an explicitly nude request (one undressed her in a red dress); the check is
  // fail-closed and sees the outfit as built, including other packs' outfit wording.
  const requested = activeStylePacks(req.params.stylePacks, contentMode);
  const packOutfit = withPackOutfit(req.fields.outfit, requested.filter((a) => !a.pack.nudeOnly));
  const nudeOk = nudeOnlyAllowed(contentMode, { ...req.fields, outfit: packOutfit });
  const usable = (active: typeof requested) => active.filter((a) => !a.pack.nudeOnly || nudeOk);
  const built = buildPrompt({ fields: { ...req.fields, outfit: packOutfit }, character, siennaLock: req.siennaLock, contentMode, cleanup: !!req.params.promptCleanup });
  if (built.blocked.length) {
    throw new GenerationError(
      `Prompt blocked: ${built.blocked.map((b) => `“${b.term}” — ${b.reason}`).join(' ')}`,
      422,
      built.blocked,
    );
  }
  warnings.push(...built.warnings);
  let stylePacks = activeStylePacks(req.params.stylePacks, contentMode);
  for (const a of stylePacks.filter((x) => x.pack.nudeOnly && !nudeOk)) {
    warnings.push(`Style pack “${a.pack.label}” is for nude shots only — skipped. It runs only when the Outfit says “completely nude” (jewellery is fine) and nothing in the request mentions clothing.`);
  }
  stylePacks = usable(stylePacks);
  const adultOnly = activeStylePacks(req.params.stylePacks, 'adult').filter((a) => !requested.some((b) => b.pack.id === a.pack.id));
  for (const a of adultOnly) warnings.push(`Style pack “${a.pack.label}” is adult-fashion only — skipped in SFW mode.`);
  if (stylePacks.length) {
    const available = await loraFiles(backend);
    const missing = available ? stylePacks.filter((a) => !available.includes(a.pack.file)) : [];
    for (const m of missing) warnings.push(`Style pack “${m.pack.label}” skipped — ${m.pack.file} is not on the server.`);
    stylePacks = stylePacks.filter((a) => !missing.includes(a));
  }
  if (stylePacks.length > STYLE_PACK_STACK_LIMIT) {
    warnings.push(`${stylePacks.length} style packs are on — with more than ${STYLE_PACK_STACK_LIMIT}, Sienna's face starts to change.`);
  }

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
      for (const r of bindings.lora_name ?? []) graph = bypassLora(graph, r.nodeId);
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

  // ── Phase 1 quality options (each off = previous behaviour) ─────────────
  const outW = Math.round(clamp(p.width, 256, 2048) / 8) * 8;
  const outH = Math.round(clamp(p.height, 256, 2048) / 8) * 8;
  const quality: Parameters<typeof applyQualityOptions>[2] = {};
  const unsupported = (what: string) =>
    warnings.push(`${what} isn't in this copy of the workflow — it was not applied (Reset the workflow in Library → Workflows to get it).`);
  if (wanted.pose_image) {
    if (p.poseFit === 'pad') {
      if (!bindings.pose_pad_left?.length) unsupported('Pose fit “pad”');
      else {
        const pad = posePadding(wanted.pose_image.width, wanted.pose_image.height, outW, outH);
        if (pad) quality.posePad = pad;
        else if (!wanted.pose_image.width) warnings.push('Pose photo size unknown — it could not be padded to the output shape.');
      }
    }
    if ((p.poseRetarget ?? 0) > 0) {
      if (!bindings.pose_retarget_strength?.length) unsupported('Pose retargeting');
      else quality.poseRetarget = clamp(p.poseRetarget!, 0, 1);
    }
  }
  if (p.hires) {
    if (!bindings.hires_denoise?.length) unsupported('The refinement pass');
    else quality.hires = true;
  }
  if (wanted.outfit_reference_image && p.outfitIsolation === 'garment') {
    if (!req.images.outfitGarmentImage) {
      throw new GenerationError('Garment-only isolation needs the garment crop from “Analyze outfit” (garment mode). Run it first, or switch isolation back to “Whole person”.');
    }
    quality.garmentImage = true;
  }
  graph = applyQualityOptions(graph, bindings, quality);
  bindings = filterBindings(graph, bindings);

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
  const positive = withTriggers(built.positive, stylePacks);
  const negative = withPackNegatives(built.negative, stylePacks);
  const values: Partial<Record<ControlKey, ControlValue | undefined>> = {
    positive_prompt: positive,
    negative_prompt: negative,
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
    pose_retarget_strength: poseImage && quality.poseRetarget ? quality.poseRetarget : undefined,
    pose_proportions: poseImage && quality.poseRetarget ? JSON.stringify(poseProportions().values) : undefined,
    hires_scale: quality.hires ? clamp(p.hiresScale ?? 1.5, 1, 2) : undefined,
    hires_denoise: quality.hires ? clamp(p.hiresDenoise ?? 0.3, 0.1, 0.7) : undefined,
    hires_lora_strength: quality.hires ? clamp(p.hiresLoraStrength ?? 0.7, 0, 1.5) : undefined,
    hires_steps: quality.hires ? Math.round(clamp(p.hiresSteps ?? 20, 4, 60)) : undefined,
    face_refine_denoise: faceRefine?.status === 'on' ? faceRefine.denoise : undefined,
    face_refine_threshold: faceRefine?.status === 'on' ? faceRefine.threshold : undefined,
    filename_prefix: 'sienna/sienna',
  };

  const upload = async (img: StoredImage) => (opts.dryRun ? `sienna/${img.file}` : uploadStored(backend, img));
  try {
    if (faceReference) values.face_reference_image = await upload(faceReference);
    if (initImage) values.init_image = await upload(initImage);
    if (poseImage) values.pose_image = await upload(poseImage);
    if (outfitImage) {
      values.outfit_reference_image = await upload(quality.garmentImage ? req.images.outfitGarmentImage! : outfitImage);
    }
  } catch (e) {
    if (e instanceof ComfyError) throw new GenerationError(`Uploading reference images failed: ${e.message}`, e.status, e.details);
    throw e;
  }
  graph = applyBindings(graph, bindings, values).graph;

  // A preset is already a skeleton: feed it to the pose ControlNet directly instead of through DWPose.
  const poseLoadId = bindings.pose_image?.[0]?.nodeId;
  if (posePre && poseImage && poseLoadId && graph[poseLoadId]) {
    for (const node of Object.values(graph)) {
      if (/^ControlNetApply/.test(node.class_type) && Array.isArray(node.inputs.image)) node.inputs.image = [poseLoadId, 0];
    }
    graph = garbageCollect(graph);
    bindings = filterBindings(graph, bindings);
  }

  // ── Style packs: stacked after Sienna's LoRA (trigger words were added to the prompt above) ──
  if (stylePacks.length) {
    let after = bindings.lora_name?.[0]?.nodeId;
    if (after && graph[after]?.class_type !== 'LoraLoader') after = undefined;
    const siennaLoraId = after;
    for (const a of stylePacks) {
      const title = `Style pack: ${a.pack.label}`;
      const spliced = after ? chainLora(graph, after, a.pack.file, a.strength, title) : injectLora(graph, a.pack.file, a.strength, a.strength);
      graph = spliced.graph;
      graph[spliced.nodeId]._meta = { title };
      if (graph[spliced.nodeId].class_type === 'LoraLoader') after = spliced.nodeId;
    }
    // The face redraw goes back to Sienna's LoRA alone: packs shape the body and outfit, not her face.
    if (p.faceKeepsSiennaLora !== false && siennaLoraId && faceRefine?.status === 'on' && refineId && graph[refineId]) {
      graph[refineId].inputs.model = [siennaLoraId, 0];
      graph[refineId].inputs.clip = [siennaLoraId, 1];
      faceRefine = { ...faceRefine, siennaLoraOnly: true };
    }
  }

  // ── Face reference only in the face redraw: the main pass keeps body, outfit and scene; the redraw takes her face ──
  if (p.faceRefFacePassOnly !== false && faceRefine?.status === 'on' && refineId && graph[refineId]) {
    const loadId = bindings.face_reference_image?.[0]?.nodeId;
    const applyId = loadId ? Object.keys(graph).find((id) => /^IPAdapter(Advanced|FaceID)$/.test(graph[id].class_type) && isLink(graph[id].inputs.image) && graph[id].inputs.image[0] === loadId) : undefined;
    const ipa = applyId ? graph[applyId].inputs.ipadapter : undefined;
    const loaderId = isLink(ipa) ? ipa[0] : undefined;
    const base = loaderId ? graph[loaderId]?.inputs.model : undefined;
    if (applyId && loaderId && isLink(base)) {
      // everything except the face redraw goes back to the model the identity module was applied to (LoRA + packs)
      for (const [id, node] of Object.entries(graph)) {
        if (id === refineId) continue;
        for (const [k, v] of Object.entries(node.inputs)) if (isLink(v) && v[0] === applyId && v[1] === 0) node.inputs[k] = [base[0], base[1]];
      }
      const lora = bindings.lora_name?.[0]?.nodeId;
      if (lora && graph[lora]?.class_type === 'LoraLoader') {
        graph[loaderId].inputs.model = [lora, 0];
        graph[refineId].inputs.clip = [lora, 1];
      }
      graph[refineId].inputs.model = [applyId, 0];
      faceRefine = { ...faceRefine, faceReferenceOnly: true };
    }
  }

  // ── Hand touch-up: after the face pass, before the top check (which reads the final image) ──
  let handRefine: GenerationRecord['handRefine'];
  if (p.handRefine === false) {
    handRefine = { status: 'off' };
  } else if (faceRefine?.status === 'on' && refineId) {
    let reason: string | null = null;
    try {
      const models = await backend.inputChoices('UltralyticsDetectorProvider', 'model_name');
      if (models.length && !models.includes(HAND_DETECTOR_MODEL)) reason = `${HAND_DETECTOR_MODEL} is not on the server`;
    } catch {
      // can't ask: let /prompt report it
    }
    const withHands = reason ? null : addHandRefine(graph, refineId);
    if (withHands) {
      graph = withHands;
      handRefine = { status: 'on' };
    } else {
      handRefine = { status: 'skipped', reason: reason ?? 'no face pass to copy settings from' };
      if (reason) warnings.push(`Hand touch-up skipped — ${reason}.`);
    }
  } else {
    handRefine = { status: 'skipped', reason: 'needs face refinement on' };
  }

  // ── Photo checks (retries happen in doRefresh): top check when the outfit has a top, face check with Sienna Lock ──
  let exposureGuard: GenerationRecord['exposureGuard'];
  {
    const saveId = Object.keys(graph).find((id) => graph[id].class_type === 'SaveImage');
    const wanted: [string, ComfyGraph[string] | null][] = [];
    if (saveId && outfitHasTop(req.fields.outfit)) wanted.push([EXPOSURE_NODE_ID, exposureNode(graph, saveId)]);
    if (saveId && req.siennaLock && p.faceCheck !== false) wanted.push([FACE_NODE_ID, faceNode(graph, saveId)]);
    const added: string[] = [];
    const missingAll: string[] = [];
    for (const [nodeId, node] of wanted) {
      if (!node) continue;
      const missing = await missingClasses(backend, { [nodeId]: node }, [nodeId]);
      if (missing.length) missingAll.push(...missing);
      else {
        graph = { ...graph, [nodeId]: node };
        added.push(nodeId);
      }
    }
    // full-body framing from her joints (a full-body request only; skipped when a node is missing)
    let body = false;
    const bodyNodes = saveId && fullBodyFraming(req.fields).add ? bodyFrameNodes(graph, saveId) : null;
    if (bodyNodes) {
      const missing = await missingClasses(backend, bodyNodes, Object.keys(bodyNodes));
      // the person segmenter must be installed too (a missing model would fail the whole photo, not just the check)
      const segm = !missing.length && (await backend.inputChoices('UltralyticsDetectorProvider', 'model_name').catch(() => [] as string[])).includes(BODY_SEGM_MODEL);
      if (segm) {
        graph = { ...graph, ...bodyNodes };
        added.push(BODY_FRAME_NODE_ID);
        body = true;
      }
    }
    if (added.length) {
      exposureGuard = {
        status: 'on',
        checks: { top: added.includes(EXPOSURE_NODE_ID), face: added.includes(FACE_NODE_ID), body },
        maxAttempts: EXPOSURE_MAX_ATTEMPTS,
        attempts: [],
      };
    } else if (missingAll.length) {
      exposureGuard = { status: 'unavailable', reason: `server is missing ${describeMissing(missingAll)}`, maxAttempts: 1, attempts: [] };
    }
  }

  return {
    backend,
    graph,
    record: {
      backend: backend.kind,
      identityPolicy: 1,
      presetId: preset?.id ?? null,
      presetName: preset?.name ?? null,
      workflowId: workflow.id,
      workflowName: workflow.name,
      siennaLock: req.siennaLock,
      contentMode,
      fields: req.fields,
      params: { ...p, loraName: lora?.name ?? '' },
      seed,
      positivePrompt: positive,
      stylePacks: stylePacks.map((a) => ({ id: a.pack.id, label: a.pack.label, file: a.pack.file, strength: a.strength })),
      negativePrompt: negative,
      lora,
      faceReference,
      initImage,
      poseImage,
      outfitReference: outfitImage ? { image: outfitImage, strength: outfitStrength, mode: outfitMode } : null,
      warnings,
      prunedModules,
      faceRefine,
      handRefine,
      exposureGuard,
      submittedGraph: graph,
      images: [],
      favorite: false,
      review: {},
      notes: '',
      parentId: req.parentId,
    },
  };
}

/** LoRA files the server has, or null if it can't be asked. */
async function loraFiles(backend: ComfyBackend): Promise<string[] | null> {
  try {
    const spec: any = (await backend.nodeInfo('LoraLoader'))?.input?.required?.lora_name;
    if (!Array.isArray(spec)) return null;
    const list = Array.isArray(spec[0]) ? spec[0] : spec[1]?.options;
    return Array.isArray(list) ? list.map(String) : null;
  } catch {
    return null;
  }
}

export async function startGeneration(req: GenerateRequest): Promise<GenerationRecord> {
  if (photoGpuEnabled() && !(await photoGpuReady())) return queueForPhotoGpu(req);
  return submitGeneration(req, { id: newId('g'), createdAt: new Date().toISOString() });
}

async function submitGeneration(req: GenerateRequest, keep: { id: string; createdAt: string }): Promise<GenerationRecord> {
  const prep = await prepareGeneration(req);
  const clientId = newId('sienna-');
  const base = { ...prep.record, ...keep, clientId, photoGpu: undefined };
  try {
    const { promptId } = await prep.backend.queuePrompt(prep.graph, clientId);
    if (photoGpuEnabled()) await touchPhotoGpu();
    return saveRecord({ ...base, status: 'queued', promptId });
  } catch (e) {
    if (!(e instanceof ComfyError)) throw e;
    // ComfyUI rejected the graph (missing model file, bad value…): keep a
    // record so the error and full metadata are visible in the gallery.
    return saveRecord({ ...base, status: 'error', error: e.message, errorDetails: e.details, completedAt: new Date().toISOString() });
  }
}

// ── On-demand photo GPU (PHOTO_GPU=runpod) ────────────────────────────────────

const STARTING_NOTE = 'Starting the photo GPU (usually 1–3 min; it switches off by itself after a while without photos).';

/** The photo GPU is off: keep the request in a waiting record, start the GPU, submit when it is ready. */
async function queueForPhotoGpu(req: GenerateRequest): Promise<GenerationRecord> {
  const now = new Date().toISOString();
  const rec = await saveRecord({
    id: newId('g'),
    createdAt: now,
    status: 'queued',
    backend: 'comfyui',
    presetId: req.presetId,
    presetName: null,
    workflowId: req.workflowId ?? '',
    workflowName: '',
    siennaLock: req.siennaLock,
    contentMode: req.contentMode,
    fields: req.fields,
    params: req.params,
    seed: req.params.seed,
    positivePrompt: '',
    negativePrompt: '',
    lora: null,
    faceReference: null,
    initImage: req.images.initImage,
    poseImage: req.images.poseImage,
    images: [],
    warnings: [STARTING_NOTE],
    favorite: false,
    review: {},
    notes: '',
    photoGpu: { phase: 'starting', requestedAt: now, waitingFor: 'requesting a GPU', request: req },
  });
  try {
    await ensurePhotoGpu();
  } catch (e: any) {
    return (await patchRecord(rec.id, { status: 'error', error: e.message, completedAt: new Date().toISOString(), photoGpu: { ...rec.photoGpu!, phase: 'failed' } }))!;
  }
  return rec;
}

const photoBusy = (r: GenerationRecord) => !r.video && (r.status === 'queued' || r.status === 'running');
const photoWaiting = (r: GenerationRecord) => r.photoGpu?.phase === 'starting';
let submitting: Promise<void> | null = null;

/** Starts/stops the photo GPU as needed and submits photos that were waiting for it (timer + status polls). */
export async function photoGpuHousekeeping(): Promise<void> {
  if (!photoGpuEnabled()) return;
  const recs = await listHistory();
  const probe = async (url: string) => (await createBackend(url).systemInfo().then(() => true, () => false));
  const session = await tickPhotoGpu(recs.filter(photoBusy).length, probe);
  const waiting = recs.filter(photoWaiting).sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  if (!waiting.length) return;
  if (!session || session.status === 'failed' || session.status === 'stopped') {
    for (const r of waiting) {
      if (session?.endedAt && Date.parse(session.endedAt) < Date.parse(r.createdAt)) {
        await ensurePhotoGpu().catch((e: any) => failWaiting(r, e.message));
        continue;
      }
      await failWaiting(r, `The photo GPU couldn't start: ${session?.error ?? session?.stopReason ?? 'it is not running'}. Nothing was retried automatically — tap “Make again” to try once more.`);
    }
    return;
  }
  if (session.status !== 'ready') {
    for (const r of waiting) if (r.photoGpu!.waitingFor !== session.phase) await patchRecord(r.id, { photoGpu: { ...r.photoGpu!, waitingFor: session.phase } });
    return;
  }
  if (submitting) return submitting;
  submitting = (async () => {
    for (const r of waiting) {
      const fresh = await getRecord(r.id);
      if (!fresh || !photoWaiting(fresh) || !fresh.photoGpu?.request) continue;
      try {
        const done = await submitGeneration(fresh.photoGpu.request, { id: fresh.id, createdAt: fresh.createdAt });
        // submitGeneration saved the full record under the same id; drop the stored request
        if (done.photoGpu) await patchRecord(done.id, { photoGpu: undefined });
      } catch (e: any) {
        await failWaiting(fresh, e.message);
      }
    }
  })().finally(() => {
    submitting = null;
  });
  return submitting;
}

function failWaiting(r: GenerationRecord, error: string) {
  return patchRecord(r.id, { status: 'error', error, completedAt: new Date().toISOString(), photoGpu: { ...r.photoGpu!, phase: 'failed', request: undefined } });
}

// Avoid two concurrent polls downloading the same outputs twice.
const inflight = new Map<string, Promise<GenerationRecord | null>>();

export function refreshStatus(id: string): Promise<GenerationRecord | null> {
  const existing = inflight.get(id);
  if (existing) return existing;
  const p = doRefresh(id)
    .then(async (rec) => {
      // a photo just finished: the idle timer of the on-demand photo GPU starts from now
      if (photoGpuEnabled() && rec?.promptId && rec.completedAt && Date.now() - Date.parse(rec.completedAt) < 60_000) await touchPhotoGpu();
      return rec;
    })
    .finally(() => inflight.delete(id));
  inflight.set(id, p);
  return p;
}

async function doRefresh(id: string): Promise<GenerationRecord | null> {
  let rec = await getRecord(id);
  if (rec && photoWaiting(rec)) {
    await photoGpuHousekeeping();
    rec = await getRecord(id);
  }
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
      let refs = state.images;
      const extra: Partial<GenerationRecord> = {};
      const guard = rec.exposureGuard;
      // Why the face check produced no verdict, if it didn't (never read as a pass: see missingIdentity).
      let faceProblem: string | undefined;
      if (guard?.status === 'on') {
        const checks = guard.checks ?? { top: true, face: false };
        const top = checks.top ? parseExposure(state.texts?.[EXPOSURE_NODE_ID]) : null;
        const face = checks.face ? parseFace(state.texts?.[FACE_NODE_ID]) : null;
        const bodyFraming = checks.body ? bodyFramingOk(fullBodyFraming(rec.fields).add, parseBodyFrame(state.texts?.[BODY_FRAME_NODE_ID])) : undefined;
        const notes: string[] = [];
        if (top && !top.available) notes.push(`Top check didn't run on the GPU (${top.error ?? 'detector not installed'}).`);
        if (face && !face.available) notes.push(`Face check didn't run on the GPU (${face.error ?? 'models not installed'}).`);
        const topOn = !!top?.available;
        const faceOn = !!face?.available;
        if (checks.face && !face) faceProblem = 'the face check returned no result';
        else if (face && !face.available) faceProblem = `the face check could not run (${face.error ?? 'models not installed'})`;
        if (topOn || faceOn || bodyFraming !== undefined) {
          const attempts = [
            ...guard.attempts,
            {
              seed: rec.seed,
              exposed: topOn ? top!.exposed : false,
              score: topOn ? top!.score : 0,
              ...(faceOn ? identityFields(face!, rec) : {}),
              // her joints beat the face-size guess whenever the body could be judged
              ...(bodyFraming !== undefined ? { framingOk: bodyFraming } : {}),
              images: state.images,
            },
          ];
          const latest = attempts[attempts.length - 1];
          if (failed(latest) && attempts.length < guard.maxAttempts && rec.submittedGraph) {
            // New seed. If a nipple showed although the outfit has a top, also turn the style packs a notch lower and
            // add their coverage wording (the first attempt keeps each pack's full look); a face miss only needs the seed.
            const seed = Math.floor(Math.random() * 2 ** 48);
            let graph = reseed(rec.submittedGraph, rec.seed, seed);
            let prompts = { positive: rec.positivePrompt, negative: rec.negativePrompt };
            if (latest.exposed) {
              const cov = addCoverage(softenPacks(graph), prompts, packCoverage((rec.stylePacks ?? []).map((p) => p.id)));
              graph = cov.graph;
              prompts = { positive: cov.positive, negative: cov.negative };
            }
            try {
              const { promptId } = await backend.queuePrompt(graph, rec.clientId ?? newId('sienna-'));
              return patchRecord(id, {
                status: 'queued', promptId, seed, submittedGraph: graph, exposureGuard: { ...guard, attempts }, queuePosition: 0,
                positivePrompt: prompts.positive, negativePrompt: prompts.negative,
              });
            } catch {
              // couldn't queue the retry: keep what we have
            }
          }
          const kept = pickAttempt(attempts);
          if (kept.exposed) {
            // Never hand over a photo with a nipple showing when the outfit has a top.
            return patchRecord(id, {
              status: 'error',
              error: `Top check: all ${attempts.length} attempts showed a nipple, so no photo was kept. Generate again (new seed) or lower the style-pack strength.`,
              exposureGuard: { ...guard, attempts },
              completedAt: new Date().toISOString(),
              queuePosition: 0,
            });
          }
          refs = kept.images;
          extra.seed = kept.seed;
          if (kept.identity) extra.identityCheck = identitySummary(kept);
          else if (checks.face && !faceProblem) faceProblem = 'the face check had no result for the kept photo';
          extra.exposureGuard = { ...guard, attempts };
          const note = exposureWarning(attempts, kept);
          if (note) notes.push(note);
        } else if (notes.length) {
          extra.exposureGuard = { ...guard, status: 'unavailable', reason: notes.join(' ') };
        }
        if (notes.length) extra.warnings = [...rec.warnings, ...notes];
      }
      // Every finished photo gets a face-check outcome; "could not run" is never a pass.
      if (!extra.identityCheck) extra.identityCheck = missingIdentity(rec, faceProblem);
      const images: StoredImage[] = [];
      for (const ref of refs) {
        const { bytes, mime } = await backend.fetchImage(ref);
        images.push(await storeImage(bytes, mimeFromBytes(bytes) ?? mime, 'gen'));
      }
      return patchRecord(id, { ...extra, status: 'done', images, completedAt: new Date().toISOString(), queuePosition: 0 });
    }
  }
}

/** Face-check fields of one attempt. Production uses the strict rule; the pose-aware rule only runs with
 * SIENNA_EXPERIMENTAL=true (see lib/identity.ts). Only a verified face sets faceOk. */
function identityFields(face: FaceReport, rec: GenerationRecord) {
  const policy: FacePolicy = experimentsEnabled() ? 'pose-aware' : 'strict';
  const rearPack = (rec.stylePacks ?? []).some((p) => STYLE_PACKS.find((sp) => sp.id === p.id)?.rearPose);
  const rear = rearRequest(`${rec.fields.pose} ${rec.fields.framing} ${rec.fields.extra}`, rec.params.posePreset, rearPack);
  const v = faceVerdict(face, rear, policy);
  return {
    similarity: face.similarity,
    identity: v.status,
    ...(v.status === 'verified' ? { faceOk: true } : v.status === 'mismatch' ? { faceOk: false } : {}),
    ...(v.reason ? { identityReason: v.reason } : {}),
    framingOk: framingOk(fullBodyFraming(rec.fields).add, face.size, rec.params.height),
  };
}

/** What the gallery shows about the kept photo's face: only a verified face counts as Sienna's. A face that couldn't
 * be compared ('unchecked': none found, or too small) is not retried but is filed in Needs Review like any other
 * unverified photo. */
function identitySummary(kept: { identity?: string; similarity?: number | null; identityReason?: string; faceOk?: boolean }): NonNullable<GenerationRecord['identityCheck']> {
  const similarity = kept.similarity ?? null;
  if (kept.identity === 'verified' || (kept.identity === undefined && kept.faceOk === true)) return { status: 'verified', similarity };
  if (kept.identity === 'unchecked') return { status: 'unchecked', similarity, reason: kept.identityReason };
  if (kept.identity === 'inconclusive') return { status: 'inconclusive', similarity, reason: kept.identityReason };
  return { status: 'unconfirmed', similarity, reason: kept.identityReason ?? "didn't look enough like Sienna" };
}
