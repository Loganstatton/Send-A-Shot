/**
 * Optional workflow modules
 * =========================
 *
 * A production workflow contains every module (img2img, face-reference
 * identity conditioning, pose ControlNet, outfit reference) wired in. When a generation does not
 * use a module, or the ComfyUI server lacks the module's custom nodes, the
 * module is *pruned* from a copy of the graph before it is queued:
 *
 *  1. The module's image input (the LoadImage node bound to init_image /
 *     face_reference_image / pose_image) is marked dead.
 *  2. Anything consuming a dead node is either
 *       - rewired around it, if the dead node is a known pass-through
 *         (IPAdapter*: MODEL→MODEL, ControlNetApply*: conditioning→conditioning,
 *          ApplyPulid* and ApplyInstantID: MODEL→MODEL …), or
 *       - rerouted from VAEEncode to the graph's Empty*LatentImage (img2img → txt2img), or
 *       - marked dead itself (preprocessors, ImageScale, CLIPVisionEncode …).
 *  3. Nodes no output depends on are dropped (e.g. ControlNetLoader, PuLID loaders).
 *  4. Pass-through loaders whose extra outputs are now unused are bypassed
 *     (IPAdapterUnifiedLoader* would otherwise still patch the model).
 *
 * Nothing here depends on node IDs — only on class types and the bindings
 * table — so it works for uploaded workflows too.
 */

import type { ComfyGraph, ControlKey, WorkflowBindings } from '../types';
import { cloneGraph, findOutputNodes } from './adapter';

export const MODULE_KEYS = ['init_image', 'face_reference_image', 'pose_image', 'outfit_reference_image'] as const;
export type ModuleKey = (typeof MODULE_KEYS)[number];

export const MODULE_LABELS: Record<ModuleKey, string> = {
  init_image: 'Image-to-image',
  face_reference_image: 'Face reference (identity)',
  pose_image: 'Pose / ControlNet',
  outfit_reference_image: 'Outfit reference',
};

type Link = [string, number];
const isLink = (v: unknown): v is Link => Array.isArray(v) && v.length === 2 && typeof v[0] === 'string' && typeof v[1] === 'number';

/** Output slot → input name that carries the "same" value through the node. */
export function passthroughFor(classType: string, inputs: Record<string, unknown>): Record<number, string> | null {
  if (/^ControlNetApply(Advanced|SD3)?$/.test(classType) || classType === 'ACN_AdvancedControlNetApply' || classType === 'ACN_AdvancedControlNetApply_v2') {
    return 'conditioning' in inputs ? { 0: 'conditioning' } : { 0: 'positive', 1: 'negative' };
  }
  if (classType === 'ApplyInstantID' || classType === 'ApplyInstantIDAdvanced') return { 0: 'model', 1: 'positive', 2: 'negative' };
  if (/^ApplyPulid/.test(classType)) return { 0: 'model' };
  if (/^IPAdapter/.test(classType) && 'model' in inputs) return { 0: 'model' };
  if (classType === 'FaceDetailer') return { 0: 'image' };
  return null;
}

/** Loader-style nodes that also patch the model; bypass them when their extra outputs go unused. */
function loaderExtraOutputs(classType: string): number[] | null {
  if (/^IPAdapterUnifiedLoader/.test(classType)) return [1];
  return null;
}

const EMPTY_LATENT_RE = /^Empty.*LatentImage$/;
const SAMPLER_RE = /^(KSampler|KSamplerAdvanced|SamplerCustom|SamplerCustomAdvanced)$/;

function consumersOf(g: ComfyGraph, id: string) {
  const out: { nodeId: string; input: string; slot: number }[] = [];
  for (const [nid, n] of Object.entries(g)) {
    for (const [k, v] of Object.entries(n.inputs)) if (isLink(v) && v[0] === id) out.push({ nodeId: nid, input: k, slot: v[1] });
  }
  return out;
}

/** Remove every node that no output node depends on (except ids in `preserve`). */
export function garbageCollect(graph: ComfyGraph, preserve: Set<string> = new Set()): ComfyGraph {
  const outputs = findOutputNodes(graph);
  if (outputs.length === 0) return graph;
  const keep = new Set<string>(preserve);
  const stack = [...outputs];
  while (stack.length) {
    const id = stack.pop()!;
    if (keep.has(id) || !graph[id]) continue;
    keep.add(id);
    for (const v of Object.values(graph[id].inputs)) if (isLink(v)) stack.push(v[0]);
  }
  return Object.fromEntries(Object.entries(graph).filter(([id]) => keep.has(id)));
}

