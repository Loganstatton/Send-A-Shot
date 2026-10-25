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
import { buildPrompt, COVER_GARMENTS, fullBodyFraming, withoutAbs, type CoverGarment } from '../prompt';
import { checkRules } from '../ai-prompts';
import { CAMERA_ANGLE_RE, matchPosePreset, NOT_STANDING_RE, presetFitsCamera, POSE_GUIDES, POSE_PRESET_LABELS, POSE_PRESET_PROMPTS, posePreset, presetOutfitPrompt, presetThongPack } from '../pose-presets';
import { presetImage } from './pose-preset';
import { aiCheck, aiEnabled } from './ai';
import { addKeepPerson, stripKeepPerson } from '../comfy/keep-person';
import { addHandRefine, HAND_DETECTOR_MODEL, HAND_REFINE_DENOISE } from '../comfy/hand-refine';
import { backgroundFixes, buildCorrection, pickFixes } from '../corrections';
import { addCoverage, keepPersonFor, placeCorrection, swapPrompts, AI_MAX_ATTEMPTS, EXPOSURE_MAX_ATTEMPTS, nextRetry, EXPOSURE_NODE_ID, exposureNode, exposureWarning, failed, outfitHasTop, parseExposure, pickAttempt, reseed, softenPacks } from '../exposure';
import { addFigurePass, FIGURE_NODES, figurePassFromEnv, parseFigurePass } from '../comfy/figure-pass';
import { addDetailPass, bareBelow, DETAIL_NODES, detailDenoise, DETAIL_STYLES, detailFile, detailPassFromEnv, parseDetailPass } from '../comfy/detail-pass';
import { BODY_FRAME_NODE_ID, BODY_SEGM_MODEL, bodyFrameNodes, bodyFramingOk, hingeCheck, kneeFramingOk, parseBodyFrame } from '../body-frame';
import { FACE_NODE_ID, faceNode, faceVerdict, framingOk, missingIdentity, parseFace, rearRequest, type FacePolicy, type FaceReport } from '../identity';
import { resolveLockedLora } from '../sienna-models';
import { ensurePhotoGpu, photoGpuEnabled, photoGpuReady, tickPhotoGpu, touchPhotoGpu } from './photo-gpu';
import { activeStylePacks, nudeOnlyAllowed, toplessAllowed, packCoverage, resolvePackConflicts, STYLE_PACK_STACK_LIMIT, STYLE_PACKS, withoutRearUnsafePacks, withPackNegatives, withPackOutfit, withTriggers } from '../style-packs';
import { fixesFromEnv, hasFix } from '../fixes';
import { kneeUpRequest, outputHeight } from '../framing';
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
/** Minimal bottoms whose coverage only the AI check can confirm (the GPU detector graded D3's as covered). */
const REVEALING_BOTTOMS_RE = /\b(bikini|thong|g-string|string|micro|panties|briefs|knickers|lingerie|underwear)\b/i;
/** A plain standing pose for the head-to-knees skeletons (fixes rearguide, kneeguide): standing, nothing they can't show. */
const PLAIN_STANDING_RE = /\bstand(ing|s)?\b/i;
const NOT_PLAIN_STANDING_RE = /\b(sit|sitting|seated|lying|lies|kneel\w*|crouch\w*|squat\w*|bend\w*|bent|lean\w*|walking|hands? on (her )?hips?|holding)\b/i;

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

/** SIENNA_COVER_STOMACH: "true" = every garment the fit wording covers, or a comma list ("tee,tank"). */
export function coverFromEnv(v: string | undefined): CoverGarment[] {
  if (v === 'true') return [...COVER_GARMENTS];
  return (v ?? '').split(',').map((x) => x.trim()).filter((x): x is CoverGarment => (COVER_GARMENTS as string[]).includes(x));
}

