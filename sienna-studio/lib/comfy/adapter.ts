/**
 * ComfyUI workflow adapter
 * ========================
 *
 * ComfyUI executes a graph in "API format": a JSON object whose keys are
 * NODE IDs (strings like "3", "10", "27") and whose values describe one node:
 *
 *   {
 *     "3":  { "class_type": "KSampler",
 *             "inputs": { "seed": 42, "steps": 28, "cfg": 5,
 *                         "model": ["10", 0],          ← link: output 0 of node "10"
 *                         "positive": ["6", 0], ... } },
 *     "6":  { "class_type": "CLIPTextEncode", "inputs": { "text": "...", "clip": ["10", 1] } },
 *     ...
 *   }
 *
 * Export this format from ComfyUI with:  Workflow menu → Export (API)
 * (older UI: enable "Dev mode options" in settings, then "Save (API Format)").
 * The normal "Save" format (with "nodes"/"links" arrays) is NOT accepted by
 * the /prompt endpoint — the app detects and rejects it with a hint.
 *
 * ── WHERE NODE IDS MUST BE MAPPED ──────────────────────────────────────────
 * Node IDs differ in every workflow, so the app stores a "bindings" table per
 * workflow:
 *
 *     control key          →  [{ nodeId, inputName }, ...]
 *     "positive_prompt"    →  [{ nodeId: "6",  inputName: "text" }]
 *     "seed"               →  [{ nodeId: "3",  inputName: "seed" }]
 *     "lora_name"          →  [{ nodeId: "10", inputName: "lora_name" }]
 *     "face_reference_image" → [{ nodeId: "21", inputName: "image" }]  (a LoadImage node)
 *
 * `autoDetectBindings()` below guesses these from node class types and
 * titles. Anything it cannot guess (custom nodes, unusual graphs) you map by
 * hand on the Library → Workflow screen, which writes the same table.
 *
 * TIP: rename nodes in ComfyUI (right-click → Title) to "Sienna Face
 * Reference", "Pose Image" or "Init Image" before exporting — the
 * auto-detector reads `_meta.title` to tell multiple LoadImage nodes apart.
 * ────────────────────────────────────────────────────────────────────────────
 */

import type { ComfyGraph, ComfyNode, ControlKey, NodeInputRef, WorkflowBindings } from '../types';

export type ControlValue = string | number | boolean;

/** Human-facing description of each control, used in the mapping UI. */
export const CONTROL_INFO: Record<ControlKey, { label: string; hint: string; kind: 'text' | 'number' | 'enum' | 'image' }> = {
  positive_prompt: { label: 'Positive prompt', hint: 'CLIPTextEncode.text feeding the sampler “positive”', kind: 'text' },
  negative_prompt: { label: 'Negative prompt', hint: 'CLIPTextEncode.text feeding the sampler “negative”', kind: 'text' },
  checkpoint: { label: 'Model / checkpoint', hint: 'CheckpointLoaderSimple.ckpt_name or UNETLoader.unet_name', kind: 'enum' },
  lora_name: { label: 'LoRA file', hint: 'LoraLoader.lora_name', kind: 'enum' },
  lora_strength: { label: 'LoRA strength (model)', hint: 'LoraLoader.strength_model', kind: 'number' },
  lora_clip_strength: { label: 'LoRA strength (CLIP)', hint: 'LoraLoader.strength_clip', kind: 'number' },
  seed: { label: 'Seed', hint: 'KSampler.seed / RandomNoise.noise_seed', kind: 'number' },
  width: { label: 'Width', hint: 'EmptyLatentImage.width', kind: 'number' },
  height: { label: 'Height', hint: 'EmptyLatentImage.height', kind: 'number' },
  batch_size: { label: 'Batch size', hint: 'EmptyLatentImage.batch_size', kind: 'number' },
  steps: { label: 'Steps', hint: 'KSampler.steps / BasicScheduler.steps', kind: 'number' },
  cfg: { label: 'CFG', hint: 'KSampler.cfg', kind: 'number' },
  guidance: { label: 'Flux guidance', hint: 'FluxGuidance.guidance (receives the CFG value)', kind: 'number' },
  sampler: { label: 'Sampler', hint: 'KSampler.sampler_name / KSamplerSelect.sampler_name', kind: 'enum' },
  scheduler: { label: 'Scheduler', hint: 'KSampler.scheduler / BasicScheduler.scheduler', kind: 'enum' },
  denoise: { label: 'Denoise', hint: 'KSampler.denoise (img2img strength)', kind: 'number' },
  init_image: { label: 'Init image (img2img)', hint: 'LoadImage.image that feeds VAEEncode', kind: 'image' },
  face_reference_image: { label: 'Face reference image', hint: 'LoadImage.image feeding IPAdapter / PuLID / InstantID', kind: 'image' },
  face_strength: { label: 'Face reference weight', hint: 'IPAdapter*.weight / ApplyPulid.weight', kind: 'number' },
  pose_image: { label: 'Pose / ControlNet image', hint: 'LoadImage.image feeding ControlNetApply*', kind: 'image' },
  control_strength: { label: 'ControlNet strength', hint: 'ControlNetApplyAdvanced.strength', kind: 'number' },
  controlnet_model: { label: 'ControlNet model', hint: 'ControlNetLoader.control_net_name', kind: 'enum' },
  outfit_reference_image: { label: 'Outfit reference image', hint: 'LoadImage.image feeding the clothing IPAdapter branch', kind: 'image' },
  outfit_strength: { label: 'Outfit reference strength', hint: 'IPAdapterAdvanced.weight (clothing branch)', kind: 'number' },
  outfit_weight_type: { label: 'Outfit reference mode', hint: 'IPAdapterAdvanced.weight_type (clothing branch)', kind: 'enum' },
  face_refine_denoise: { label: 'Face refinement denoise', hint: 'FaceDetailer.denoise', kind: 'number' },
  face_refine_threshold: { label: 'Face refinement size threshold', hint: 'FaceDetailer.guide_size (faces smaller than this are redrawn)', kind: 'number' },
  filename_prefix: { label: 'Output filename prefix', hint: 'SaveImage.filename_prefix', kind: 'text' },
};

