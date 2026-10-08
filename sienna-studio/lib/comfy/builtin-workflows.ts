/**
 * Built-in workflow adapters
 * ==========================
 *
 * Each entry pairs an API-format ComfyUI graph (workflows/examples/*.json)
 * with a BINDINGS table: which app control writes into which node input.
 * The node IDs below are simply the keys of those JSON files — nothing in the
 * app assumes fixed IDs. If you edit a graph in ComfyUI and re-export it, IDs
 * may change: re-run auto-detect or edit the mapping in Library → Workflows
 * (edits to built-ins are saved as overrides; "Reset" restores these).
 *
 * The production graphs contain OPTIONAL modules. They are pruned
 * automatically per generation (lib/comfy/modules.ts) when not used or when
 * the server lacks their custom nodes:
 *   init_image            → img2img branch (LoadImage → ImageScale → VAEEncode)
 *   face_reference_image  → identity conditioning (IPAdapter FaceID / PuLID-Flux)
 *   pose_image            → ControlNet pose branch
 *   outfit_reference_image → (SDXL only) garment-only IPAdapter: person mask minus
 *                            face/hair on grey → IPAdapterAdvanced on the first pass
 * The SDXL graph also has an optional face-refinement pass (FaceDetailer from
 * ComfyUI-Impact-Pack) that is bypassed when switched off or not installed.
 */

import type { ComfyGraph, WorkflowBindings, WorkflowTemplate } from '../types';
import sdxlProduction from '../../workflows/examples/sienna-sdxl-production.json';
import fluxProduction from '../../workflows/examples/sienna-flux-production.json';
import basicSdxl from '../../workflows/examples/basic-sdxl-txt2img-lora.json';

const ref = (nodeId: string, inputName: string) => [{ nodeId, inputName }];

export const PRIMARY_WORKFLOW_ID = 'sienna-sdxl-production';