/** Prune the module rooted at `rootId` (normally a LoadImage node). Throws if the graph can't run without it. */
export function pruneFrom(graph: ComfyGraph, rootId: string): ComfyGraph {
  const g = cloneGraph(graph);
  if (!g[rootId]) return g;
  // Nodes already unused before this prune (e.g. the Empty latent while the
  // img2img branch is active) must survive: a later prune may reconnect them.
  const reachable = new Set(Object.keys(garbageCollect(graph)));
  const alreadyOrphaned = new Set(Object.keys(graph).filter((id) => !reachable.has(id) && id !== rootId));
  const dead = new Set<string>([rootId]);
  const emptyLatent = Object.keys(g).find((id) => EMPTY_LATENT_RE.test(g[id].class_type));

  // Resolve a link that points at a dead node to a live equivalent, or null.
  const resolve = (link: Link): Link | null => {
    let cur: Link = link;
    for (let i = 0; i < 32; i++) {
      if (!dead.has(cur[0])) return cur;
      const node = g[cur[0]];
      if (cur[0] !== rootId) {
        const pt = passthroughFor(node.class_type, node.inputs);
        const src = pt?.[cur[1]] ? node.inputs[pt[cur[1]]] : undefined;
        if (isLink(src)) {
          cur = src;
          continue;
        }
        if (node.class_type === 'VAEEncode' && cur[1] === 0 && emptyLatent && !dead.has(emptyLatent)) return [emptyLatent, 0];
      }
      return null;
    }
    return null;
  };

  let changed = true;
  while (changed) {
    changed = false;
    for (const [id, node] of Object.entries(g)) {
      if (dead.has(id)) continue;
      for (const [k, v] of Object.entries(node.inputs)) {
        if (!isLink(v) || !dead.has(v[0])) continue;
        const r = resolve(v);
        if (r) node.inputs[k] = r;
        else {
          dead.add(id);
          changed = true;
          break;
        }
      }
    }
  }

  for (const id of dead) {
    const n = g[id];
    if (findOutputNodes({ [id]: n }).length || SAMPLER_RE.test(n.class_type)) {
      throw new Error(`Cannot remove this module: node ${id} (${n.class_type}) depends on it with no bypass path.`);
    }
  }
  for (const id of dead) delete g[id];

  // Bypass loaders (e.g. IPAdapterUnifiedLoaderFaceID) whose non-model outputs are now unused.
  const preserve = new Set([...alreadyOrphaned].filter((id) => g[id]));
  let out = garbageCollect(g, preserve);
  for (const [id, node] of Object.entries(out)) {
    const extra = loaderExtraOutputs(node.class_type);
    if (!extra) continue;
    const cons = consumersOf(out, id);
    if (cons.some((c) => extra.includes(c.slot))) continue;
    const pt = passthroughFor(node.class_type, node.inputs) ?? { 0: 'model' };
    for (const c of cons) {
      const src = out[id].inputs[pt[c.slot]];
      if (isLink(src)) out[c.nodeId].inputs[c.input] = src;
    }
    delete out[id];
  }
  out = garbageCollect(out, preserve);
  return out;
}

/**
 * Remove a pass-through node (e.g. the FaceDetailer refinement pass): its
 * consumers are rewired to the input it passes through, then anything only
 * it used (e.g. the face detector) is dropped. Throws if a consumer uses an
 * output that has no pass-through equivalent.
 */
export function bypassNode(graph: ComfyGraph, id: string): ComfyGraph {
  const node = graph[id];
  if (!node) return graph;
  const pt = passthroughFor(node.class_type, node.inputs);
  if (!pt) throw new Error(`Node ${id} (${node.class_type}) cannot be bypassed.`);
  const reachable = new Set(Object.keys(garbageCollect(graph)));
  const preserve = new Set(Object.keys(graph).filter((n) => !reachable.has(n)));
  const g = cloneGraph(graph);
  for (const c of consumersOf(g, id)) {
    const src = pt[c.slot] ? node.inputs[pt[c.slot]] : undefined;
    if (!isLink(src)) throw new Error(`Node ${c.nodeId} uses output ${c.slot} of ${node.class_type}, which has no bypass.`);
    g[c.nodeId].inputs[c.input] = src;
  }
  delete g[id];
  return garbageCollect(g, preserve);
}

/** Node ids that only exist for the pass-through node `id` (removed when it is bypassed). */
export function bypassNodeIds(graph: ComfyGraph, id: string): string[] {
  try {
    const out = bypassNode(graph, id);
    return Object.keys(graph).filter((n) => !out[n]);
  } catch {
    return [];
  }
}

/** Drop bindings that point at nodes no longer in the graph. */
export function filterBindings(graph: ComfyGraph, bindings: WorkflowBindings): WorkflowBindings {
  const out: WorkflowBindings = {};
  for (const [k, refs] of Object.entries(bindings) as [ControlKey, { nodeId: string; inputName: string }[]][]) {
    const kept = (refs ?? []).filter((r) => graph[r.nodeId]);
    if (kept.length) out[k] = kept;
  }
  return out;
}

/** Prune a module identified by its image binding. */
export function pruneModule(graph: ComfyGraph, bindings: WorkflowBindings, key: ModuleKey): { graph: ComfyGraph; bindings: WorkflowBindings } {
  let g = graph;
  for (const ref of bindings[key] ?? []) g = pruneFrom(g, ref.nodeId);
  return { graph: g, bindings: filterBindings(g, bindings) };
}

/** Node ids that belong exclusively to a module (removed when it is pruned). */
export function moduleNodeIds(graph: ComfyGraph, bindings: WorkflowBindings, key: ModuleKey): string[] {
  if (!bindings[key]?.length) return [];
  try {
    const pruned = pruneModule(graph, bindings, key).graph;
    return Object.keys(graph).filter((id) => !pruned[id]);
  } catch {
    return [];
  }
}

/** Whether a module can be removed safely (i.e. it is really optional in this graph). */
export function canPrune(graph: ComfyGraph, bindings: WorkflowBindings, key: ModuleKey): boolean {
  if (!bindings[key]?.length) return false;
  try {
    pruneModule(graph, bindings, key);
    return true;
  } catch {
    return false;
  }
}