/** Graphs exported with the normal "Save" (UI format) instead of "Export (API)". */
export function isUiFormatWorkflow(json: unknown): boolean {
  return !!json && typeof json === 'object' && Array.isArray((json as any).nodes) && Array.isArray((json as any).links);
}

/** Validate and normalise an uploaded workflow JSON into an API-format graph. */
export function parseWorkflowJson(json: unknown): ComfyGraph {
  if (isUiFormatWorkflow(json)) {
    throw new Error(
      'This is a ComfyUI UI-format workflow. In ComfyUI use Workflow → Export (API) (or “Save (API Format)” with dev mode enabled) and upload that file.',
    );
  }
  // Some tools wrap the graph as { prompt: {...} }.
  const obj = json && typeof json === 'object' && 'prompt' in (json as any) ? (json as any).prompt : json;
  if (!obj || typeof obj !== 'object' || Array.isArray(obj)) throw new Error('Workflow JSON must be an object of nodes.');
  const graph: ComfyGraph = {};
  for (const [id, node] of Object.entries(obj as Record<string, any>)) {
    if (!node || typeof node !== 'object' || typeof node.class_type !== 'string' || typeof node.inputs !== 'object') {
      throw new Error(`Node "${id}" is not a valid API-format node (needs class_type and inputs).`);
    }
    graph[id] = { class_type: node.class_type, inputs: { ...node.inputs }, ...(node._meta ? { _meta: node._meta } : {}) };
  }
  if (Object.keys(graph).length === 0) throw new Error('Workflow has no nodes.');
  return graph;
}

export function cloneGraph(g: ComfyGraph): ComfyGraph {
  return JSON.parse(JSON.stringify(g));
}

type Link = [string, number];
function isLink(v: unknown): v is Link {
  return Array.isArray(v) && v.length === 2 && typeof v[0] === 'string' && typeof v[1] === 'number';
}

function title(node: ComfyNode): string {
  return (node._meta?.title ?? '').toLowerCase();
}

// ── Applying values ─────────────────────────────────────────────────────────

export interface ApplyResult {
  graph: ComfyGraph;
  /** Controls that had a value but no binding (feature unsupported by this workflow). */
  unbound: ControlKey[];
}

/**
 * Write control values into a copy of the graph according to the bindings.
 * Values that are `undefined` leave the template's own value in place.
 */
export function applyBindings(
  template: ComfyGraph,
  bindings: WorkflowBindings,
  values: Partial<Record<ControlKey, ControlValue | undefined>>,
): ApplyResult {
  const graph = cloneGraph(template);
  const unbound: ControlKey[] = [];
  for (const [key, value] of Object.entries(values) as [ControlKey, ControlValue | undefined][]) {
    if (value === undefined || value === '') continue;
    const refs = bindings[key];
    if (!refs || refs.length === 0) {
      unbound.push(key);
      continue;
    }
    for (const ref of refs) {
      const node = graph[ref.nodeId];
      if (!node) throw new Error(`Binding "${key}" points to node ${ref.nodeId}, which is not in the workflow.`);
      if (isLink(node.inputs[ref.inputName])) {
        throw new Error(`Binding "${key}" targets ${ref.nodeId}.${ref.inputName}, which is a link to another node, not a value.`);
      }
      node.inputs[ref.inputName] = value;
    }
  }
  return { graph, unbound };
}