// ── Sienna Production · SDXL ────────────────────────────────────────────────
// 1 CheckpointLoaderSimple · 2 LoraLoader (Sienna) · 3/4 CLIPTextEncode ±
// 10 LoadImage face → 11 IPAdapterUnifiedLoaderFaceID → 12 IPAdapterFaceID
// 20 LoadImage pose photo → 23 DWPreprocessor (skeleton only) → 22 ControlNetApplyAdvanced ← 21 ControlNetLoader
// 30 LoadImage init → 31 ImageScale → 32 VAEEncode   |   33 EmptyLatentImage
// 60 LoadImage outfit → 61-68 garment isolation (lib/outfit.ts) → 69 PrepImageForClipVision
//   → 70/71 IPAdapter + CLIP-ViT-H loaders → 72 IPAdapterAdvanced (first pass only; FaceDetailer keeps the plain LoRA model)
// Optional (unwired unless enabled): 24 pad pose photo · 25 SiennaPoseRetarget ·
//   80-85 refinement pass (decode → upscale → encode → own-strength LoRA + outfit adapter → low-denoise KSampler)
// 40 KSampler · 41 VAEDecode → 50 face detector → 51 FaceDetailer (optional) → 42 SaveImage
const SDXL_PRODUCTION: WorkflowBindings = {
  checkpoint: ref('1', 'ckpt_name'),
  lora_name: [
    { nodeId: '2', inputName: 'lora_name' },
    { nodeId: '83', inputName: 'lora_name' },
  ],
  lora_strength: ref('2', 'strength_model'),
  lora_clip_strength: ref('2', 'strength_clip'),
  positive_prompt: ref('3', 'text'),
  negative_prompt: ref('4', 'text'),
  face_reference_image: ref('10', 'image'),
  face_strength: ref('12', 'weight'),
  pose_image: ref('20', 'image'),
  controlnet_model: ref('21', 'control_net_name'),
  control_strength: ref('22', 'strength'),
  init_image: ref('30', 'image'),
  outfit_reference_image: ref('60', 'image'),
  outfit_strength: [
    { nodeId: '72', inputName: 'weight' },
    { nodeId: '84', inputName: 'weight' },
  ],
  outfit_weight_type: [
    { nodeId: '72', inputName: 'weight_type' },
    { nodeId: '84', inputName: 'weight_type' },
  ],
  // Optional Phase 1 nodes — unwired in the template; generate.ts wires them in when enabled.
  pose_pad_left: ref('24', 'left'),
  pose_pad_top: ref('24', 'top'),
  pose_pad_right: ref('24', 'right'),
  pose_pad_bottom: ref('24', 'bottom'),
  pose_retarget_strength: ref('25', 'strength'),
  pose_proportions: ref('25', 'proportions'),
  hires_scale: ref('81', 'scale_by'),
  hires_denoise: ref('85', 'denoise'),
  hires_lora_strength: ref('83', 'strength_model'),
  hires_steps: ref('85', 'steps'),
  width: [
    { nodeId: '31', inputName: 'width' },
    { nodeId: '33', inputName: 'width' },
  ],
  height: [
    { nodeId: '31', inputName: 'height' },
    { nodeId: '33', inputName: 'height' },
  ],
  batch_size: ref('33', 'batch_size'),
  // Sampling values also drive the face-refinement pass (51), so it matches the first pass.
  seed: [
    { nodeId: '40', inputName: 'seed' },
    { nodeId: '51', inputName: 'seed' },
    { nodeId: '85', inputName: 'seed' },
  ],
  steps: [
    { nodeId: '40', inputName: 'steps' },
    { nodeId: '51', inputName: 'steps' },
  ],
  cfg: [
    { nodeId: '40', inputName: 'cfg' },
    { nodeId: '51', inputName: 'cfg' },
    { nodeId: '85', inputName: 'cfg' },
  ],
  sampler: [
    { nodeId: '40', inputName: 'sampler_name' },
    { nodeId: '51', inputName: 'sampler_name' },
    { nodeId: '85', inputName: 'sampler_name' },
  ],
  scheduler: [
    { nodeId: '40', inputName: 'scheduler' },
    { nodeId: '51', inputName: 'scheduler' },
    { nodeId: '85', inputName: 'scheduler' },
  ],
  denoise: ref('40', 'denoise'),
  face_refine_denoise: ref('51', 'denoise'),
  face_refine_threshold: ref('51', 'guide_size'),
  filename_prefix: ref('42', 'filename_prefix'),
};

// ── Sienna Production · Flux.1-dev ──────────────────────────────────────────
// 1 UNETLoader · 2 DualCLIPLoader · 3 VAELoader · 4 LoraLoader (Sienna)
// 5/6 CLIPTextEncode ± · 7 FluxGuidance (the app's CFG slider drives this)
// 10 LoadImage face → 11-13 PuLID-Flux loaders → 14 ApplyPulidFlux
// 20 LoadImage pose → 21 ControlNetLoader → 23 SetUnionControlNetType → 22 ControlNetApplyAdvanced
// 30 LoadImage init → 31 ImageScale → 32 VAEEncode   |   33 EmptySD3LatentImage
// 40 KSampler (cfg stays 1.0 — deliberately NOT mapped) · 41 VAEDecode · 42 SaveImage
const FLUX_PRODUCTION: WorkflowBindings = {
  checkpoint: ref('1', 'unet_name'),
  lora_name: ref('4', 'lora_name'),
  lora_strength: ref('4', 'strength_model'),
  lora_clip_strength: ref('4', 'strength_clip'),
  positive_prompt: ref('5', 'text'),
  negative_prompt: ref('6', 'text'),
  guidance: ref('7', 'guidance'),
  face_reference_image: ref('10', 'image'),
  face_strength: ref('14', 'weight'),
  pose_image: ref('20', 'image'),
  controlnet_model: ref('21', 'control_net_name'),
  control_strength: ref('22', 'strength'),
  init_image: ref('30', 'image'),
  width: [
    { nodeId: '31', inputName: 'width' },
    { nodeId: '33', inputName: 'width' },
  ],
  height: [
    { nodeId: '31', inputName: 'height' },
    { nodeId: '33', inputName: 'height' },
  ],
  batch_size: ref('33', 'batch_size'),
  seed: ref('40', 'seed'),
  steps: ref('40', 'steps'),
  sampler: ref('40', 'sampler_name'),
  scheduler: ref('40', 'scheduler'),
  denoise: ref('40', 'denoise'),
  filename_prefix: ref('42', 'filename_prefix'),
};

