/**
 * Example workflow adapters
 * =========================
 *
 * Each entry pairs an API-format ComfyUI graph (workflows/examples/*.json)
 * with an explicit BINDINGS table: which UI control writes into which node
 * input. The node IDs below ("3", "6", "10", ...) are the keys of the JSON
 * file. If you edit a workflow in ComfyUI and re-export it, node IDs can
 * change — re-check these tables (or use the in-app mapping editor, which
 * stores the same structure for uploaded workflows).
 *
 * To add your own built-in: drop the API JSON into workflows/examples/, import
 * it here and add an entry. Most users just upload JSON from the Library
 * screen instead — no code needed.
 */

import type { ComfyGraph, WorkflowBindings, WorkflowTemplate } from '../types';
import sdxlTxt2img from '../../workflows/examples/sdxl-txt2img-lora.json';
import sdxlImg2img from '../../workflows/examples/sdxl-img2img-lora.json';
import sdxlFaceIdPose from '../../workflows/examples/sdxl-faceid-pose.json';
import fluxDevLora from '../../workflows/examples/flux-dev-lora.json';

const ref = (nodeId: string, inputName: string) => [{ nodeId, inputName }];

// ── SDXL text-to-image + LoRA ───────────────────────────────────────────────
// 4 = CheckpointLoaderSimple, 10 = LoraLoader, 6/7 = CLIPTextEncode (+/-),
// 5 = EmptyLatentImage, 3 = KSampler, 9 = SaveImage
const SDXL_TXT2IMG_BINDINGS: WorkflowBindings = {
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

// ── SDXL image-to-image + LoRA ──────────────────────────────────────────────
// 11 = LoadImage ("Init Image") → 13 ImageScale → 12 VAEEncode → 3 KSampler
// The output size comes from the ImageScale node, so width/height map there.
const SDXL_IMG2IMG_BINDINGS: WorkflowBindings = {
  checkpoint: ref('4', 'ckpt_name'),
  lora_name: ref('10', 'lora_name'),
  lora_strength: ref('10', 'strength_model'),
  lora_clip_strength: ref('10', 'strength_clip'),
  positive_prompt: ref('6', 'text'),
  negative_prompt: ref('7', 'text'),
  init_image: ref('11', 'image'),
  width: ref('13', 'width'),
  height: ref('13', 'height'),
  seed: ref('3', 'seed'),
  steps: ref('3', 'steps'),
  cfg: ref('3', 'cfg'),
  sampler: ref('3', 'sampler_name'),
  scheduler: ref('3', 'scheduler'),
  denoise: ref('3', 'denoise'),
  filename_prefix: ref('9', 'filename_prefix'),
};

// ── SDXL + IPAdapter FaceID + OpenPose ControlNet ───────────────────────────
// Requires custom nodes: ComfyUI_IPAdapter_plus (+ insightface) and the
// FaceID Plus V2 models; an SDXL OpenPose ControlNet in models/controlnet.
// 21 = LoadImage ("Sienna Face Reference") → 22 IPAdapterFaceID (weight)
// 30 = LoadImage ("Pose Image") → 32 ControlNetApplyAdvanced (strength)
// 31 = ControlNetLoader
const SDXL_FACEID_POSE_BINDINGS: WorkflowBindings = {
  ...SDXL_TXT2IMG_BINDINGS,
  face_reference_image: ref('21', 'image'),
  face_strength: ref('22', 'weight'),
  pose_image: ref('30', 'image'),
  control_strength: ref('32', 'strength'),
  controlnet_model: ref('31', 'control_net_name'),
};

// ── Flux.1-dev + LoRA ───────────────────────────────────────────────────────
// 12 = UNETLoader (model select), 11 = DualCLIPLoader, 20 = LoraLoader,
// 6 = positive text, 33 = (ignored) negative text, 26 = FluxGuidance,
// 5 = EmptySD3LatentImage, 3 = KSampler (cfg MUST stay 1.0 for Flux dev).
// The app's "CFG" slider is routed to FluxGuidance.guidance instead.
const FLUX_BINDINGS: WorkflowBindings = {
  checkpoint: ref('12', 'unet_name'),
  lora_name: ref('20', 'lora_name'),
  lora_strength: ref('20', 'strength_model'),
  lora_clip_strength: ref('20', 'strength_clip'),
  positive_prompt: ref('6', 'text'),
  negative_prompt: ref('33', 'text'),
  guidance: ref('26', 'guidance'),
  width: ref('5', 'width'),
  height: ref('5', 'height'),
  batch_size: ref('5', 'batch_size'),
  seed: ref('3', 'seed'),
  steps: ref('3', 'steps'),
  sampler: ref('3', 'sampler_name'),
  scheduler: ref('3', 'scheduler'),
  denoise: ref('3', 'denoise'),
  filename_prefix: ref('9', 'filename_prefix'),
};

export function builtinWorkflows(): WorkflowTemplate[] {
  const at = new Date(0).toISOString();
  const wf = (
    id: string,
    name: string,
    description: string,
    graph: unknown,
    bindings: WorkflowBindings,
  ): WorkflowTemplate => ({
    id,
    name,
    description,
    graph: graph as ComfyGraph,
    bindings,
    outputNodeIds: [],
    allowLoraInjection: true,
    builtIn: true,
    updatedAt: at,
  });
  return [
    wf(
      'builtin-sdxl-txt2img',
      'SDXL · text-to-image + LoRA',
      'Stock ComfyUI nodes only. Good default for a trained Sienna SDXL LoRA.',
      sdxlTxt2img,
      SDXL_TXT2IMG_BINDINGS,
    ),
    wf(
      'builtin-sdxl-img2img',
      'SDXL · image-to-image + LoRA',
      'Restyle an existing image (e.g. a previous Sienna render). Uses the Init Image + Denoise controls.',
      sdxlImg2img,
      SDXL_IMG2IMG_BINDINGS,
    ),
    wf(
      'builtin-sdxl-faceid-pose',
      'SDXL · LoRA + IPAdapter FaceID + Pose ControlNet',
      'Strongest identity lock. Needs ComfyUI_IPAdapter_plus, insightface, FaceID Plus V2 models and an SDXL OpenPose ControlNet.',
      sdxlFaceIdPose,
      SDXL_FACEID_POSE_BINDINGS,
    ),
    wf(
      'builtin-flux-dev-lora',
      'Flux.1-dev · text-to-image + LoRA',
      'Flux dev with a Flux-trained Sienna LoRA. CFG slider drives FluxGuidance (try 2.5–3.5).',
      fluxDevLora,
      FLUX_BINDINGS,
    ),
  ];
}