/** Return a list of problems with a bindings table (missing nodes, link inputs). */
export function validateBindings(graph: ComfyGraph, bindings: WorkflowBindings): string[] {
  const problems: string[] = [];
  for (const [key, refs] of Object.entries(bindings) as [ControlKey, NodeInputRef[]][]) {
    for (const ref of refs ?? []) {
      const node = graph[ref.nodeId];
      if (!node) problems.push(`${key}: node ${ref.nodeId} does not exist`);
      else if (isLink(node.inputs[ref.inputName])) problems.push(`${key}: ${ref.nodeId}.${ref.inputName} is a link, not a value`);
    }
  }
  return problems;
}

// ── LoRA injection ──────────────────────────────────────────────────────────

const MODEL_SOURCES: Record<string, { model?: number; clip?: number }> = {
  CheckpointLoaderSimple: { model: 0, clip: 1 },
  CheckpointLoader: { model: 0, clip: 1 },
  'Checkpoint Loader (Simple)': { model: 0, clip: 1 },
  UNETLoader: { model: 0 },
  UnetLoaderGGUF: { model: 0 },
  CLIPLoader: { clip: 0 },
  DualCLIPLoader: { clip: 0 },
  TripleCLIPLoader: { clip: 0 },
  DualCLIPLoaderGGUF: { clip: 0 },
};

function nextNodeId(graph: ComfyGraph): string {
  const nums = Object.keys(graph)
    .map((k) => parseInt(k, 10))
    .filter((n) => Number.isFinite(n));
  return String((nums.length ? Math.max(...nums) : 0) + 1000);
}

/**
 * Splice a LoraLoader between the model/CLIP loaders and everything that
 * consumes them. Used by Sienna Lock when a workflow has no LoRA node.
 * Returns the new node id plus bindings for it.
 */
export function injectLora(
  graph: ComfyGraph,
  loraName: string,
  strength: number,
  clipStrength: number,
): { graph: ComfyGraph; nodeId: string } {
  const g = cloneGraph(graph);
  let modelSrc: Link | null = null;
  let clipSrc: Link | null = null;
  for (const [id, node] of Object.entries(g)) {
    const src = MODEL_SOURCES[node.class_type];
    if (!src) continue;
    if (src.model !== undefined && !modelSrc) modelSrc = [id, src.model];
    if (src.clip !== undefined && !clipSrc) clipSrc = [id, src.clip];
  }
  if (!modelSrc) throw new Error('Cannot inject LoRA: no checkpoint/UNET loader found in workflow. Add a LoraLoader node and map it.');

  const newId = nextNodeId(g);
  const same = (a: unknown, b: Link | null) => !!b && isLink(a) && a[0] === b[0] && a[1] === b[1];

  for (const node of Object.values(g)) {
    for (const [k, v] of Object.entries(node.inputs)) {
      if (same(v, modelSrc)) node.inputs[k] = [newId, 0];
      else if (same(v, clipSrc)) node.inputs[k] = [newId, 1];
    }
  }

  if (clipSrc) {
    g[newId] = {
      class_type: 'LoraLoader',
      inputs: { model: modelSrc, clip: clipSrc, lora_name: loraName, strength_model: strength, strength_clip: clipStrength },
      _meta: { title: 'Sienna LoRA (auto-injected)' },
    };
  } else {
    g[newId] = {
      class_type: 'LoraLoaderModelOnly',
      inputs: { model: modelSrc, lora_name: loraName, strength_model: strength },
      _meta: { title: 'Sienna LoRA (auto-injected)' },
    };
  }
  return { graph: g, nodeId: newId };
}

/**
 * Remove a LoraLoader / LoraLoaderModelOnly node, reconnecting its consumers
 * straight to the LoRA's own model/clip inputs. Used when no LoRA is chosen.
 */