export async function prepareGeneration(req: GenerateRequest, opts: { dryRun?: boolean } = {}): Promise<PreparedGeneration> {
  const [settings, profile, presets, comfyUrl] = await Promise.all([getSettings(), getCharacter(), listPresets(), getComfyUrl()]);
  const backend = createBackend(comfyUrl);
  // testing: her figure without the "defined abs" wording (suspected of pulling requested tank tops into crop tops)
  const traits = req.params.figureNoAbs ? withoutAbs(profile.appearanceTraits) : profile.appearanceTraits;
  // testing (figure preview, 23 Oct): extra figure wording after her own, unweighted — never saved to her profile
  const character = { ...profile, appearanceTraits: req.params.figureTrait ? `${traits}, ${req.params.figureTrait}` : traits };

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

  // ── Prompt version ───────────────────────────────────────────────────────
  const promptVersion: 1 | 2 = req.params.promptVersion ?? (process.env.SIENNA_PROMPT_VERSION === '2' ? 2 : 1);
  if (promptVersion === 2) {
    // the realism packs were switched on automatically in 65 of 146 photos with no visible benefit (skin still
    // airbrushed). The standing skeleton stays: without it she sat on the sofa in 4 of 4 "standing" photos (22 Oct
    // benchmark).
    const auto = new Set(['natural_skin', 'real_photo']);
    const packs = Object.fromEntries(Object.entries(req.params.stylePacks ?? {}).filter(([id]) => !auto.has(id)));
    req = {
      ...req,
      params: { ...req.params, stylePacks: packs, autoPosePreset: req.simple ? false : req.params.autoPosePreset },
    };
  }
  // testing, either prompt version: the 7.5-head standing skeleton in place of the original one
  if (req.params.standingGuide === 'natural' && req.params.posePreset === 'standing_full_body') {
    req = { ...req, params: { ...req.params, posePreset: 'standing_full_body_natural' } };
  }

  // ── Revealing-benchmark fixes (lib/fixes.ts): off unless SIENNA_FIXES lists them or a benchmark request sets them ──
  const fixes = req.params.fixes ?? fixesFromEnv(process.env.SIENNA_FIXES);
  // Conflicting style packs never stack, however they were chosen (micro bikini + string swimsuit: D3)
  {
    const { packs, dropped } = resolvePackConflicts(req.params.stylePacks ?? {});
    for (const id of dropped) warnings.push(`Style pack “${STYLE_PACKS.find((p) => p.id === id)?.label ?? id}” skipped — it conflicts with another pack that is on (stacked, they changed her figure and the outfit's coverage).`);
    if (dropped.length) req = { ...req, params: { ...req.params, stylePacks: packs } };
  }
  const rear = rearRequest(`${req.fields.pose} ${req.fields.framing} ${req.fields.extra}`, null, false);
  // Packs whose coverage from behind isn't validated stay off rear views, in every mode (micro bikini: exposure 4 of 4)
  {
    const rearView = rear || rearRequest(`${req.fields.camera} ${req.fields.pose}`, req.params.posePreset, false);
    const { packs, dropped } = withoutRearUnsafePacks(req.params.stylePacks ?? {}, rearView);
    for (const id of dropped) warnings.push(`Style pack “${STYLE_PACKS.find((p) => p.id === id)?.label ?? id}” skipped — from behind it drew bottoms that didn't cover her, so it stays off rear views until that is fixed.`);
    if (dropped.length) req = { ...req, params: { ...req.params, stylePacks: packs } };
  }

  // ── Prompt ─────────────────────────────────────────────────────────────
  // ── Pose preset: its skeleton stands in for a pose photo (wired straight to the ControlNet below) ──
  let posePre = !req.images.poseImage ? posePreset(req.params.posePreset) : undefined;
  let autoPose = false;
  if (!posePre && !req.images.poseImage && !req.params.posePreset && req.params.autoPosePreset !== false) {
    // no preset or pose photo chosen: use the preset the Pose text describes (text alone often loses the position),
    // unless a camera angle is asked for that its skeleton can't show ("from behind" is the rear presets' own view)
    posePre = matchPosePreset(req.fields.pose, fullBodyFraming(req.fields).add);
    if (posePre && !presetFitsCamera(posePre, `${req.fields.camera} ${req.fields.framing} ${req.fields.pose}`)) posePre = undefined;
    if (posePre) {
      warnings.push(`Used the “${POSE_PRESET_LABELS[posePre.id] ?? posePre.id}” pose preset to hold the position your Pose text describes.`);
      req = { ...req, params: { ...req.params, posePreset: posePre.id } };
      autoPose = true;
    }
  }
  // fixes rearguide / kneeguide: a plain standing request framed head to knees is held by a head-to-knees skeleton —
  // from behind (her body turned away, her head turned back when she looks back) or from the front
  const plainStanding = PLAIN_STANDING_RE.test(req.fields.pose) && !NOT_PLAIN_STANDING_RE.test(req.fields.pose) && !CAMERA_ANGLE_RE.test(`${req.fields.camera} ${req.fields.pose}`.replace(/\b(from behind|three[- ]quarter view)\b/gi, ''));
  if (!posePre && !req.images.poseImage && plainStanding && kneeUpRequest(req.fields.framing)) {
    const guide = rear
      ? hasFix(fixes, 'rearguide')
        ? /\b(looking back|over (her|the) shoulder|looks? at the camera|head turned)\b/i.test(`${req.fields.pose} ${req.fields.expression}`) ? 'standing_rear_knee_up' : 'standing_rear_knee_up_away'
        : null
      : hasFix(fixes, 'kneeguide') ? 'standing_knee_up' : null;
    posePre = guide ? posePreset(guide) : undefined;
    if (posePre) {
      req = { ...req, params: { ...req.params, posePreset: posePre.id } };
      autoPose = true;
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

  // Bent over + string thong: the thin string back needs the String swimsuit add-on (prompting alone gave cheeky
  // bottoms 3/3). Added at its own default strength, only where the add-on applies at all (adult mode).
  if (posePre && contentMode === 'adult' && presetThongPack(posePre.id, req.fields.outfit) && !(req.params.stylePacks?.string_swimsuit ?? 0)) {
    const sp = STYLE_PACKS.find((p) => p.id === 'string_swimsuit');
    if (sp) {
      req = { ...req, params: { ...req.params, stylePacks: { ...(req.params.stylePacks ?? {}), string_swimsuit: sp.default } } };
      warnings.push(`Added the “${sp.label}” add-on (${sp.default}) for the string thong in this pose.`);
    }
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
  const toplessOk = toplessAllowed(contentMode, { ...req.fields, outfit: packOutfit });
  const usable = (active: typeof requested) => active.filter((a) => (!a.pack.nudeOnly || nudeOk) && (!a.pack.toplessOnly || toplessOk));
  // a pose guide's wording goes after the outfit (inside the prompt), not in front of everything like other presets
  const guidePrompt = posePre && POSE_GUIDES[posePre.id] ? POSE_PRESET_PROMPTS[posePre.id] : undefined;
  const built = buildPrompt({
    fields: { ...req.fields, outfit: packOutfit },
    character,
    siennaLock: req.siennaLock,
    contentMode,
    cleanup: !!req.params.promptCleanup,
    poseGuide: posePre && POSE_GUIDES[posePre.id] ? guidePrompt?.positive ?? '' : undefined,
    version: promptVersion,
    // an ordinary T-shirt / tank top / button-up stays full-length: SIENNA_COVER_STOMACH lists the garments it's on for
    // ("tee,tank,buttonup", or true = all); unset or false = off, the rollback. A benchmark request can force it.
    coverStomach: req.params.coverStomach ?? coverFromEnv(process.env.SIENNA_COVER_STOMACH),
    fixes,
  });
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
  for (const a of stylePacks.filter((x) => x.pack.toplessOnly && !toplessOk)) {
    warnings.push(`Style pack “${a.pack.label}” is for topless and nude shots only — skipped. It runs only when the Outfit says “topless” or “nude” and nothing in the request covers her chest.`);
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
  // an automatically picked pose preset is a nice-to-have: on a server without pose copying it is dropped, not fatal
  const userSupplied = (key: ModuleKey) => (key === 'pose_image' ? !autoPose : key !== 'face_reference_image' || !!req.images.faceReferenceId);

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
  // Nude / bottomless photos that get the close-up detail pass are made at 1.5× (the hi-res pass): at normal size the
  // area is ~150-200 px and the redraw lost its detail when scaled back; at 1.5× it looked clearly more real from the
  // front and from behind, face and body unchanged (fig24, 24 Oct)
  // her back to the camera, for the detail pass: the pose preset (chosen or matched) and rear pose packs count; a side
  // profile doesn't (REAR_POSE_RE counts it as rear for the face check, but the crotch is then seen from the side)
  const detailRearView =
    rearRequest(`${req.fields.camera} ${req.fields.pose} ${req.fields.framing} ${req.fields.extra}`.replace(/\b(side profile|profile view)\b/gi, ' '), posePre?.id ?? req.params.posePreset, stylePacks.some((a) => a.pack.rearPose));
  // The live setting (SIENNA_DETAIL) runs on rear views only: from behind 3 of 3 came out better, from the front 2 of 3
  // and the third got a dark grey patch, worse than no touch-up (24 Oct). SIENNA_DETAIL_FRONT=true adds front views back.
  // A test request sets its own (or 'off').
  const detailWanted = p.detailPass === 'off' ? undefined
    : p.detailPass ?? (detailRearView || process.env.SIENNA_DETAIL_FRONT === 'true' ? detailPassFromEnv(process.env.SIENNA_DETAIL) : undefined);
  let detailHires = !!detailWanted && contentMode === 'adult' && bareBelow(req.fields.outfit, nudeOk) && p.faceRefine !== false && Math.round(clamp(p.batchSize, 1, 8)) === 1;
  if (detailHires && detailWanted) {
    const probe: ComfyGraph = { r: { class_type: 'SiennaDetailRegion', inputs: {} }, s: { class_type: 'SiennaDetailPaste', inputs: {} } };
    const [missingDetail, loras] = await Promise.all([missingClasses(backend, probe, ['r', 's']), loraFiles(backend)]);
    if (missingDetail.length || (loras && !loras.includes(detailFile(detailWanted.style, detailRearView)))) detailHires = false;
  }
  if (p.hires || (detailHires && !!bindings.hires_denoise?.length)) {
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
  // a preset's own wording (bent over: the hinge spelled out, and the squat/kneel misreads pushed away)
  const presetPrompt = posePre ? (guidePrompt ? { positive: '', negative: guidePrompt.negative } : POSE_PRESET_PROMPTS[posePre.id]) : undefined;
  // presets that lose the outfit (bent over) also repeat the garment, weighted, right after their pose wording
  const presetOutfit = posePre ? presetOutfitPrompt(posePre.id, packOutfit, req.fields.setting) : null;
  const presetPos = [presetPrompt?.positive, presetOutfit?.positive].filter(Boolean).join(', ');
  const presetNeg = [presetPrompt?.negative, presetOutfit?.negative].filter(Boolean).join(', ');
  // the standard full-body wording asks for "feet and shoes" — it added sandals to bent-over photos; barefoot here
  const builtPositive = presetOutfit?.positive.includes('barefoot') ? built.positive.replace('including feet and shoes', 'including bare feet') : built.positive;
  const positive = withTriggers(presetPos ? `${presetPos}, ${builtPositive}` : builtPositive, stylePacks);
  const negative = withPackNegatives(presetNeg ? `${built.negative}, ${presetNeg}` : built.negative, stylePacks);
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

  // Version 2 option: the outfit encoded on its own and joined to the rest (ConditioningConcat — what "BREAK" does in
  // other tools). In one encoding a "gray sofa" turned a black turtleneck gray; separately encoded, the outfit's
  // colour words can't attach to the room's objects inside the text encoder.
  let promptSplit: { scene: string; outfit: string } | undefined;
  if (promptVersion === 2 && p.splitOutfit && built.outfitPart && positive.includes(built.outfitPart)) {
    const posIds = Object.keys(graph).filter((id) => graph[id].class_type === 'CLIPTextEncode' && graph[id].inputs.text === positive);
    if (posIds.length) {
      const scene = positive.replace(`, ${built.outfitPart}`, '').replace(built.outfitPart, '');
      for (const id of posIds) {
        graph[id] = { ...graph[id], inputs: { ...graph[id].inputs, text: scene } };
        const enc = `${id}_outfit`;
        const cat = `${id}_concat`;
        graph[enc] = { class_type: 'CLIPTextEncode', inputs: { text: built.outfitPart, clip: graph[id].inputs.clip }, _meta: { title: 'Outfit (encoded on its own)' } };
        graph[cat] = { class_type: 'ConditioningConcat', inputs: { conditioning_to: [id, 0], conditioning_from: [enc, 0] }, _meta: { title: 'Scene + outfit' } };
        for (const [nid, node] of Object.entries(graph)) {
          if (nid === cat) continue;
          for (const [k, v] of Object.entries(node.inputs)) if (isLink(v) && v[0] === id && v[1] === 0) node.inputs[k] = [cat, 0];
        }
      }
      promptSplit = { scene, outfit: built.outfitPart };
    }
  }

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
  // testing (figure preview): a figure LoRA goes right after Sienna's, before the packs; the face redraw still uses
  // Sienna's LoRA alone. A missing file fails the photo loudly rather than quietly testing nothing.
  const figure = req.params.figurePack;
  let loraChainEnd: string | undefined = bindings.lora_name?.[0]?.nodeId;
  if (stylePacks.length || figure) {
    let after = bindings.lora_name?.[0]?.nodeId;
    if (after && graph[after]?.class_type !== 'LoraLoader') after = undefined;
    const siennaLoraId = after;
    if (figure && after) {
      const title = `Figure (preview): ${figure.file}`;
      const spliced = chainLora(graph, after, figure.file, figure.strength, title);
      graph = spliced.graph;
      graph[spliced.nodeId]._meta = { title };
      if (graph[spliced.nodeId].class_type === 'LoraLoader') after = spliced.nodeId;
    }
    for (const a of stylePacks) {
      const title = `Style pack: ${a.pack.label}`;
      const spliced = after ? chainLora(graph, after, a.pack.file, a.strength, title) : injectLora(graph, a.pack.file, a.strength, a.strength);
      graph = spliced.graph;
      graph[spliced.nodeId]._meta = { title };
      if (graph[spliced.nodeId].class_type === 'LoraLoader') after = spliced.nodeId;
    }
    loraChainEnd = after ?? loraChainEnd;
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
    const withHands = reason ? null : addHandRefine(graph, refineId, { denoise: p.handRefineDenoise });
    if (withHands) {
      graph = withHands;
      handRefine = { status: 'on', denoise: p.handRefineDenoise ?? HAND_REFINE_DENOISE };
    } else {
      handRefine = { status: 'skipped', reason: reason ?? 'no face pass to copy settings from' };
      if (reason) warnings.push(`Hand touch-up skipped — ${reason}.`);
    }
  } else {
    handRefine = { status: 'skipped', reason: 'needs face refinement on' };
  }

  // ── Targeted figure pass: her hip/butt region reshaped and redrawn with the figure LoRA, colours matched back,
  // pasted in; before the photo checks so they see the final image. A test request sets its own; otherwise
  // SIENNA_FIGURE=medium turns it on for rear and three-quarter-rear photos (front views are never changed) ──
  let figurePass: GenerationRecord['figurePass'];
  // she wears bottoms unless the outfit says otherwise (topless still has bottoms). bareBelow, not a "nude" keyword:
  // "nude thong" or "nude-colour leggings" are bottoms, and the redraw must not draw her bare crotch under them
  // the live setting is verified on standing photos only: bent over, sitting, kneeling or lying, the reshaping (built
  // around an upright body) did nothing and the redraw region fell across her back and hair (offline, 23 Oct)
  const standingPose = !NOT_STANDING_RE.test(req.fields.pose) && (!req.params.posePreset || /^(standing|looking_back|arms_crossed|hand_in_hair|mirror_selfie)/.test(req.params.posePreset));
  const fp = p.figurePass ?? (standingPose && !p.noFigurePass ? figurePassFromEnv(process.env.SIENNA_FIGURE) : undefined);
  if (fp) {
    const inView = rear || /\bthree[- ]quarter (rear|back)\b/i.test(`${req.fields.camera} ${req.fields.pose} ${req.fields.framing}`);
    let reason: string | null = !inView ? 'front view: her butt is not in the photo, so nothing to redraw'
      : Math.round(clamp(p.batchSize, 1, 8)) > 1 ? 'it works on one photo at a time (batch size is above 1), and would return only the first'
      : !(faceRefine?.status === 'on' && refineId && graph[refineId]) ? 'needs the face pass (its sampler settings are reused)'
      : !loraChainEnd || graph[loraChainEnd]?.class_type !== 'LoraLoader' ? "Sienna's LoRA node not found" : null;
    const withFigure = reason ? null : addFigurePass(graph, { file: fp.file, strength: fp.strength, denoise: fp.denoise, ...(fp.style ? { style: fp.style } : {}), ...(fp.enlarge ? { enlarge: fp.enlarge } : {}), covered: !bareBelow(req.fields.outfit, nudeOk), baseLoraId: loraChainEnd!, faceRefineId: refineId! });
    if (!reason && !withFigure) reason = 'the face pass has no prompt to copy';
    if (withFigure) {
      const missing = await missingClasses(backend, withFigure, Object.values(FIGURE_NODES));
      if (missing.length) reason = `server is missing ${describeMissing(missing)}`;
      else graph = withFigure;
    }
    figurePass = reason ? { status: 'skipped', reason } : { status: 'on', file: fp.file, strength: fp.strength, denoise: fp.denoise, ...(fp.style ? { style: fp.style } : {}), ...(fp.enlarge ? { enlarge: fp.enlarge } : {}) };
    if (reason && inView) warnings.push(`Figure pass skipped — ${reason}.`);
  }

  // ── Close-up detail pass: nude / bottomless photos in adult mode only (the node itself also touches only an area
  // NudeNet sees as exposed). A test request sets its own (or 'off'); otherwise SIENNA_DETAIL=peach|butterfly|lotte ──
  let detailPass: GenerationRecord['detailPass'];
  const dp = detailWanted;
  if (dp && contentMode === 'adult' && bareBelow(req.fields.outfit, nudeOk)) {
    const dRear = detailRearView;
    let reason: string | null = Math.round(clamp(p.batchSize, 1, 8)) > 1 ? 'it works on one photo at a time (batch size is above 1)'
      : !(faceRefine?.status === 'on' && refineId && graph[refineId]) ? 'needs the face pass (its sampler settings are reused)'
      : !loraChainEnd || graph[loraChainEnd]?.class_type !== 'LoraLoader' ? "Sienna's LoRA node not found" : null;
    const file = detailFile(dp.style, dRear);
    const strength = dp.strength ?? DETAIL_STYLES[dp.style].strength;
    const denoise = dp.denoise ?? detailDenoise(dRear);
    const withDetail = reason ? null : addDetailPass(graph, { style: dp.style, rear: dRear, strength, denoise, baseLoraId: loraChainEnd!, faceRefineId: refineId! });
    if (!reason && !withDetail) reason = 'nothing to copy the sampler settings from';
    if (withDetail) {
      const missing = await missingClasses(backend, withDetail, Object.values(DETAIL_NODES));
      const loras = missing.length ? null : await loraFiles(backend);
      if (missing.length) reason = `server is missing ${describeMissing(missing)}`;
      else if (loras && !loras.includes(file)) reason = `${file} is not on the server`;
      else graph = withDetail;
    }
    detailPass = reason ? { status: 'skipped', reason } : { status: 'on', style: dp.style, file, strength, denoise, ...(quality.hires ? { hires: true } : {}) };
    if (reason) warnings.push(`Close-up detail skipped — ${reason}.`);
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
    const hinge = POSE_PRESET_PROMPTS[req.params.posePreset ?? '']?.check === 'hinge';
    // knee-up requests too: "head to knees" came back cut at the thigh in 14 of 14 photos (22 Oct) and nothing noticed
    const bodyNodes = saveId && (fullBodyFraming(req.fields).add || hinge || kneeUpRequest(req.fields.framing)) ? bodyFrameNodes(graph, saveId) : null;
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
        // with the AI check two more tries: face-check redos alone used up all 4 in the first live test (21 Oct)
        maxAttempts: p.singleAttempt ? 1 : req.simple?.ai?.check ? AI_MAX_ATTEMPTS : EXPOSURE_MAX_ATTEMPTS,
        ...(built.outfitText ? { anchor: built.outfitText } : {}),
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
      // the hi-res pass the detail pass turned on is recorded, so checks that measure the photo know its real size
      params: { ...p, ...(quality.hires && !p.hires ? { hires: true } : {}), loraName: lora?.name ?? '' },
      seed,
      positivePrompt: positive,
      ...(promptVersion === 2 ? { promptVersion } : {}),
      ...(promptSplit ? { promptSplit } : {}),
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
      ...(figurePass ? { figurePass } : {}),
      ...(detailPass ? { detailPass } : {}),
      exposureGuard,
      submittedGraph: graph,
      images: [],
      favorite: false,
      review: {},
      notes: '',
      parentId: req.parentId,
      ...(req.simple ? { simple: req.simple } : {}),
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
    return saveRecord({ ...base, status: 'queued', promptId, promptAt: new Date().toISOString() });
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
  // Records only move on when they are checked. Check the unfinished ones here too, so a photo nobody is watching
  // (app closed mid-generation) finishes or fails and stops counting as busy; else the idle stop never comes.
  // (only submitted ones: a photo still waiting for the GPU is handled below, and checking it here would re-enter this)
  await advanceBusy((await listHistory()).filter((r) => photoBusy(r) && !photoWaiting(r) && !!r.promptId));
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

async function advanceBusy(busy: GenerationRecord[]) {
  for (const r of busy) {
    try {
      if (r.outfitEdit) await (await import('./outfit-edit')).refreshOutfitEdit(r.id);
      else await refreshStatus(r.id);
    } catch (e: any) {
      console.error('[photo-gpu] could not check', r.id, e?.message ?? e);
    }
  }
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

  // the current prompt's age: a redo is queued long after the record was made (and a photo waiting for the GPU
  // was created before the GPU booted)
  const ageSec = (Date.now() - Date.parse(rec.promptAt ?? rec.createdAt)) / 1000;
  // ComfyUI's history is read before its queue: a prompt finishing between the two reads looks unknown. Ask again.
  if (state.state === 'unknown' && ageSec > Math.max(60, settings.generationTimeoutSec)) {
    try {
      state = await backend.jobState(rec.promptId, workflow?.outputNodeIds ?? []);
    } catch {
      return rec;
    }
  }
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
        return patchRecord(id, { status: 'error', error: 'Workflow finished but produced no images. Does it have a SaveImage node?', completedAt: new Date().toISOString() });
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
        const bodyFrame = checks.body ? parseBodyFrame(state.texts?.[BODY_FRAME_NODE_ID]) : null;
        const bodyFraming = checks.body ? bodyFramingOk(fullBodyFraming(rec.fields).add, bodyFrame) : undefined;
        const poseCheck = checks.body && POSE_PRESET_PROMPTS[rec.params.posePreset ?? '']?.check === 'hinge' ? hingeCheck(bodyFrame) : undefined;
        // "head to knees": her head and knees in the picture (reported, not redone)
        const knees = checks.body && bodyFraming === undefined && kneeUpRequest(rec.fields.framing) ? kneeFramingOk(bodyFrame, outputHeight(rec.params)) : undefined;
        const notes: string[] = [];
        if (top && !top.available) notes.push(`Top check didn't run on the GPU (${top.error ?? 'detector not installed'}).`);
        if (face && !face.available) notes.push(`Face check didn't run on the GPU (${face.error ?? 'models not installed'}).`);
        const topOn = !!top?.available;
        const faceOn = !!face?.available;
        if (checks.face && !face) faceProblem = 'the face check returned no result';
        else if (face && !face.available) faceProblem = `the face check could not run (${face.error ?? 'models not installed'})`;
        // targeted figure pass (test requests): a stalled or failed step leaves the photo as made — say so
        const figureReport = rec.figurePass?.status === 'on' ? parseFigurePass(state.texts) : undefined;
        // an intentional skip (front view, no hips found) is not a failure; with the reshaping on, a failed redraw
        // still returns the reshaped photo, so say that rather than "left as made"
        if (figureReport && figureReport.completed === false && !figureReport.skipped) {
          const reshaped = typeof figureReport.enlarge?.hipWidthChange === 'number';
          notes.push(`Figure adjustment not applied — ${(figureReport.fallback ?? 'the pass did not finish').replace(/; photo left as made$/, '')}${reshaped ? '; the reshaping was kept without the redraw' : ''}.`);
        }
        const detailReport = rec.detailPass?.status === 'on' ? parseDetailPass(state.texts) : undefined;
        if (topOn || faceOn || bodyFraming !== undefined || poseCheck || knees) {
          const attempts = [
            ...guard.attempts,
            {
              seed: rec.seed,
              exposed: topOn ? top!.exposed : false,
              score: topOn ? top!.score : 0,
              ...(faceOn ? identityFields(face!, rec) : {}),
              // her joints beat the face-size guess whenever the body could be judged
              ...(bodyFraming !== undefined ? { framingOk: bodyFraming } : {}),
              ...(knees?.miss ? { framingMiss: knees.miss } : {}),
              ...(figureReport ? { figure: figureReport } : {}),
              ...(detailReport ? { detail: detailReport } : {}),
              ...(poseCheck ? { poseOk: poseCheck.ok } : {}),
              // a correction records the photo it was made from (and whether she was kept pixel for pixel)
              ...(guard.next ? { basedOn: guard.next.basedOn, ...(guard.next.keptPerson ? { keptPerson: true } : {}) } : {}),
              images: state.images,
            },
          ];
          const latest = attempts[attempts.length - 1];
          // AI check (Simple Mode): every photo that kept its top on gets a verdict — pass, fail with fixes, or
          // unavailable with the reason (never a silent pass) — so corrections are possible even after a face miss
          if (!latest.exposed && rec.simple?.ai?.check && aiEnabled() && state.images[0]) {
            try {
              const { bytes, mime } = await backend.fetchImage(state.images[0]);
              const v = await aiCheck(rec.simple.prompt, bytes, mimeFromBytes(bytes) ?? mime, undefined, rec.simple.ai?.lean, {}, checkRules(rec.fields, rec.params.fixes ?? fixesFromEnv(process.env.SIENNA_FIXES)));
              latest.aiStatus = v.status;
              if (v.status === 'unavailable') latest.aiReason = v.reason;
              else {
                const g = v.graded;
                const major = g.issues.filter((i) => i.major);
                latest.aiOk = v.status === 'pass';
                latest.aiScore = Math.round(g.compliance * 100) / 10;
                latest.aiCompliance = g.compliance;
                latest.aiMajors = g.majors;
                latest.aiIssues = major.map((i) => `${i.aspect}: ${i.problem}`);
                latest.aiMinor = g.issues.filter((i) => !i.major).map((i) => `${i.aspect}: ${i.problem}`);
                latest.aiUnsure = g.unsure;
                latest.aiChecklist = g.checklist;
                latest.aiFixes = major;
              }
            } catch (e) {
              latest.aiStatus = 'unavailable';
              latest.aiReason = `the photo could not be sent to the AI check (${(e as Error).message})`;
            }
          }
          const kind = rec.submittedGraph ? nextRetry(attempts, guard.maxAttempts) : null;
          if (kind) {
            // safety (a nipple showed): new seed, style packs a notch lower plus their coverage wording.
            // correction: the original prompt plus the AI check's fixes (what to stress, what to keep out); a new seed
            //   only when the composition itself was wrong (pose, anatomy, framing).
            // face: new seed, same prompt.
            let prompts = { positive: rec.positivePrompt, negative: rec.negativePrompt };
            let graph = rec.submittedGraph!;
            let newSeed = true;
            let correctionSeed: number | null = null;
            let next: { basedOn: number; keptPerson: boolean } | undefined;
            if (kind === 'safety') {
              const cov = addCoverage(softenPacks(graph), prompts, packCoverage((rec.stylePacks ?? []).map((p) => p.id)));
              graph = cov.graph;
              prompts = { positive: cov.positive, negative: cov.negative };
            } else if (kind === 'correction') {
              // Correct the best photo so far, not just the latest: a correction that broke the outfit must not
              // become the starting point for the next one. From the original prompt (fixes don't pile up).
              const from = pickAttempt(attempts.filter((a) => a.aiStatus === 'fail' || a.aiStatus === 'pass'));
              const fromIndex = attempts.indexOf(from);
              const base = guard.base ?? prompts;
              const earlierFixes = attempts.filter((a) => a !== from).map((a) => a.aiFixes ?? []);
              const keepOk = !!rec.simple?.ai?.keepPerson && keepPersonFor(from);
              const fix = keepOk ? buildCorrection(backgroundFixes(from.aiFixes ?? []), base, 6) : buildCorrection(pickFixes(from.aiFixes ?? [], earlierFixes), base);
              prompts = base;
              graph = stripKeepPerson(swapPrompts(graph, { positive: rec.positivePrompt, negative: rec.negativePrompt }, base));
              if (from.framingOk === false) fix.summary.push(kneeUpRequest(rec.fields.framing) ? 'framing: head to knees, knees in frame' : 'framing: full body, head to toe');
              if (from.poseOk === false) fix.summary.push('pose: as described');
              // the fix goes after the outfit, so the request's own outfit and everything after it keep their place
              const placed = placeCorrection(prompts.positive, fix.positive, guard.anchor);
              const cov = addCoverage(swapPrompts(graph, prompts, { positive: placed, negative: prompts.negative }), { positive: placed, negative: prompts.negative }, { positive: '', negative: fix.negative });
              graph = cov.graph;
              prompts = { positive: cov.positive, negative: cov.negative };
              // Only the room or the light is wrong: keep her exactly as she is and redraw around her (her outfit,
              // pose and face can't change). Anything else wrong needs her redrawn too.
              const keep = keepOk ? addKeepPerson(graph, from.images[0]) : null;
              if (keep) {
                graph = keep;
                newSeed = false;
                graph = reseed(graph, rec.seed, from.seed);
                fix.summary.push('kept her exactly as she was; redrew only the background');
              } else {
                newSeed = fix.newSeed || from.framingOk === false || from.poseOk === false || !(fix.positive || fix.negative);
                if (!newSeed && from.seed !== rec.seed) graph = reseed(graph, rec.seed, from.seed);
              }
              correctionSeed = newSeed ? null : from.seed;
              next = { basedOn: fromIndex, keptPerson: !!keep };
              latest.corrected = fix.summary;
            }
            latest.redoneFor = kind;
            const seed = newSeed ? Math.floor(Math.random() * 2 ** 48) : correctionSeed ?? rec.seed;
            if (newSeed) graph = reseed(graph, rec.seed, seed);
            try {
              const { promptId } = await backend.queuePrompt(graph, rec.clientId ?? newId('sienna-'));
              return patchRecord(id, {
                status: 'queued', promptId, promptAt: new Date().toISOString(), seed, submittedGraph: graph, queuePosition: 0,
                exposureGuard: { ...guard, attempts, next, base: guard.base ?? { positive: rec.positivePrompt, negative: rec.negativePrompt } },
                positivePrompt: prompts.positive, negativePrompt: prompts.negative,
              });
            } catch {
              // couldn't queue the retry: keep what we have
              delete latest.redoneFor;
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
          // the GPU top check only looks at her chest: with minimal bottoms and no AI verdict, coverage is unconfirmed
          if (kept.aiStatus !== 'pass' && kept.aiStatus !== 'fail' && REVEALING_BOTTOMS_RE.test(rec.fields.outfit)) {
            notes.push('Lower-body coverage not verified: the AI check gave no verdict on this photo and the GPU check only looks at her chest — check that the bottoms cover her before using it.');
          }
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
  const v = faceVerdict(face, rear, policy, { referencePhoto: !!(rec.initImage || (rec.poseImage && !rec.poseImage.label?.startsWith('Pose preset'))) });
  return {
    similarity: face.similarity,
    identity: v.status,
    ...(v.status === 'verified' || v.status === 'likely' ? { faceOk: true } : v.status === 'mismatch' ? { faceOk: false } : {}),
    ...(v.reason ? { identityReason: v.reason } : {}),
    framingOk: framingOk(fullBodyFraming(rec.fields).add, face.size, outputHeight(rec.params)),
  };
}

/** What the gallery shows about the kept photo's face: only a verified face counts as Sienna's. A face that couldn't
 * be compared ('unchecked': none found, or too small) is not retried but is filed in Needs Review like any other
 * unverified photo. */
function identitySummary(kept: { identity?: string; similarity?: number | null; identityReason?: string; faceOk?: boolean }): NonNullable<GenerationRecord['identityCheck']> {
  const similarity = kept.similarity ?? null;
  if (kept.identity === 'verified' || (kept.identity === undefined && kept.faceOk === true)) return { status: 'verified', similarity };
  if (kept.identity === 'likely') return { status: 'likely', similarity };
  if (kept.identity === 'unchecked') return { status: 'unchecked', similarity, reason: kept.identityReason };
  if (kept.identity === 'inconclusive') return { status: 'inconclusive', similarity, reason: kept.identityReason };
  return { status: 'unconfirmed', similarity, reason: kept.identityReason ?? "didn't look enough like Sienna" };
}