// ── Basic SDXL text-to-image (stock nodes only; fallback) ───────────────────
// 4 CheckpointLoaderSimple · 10 LoraLoader · 6/7 CLIPTextEncode · 5 EmptyLatentImage · 3 KSampler · 9 SaveImage
const BASIC_SDXL: WorkflowBindings = {
  checkpoint: ref('4', 'ckpt_name'),
  lora_name: ref('10', 'lora_name'),
  lora_strength: ref('10', 'strength_model'),
  lora_clip_strength: ref('10', 'strength_clip'),
  positive_prompt: ref('6', 'text'),
  negative_prompt: ref('7', 'text'),
  width: ref('5', 'width'),
  height: ref('5', 'height'),
  batch_size: ref('5', 'batch_size'),
  seed: ref('3', 'seed'),
  steps: ref('3', 'steps'),
  cfg: ref('3', 'cfg'),
  sampler: ref('3', 'sampler_name'),
  scheduler: ref('3', 'scheduler'),
  denoise: ref('3', 'denoise'),
  filename_prefix: ref('9', 'filename_prefix'),
};

/** Workflow ids from earlier versions → their replacement. */
export const LEGACY_WORKFLOW_IDS: Record<string, string> = {
  'builtin-sdxl-txt2img': 'basic-sdxl-txt2img',
  'builtin-sdxl-img2img': 'sienna-sdxl-production',
  'builtin-sdxl-faceid-pose': 'sienna-sdxl-production',
  'builtin-flux-dev-lora': 'sienna-flux-production',
};

export function builtinWorkflows(): WorkflowTemplate[] {
  const at = new Date(0).toISOString();
  const ALL_OPTIONAL: WorkflowTemplate['optionalModules'] = ['init_image', 'face_reference_image', 'pose_image'];
  return [
    {
      id: 'sienna-sdxl-production',
      name: 'Sienna Production · SDXL',
      description:
        'Primary workflow. SDXL checkpoint + Sienna LoRA, optional img2img, IPAdapter FaceID identity, pose ControlNet, outfit reference and small-face refinement (each removed automatically when unused or unavailable).',
      graph: sdxlProduction as ComfyGraph,
      bindings: SDXL_PRODUCTION,
      outputNodeIds: [],
      allowLoraInjection: true,
      optionalModules: [...ALL_OPTIONAL, 'outfit_reference_image'],
      family: 'sdxl',
      builtIn: true,
      updatedAt: at,
    },
    {
      id: 'sienna-flux-production',
      name: 'Sienna Production · Flux.1-dev',
      description:
        'Flux.1-dev UNET + Flux-trained Sienna LoRA, optional img2img, PuLID-Flux identity and union ControlNet pose. CFG slider drives Flux guidance (2.5–3.5).',
      graph: fluxProduction as ComfyGraph,
      bindings: FLUX_PRODUCTION,
      outputNodeIds: [],
      allowLoraInjection: true,
      optionalModules: ALL_OPTIONAL,
      family: 'flux',
      builtIn: true,
      updatedAt: at,
    },
    {
      id: 'basic-sdxl-txt2img',
      name: 'Basic SDXL · text-to-image + LoRA',
      description: 'Minimal fallback using only stock ComfyUI nodes. Useful for isolating problems.',
      graph: basicSdxl as ComfyGraph,
      bindings: BASIC_SDXL,
      outputNodeIds: [],
      allowLoraInjection: true,
      optionalModules: [],
      family: 'sdxl',
      builtIn: true,
      updatedAt: at,
    },
  ];
}