export function bypassLora(graph: ComfyGraph, nodeId: string): ComfyGraph {
  const g = cloneGraph(graph);
  const node = g[nodeId];
  if (!node || !/^LoraLoader/.test(node.class_type)) return g;
  const upstream: Record<number, unknown> = { 0: node.inputs.model, 1: node.inputs.clip };
  delete g[nodeId];
  for (const n of Object.values(g)) {
    for (const [k, v] of Object.entries(n.inputs)) {
      if (isLink(v) && v[0] === nodeId && upstream[v[1]] !== undefined) n.inputs[k] = upstream[v[1]];
    }
  }
  return g;
}

// ── Output discovery ────────────────────────────────────────────────────────

const OUTPUT_CLASSES = new Set(['SaveImage', 'Image Save', 'SaveImageWebsocket', 'SaveImageExtended']);

export function findOutputNodes(graph: ComfyGraph): string[] {
  return Object.entries(graph)
    .filter(([, n]) => OUTPUT_CLASSES.has(n.class_type))
    .map(([id]) => id);
}

// ── Auto-detection ──────────────────────────────────────────────────────────

const SAMPLERS = new Set(['KSampler', 'KSamplerAdvanced', 'SamplerCustom', 'SamplerCustomAdvanced']);

/**
 * Follow a link backwards through pass-through conditioning nodes until we
 * reach a CLIPTextEncode; returns its node id.
 */
function traceToTextEncoder(graph: ComfyGraph, link: unknown, depth = 0): string | null {
  if (!isLink(link) || depth > 8) return null;
  const node = graph[link[0]];
  if (!node) return null;
  if (/TextEncode/i.test(node.class_type) && typeof node.inputs.text === 'string') return link[0];
  if (/TextEncode/i.test(node.class_type) && typeof node.inputs.clip_l === 'string') return link[0];
  // ControlNetApplyAdvanced: positive/negative pass through by output slot.
  if (node.class_type.startsWith('ControlNetApply')) {
    const key = link[1] === 1 ? 'negative' : 'positive';
    return traceToTextEncoder(graph, node.inputs[key] ?? node.inputs.conditioning, depth + 1);
  }
  for (const key of ['conditioning', 'positive', 'conditioning_to', 'conditioning_1']) {
    if (isLink(node.inputs[key])) return traceToTextEncoder(graph, node.inputs[key], depth + 1);
  }
  return null;
}

function push(b: WorkflowBindings, key: ControlKey, nodeId: string, inputName: string, node: ComfyNode) {
  if (!(inputName in node.inputs) || isLink(node.inputs[inputName])) return;
  const list = (b[key] ??= []);
  if (!list.some((r) => r.nodeId === nodeId && r.inputName === inputName)) list.push({ nodeId, inputName });
}

/** Which node consumes a given node's outputs. */
function consumers(graph: ComfyGraph, id: string): ComfyNode[] {
  return Object.values(graph).filter((n) => Object.values(n.inputs).some((v) => isLink(v) && v[0] === id));
}

/**
 * Guess bindings from class types and titles. Covers the stock SD1.5/SDXL
 * graph, Flux graphs (UNETLoader + FluxGuidance + SamplerCustomAdvanced),
 * img2img, IPAdapter (incl. FaceID), PuLID, InstantID and ControlNet.
 * Always review the result in the mapping screen.
 */
export function autoDetectBindings(graph: ComfyGraph): WorkflowBindings {
  const b: WorkflowBindings = {};

  for (const [id, node] of Object.entries(graph)) {
    const t = node.class_type;
    if (SAMPLERS.has(t)) {
      push(b, 'seed', id, t === 'KSamplerAdvanced' ? 'noise_seed' : 'seed', node);
      push(b, 'seed', id, 'noise_seed', node);
      push(b, 'steps', id, 'steps', node);
      push(b, 'cfg', id, 'cfg', node);
      push(b, 'sampler', id, 'sampler_name', node);
      push(b, 'scheduler', id, 'scheduler', node);
      push(b, 'denoise', id, 'denoise', node);
      const pos = traceToTextEncoder(graph, node.inputs.positive);
      const neg = traceToTextEncoder(graph, node.inputs.negative);
      if (pos) push(b, 'positive_prompt', pos, 'text', graph[pos]);
      if (neg && neg !== pos) push(b, 'negative_prompt', neg, 'text', graph[neg]);
    }
    if (t === 'BasicGuider' || t === 'CFGGuider') {
      const pos = traceToTextEncoder(graph, node.inputs.conditioning ?? node.inputs.positive);
      if (pos) push(b, 'positive_prompt', pos, 'text', graph[pos]);
      const neg = traceToTextEncoder(graph, node.inputs.negative);
      if (neg && neg !== pos) push(b, 'negative_prompt', neg, 'text', graph[neg]);
      push(b, 'cfg', id, 'cfg', node);
    }
    if (t === 'RandomNoise') push(b, 'seed', id, 'noise_seed', node);
    if (t === 'KSamplerSelect') push(b, 'sampler', id, 'sampler_name', node);
    if (t === 'BasicScheduler') {
      push(b, 'steps', id, 'steps', node);
      push(b, 'scheduler', id, 'scheduler', node);
      push(b, 'denoise', id, 'denoise', node);
    }
    if (t === 'FluxGuidance') push(b, 'guidance', id, 'guidance', node);
    if (t === 'CheckpointLoaderSimple' || t === 'CheckpointLoader') push(b, 'checkpoint', id, 'ckpt_name', node);
    if (t === 'UNETLoader') push(b, 'checkpoint', id, 'unet_name', node);
    if (t === 'LoraLoader' || t === 'LoraLoaderModelOnly') {
      // Only the first LoRA node is treated as "the" character LoRA.
      if (!b.lora_name) {
        push(b, 'lora_name', id, 'lora_name', node);
        push(b, 'lora_strength', id, 'strength_model', node);
        push(b, 'lora_clip_strength', id, 'strength_clip', node);
      }
    }
    if (/^Empty.*LatentImage$/.test(t)) {
      push(b, 'width', id, 'width', node);
      push(b, 'height', id, 'height', node);
      push(b, 'batch_size', id, 'batch_size', node);
    }
    if (t === 'ModelSamplingFlux') {
      push(b, 'width', id, 'width', node);
      push(b, 'height', id, 'height', node);
    }
    if (/^IPAdapter/.test(t) && 'weight' in node.inputs) push(b, 'face_strength', id, 'weight', node);
    if (t === 'ApplyPulid' || t === 'ApplyPulidFlux' || t === 'ApplyInstantID') push(b, 'face_strength', id, 'weight', node);
    if (t === 'ControlNetLoader') push(b, 'controlnet_model', id, 'control_net_name', node);
    if (t.startsWith('ControlNetApply')) push(b, 'control_strength', id, 'strength', node);
    if (t === 'FaceDetailer') {
      push(b, 'face_refine_denoise', id, 'denoise', node);
      push(b, 'face_refine_threshold', id, 'guide_size', node);
      push(b, 'seed', id, 'seed', node);
      push(b, 'steps', id, 'steps', node);
      push(b, 'cfg', id, 'cfg', node);
      push(b, 'sampler', id, 'sampler_name', node);
      push(b, 'scheduler', id, 'scheduler', node);
    }
    if (OUTPUT_CLASSES.has(t)) push(b, 'filename_prefix', id, 'filename_prefix', node);
  }

  // LoadImage nodes: decide role by title first, then by what consumes them.
  for (const [id, node] of Object.entries(graph)) {
    if (node.class_type !== 'LoadImage') continue;
    const tt = title(node);
    let role: ControlKey | null = null;
    if (/face|ref|identity|sienna|ipadapter|pulid/.test(tt)) role = 'face_reference_image';
    else if (/pose|control|openpose|depth|canny/.test(tt)) role = 'pose_image';
    else if (/init|img2img|source|input|base/.test(tt)) role = 'init_image';
    else {
      const cons = consumers(graph, id).map((c) => c.class_type);
      if (cons.some((c) => /VAEEncode/.test(c))) role = 'init_image';
      else if (cons.some((c) => /IPAdapter|Pulid|InstantID|FaceAnalysis|CLIPVisionEncode/i.test(c))) role = 'face_reference_image';
      else if (cons.some((c) => /ControlNet|Preprocessor|OpenPose|DWPreprocessor/i.test(c))) role = 'pose_image';
    }
    if (role && !b[role]) push(b, role, id, 'image', node);
  }

  return b;
}

/** Feature flags for the UI derived from bindings. */
export function capabilities(bindings: WorkflowBindings) {
  const has = (k: ControlKey) => (bindings[k]?.length ?? 0) > 0;
  return {
    lora: has('lora_name'),
    img2img: has('init_image'),
    faceReference: has('face_reference_image'),
    pose: has('pose_image'),
    outfit: has('outfit_reference_image'),
    sampler: has('sampler'),
    scheduler: has('scheduler'),
    checkpoint: has('checkpoint'),
    denoise: has('denoise'),
    guidance: has('guidance'),
    controlnetModel: has('controlnet_model'),
    faceRefine: has('face_refine_denoise'),
  };
}
export type Capabilities = ReturnType<typeof capabilities>;
