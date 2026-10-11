/**
 * Exposure guard. When the outfit has a top, SiennaExposureCheck (NudeNet, on the GPU) reports whether a
 * nipple showed anyway; the server then regenerates with a new seed, up to EXPOSURE_MAX_ATTEMPTS photos in all,
 * and keeps the first covered one (or the least exposed if none is). Prompt wording alone kept the top on in
 * only about half the Monokini photos at Sienna's bust size; the detector caught every exposed test photo.
 */
import { NO_TOP_RE, TOP_GARMENT_RE } from './defaults';
import type { ComfyGraph } from './types';

export const EXPOSURE_NODE_ID = 'sienna_exposure';
export const EXPOSURE_NODE_CLASS = 'SiennaExposureCheck';
/** Photos tried in all (the first + up to 3 retries); each costs one more generation. */
export const EXPOSURE_MAX_ATTEMPTS = 4;
export const EXPOSURE_THRESHOLD = 0.45;

export interface ExposureReport {
  available: boolean;
  exposed: boolean;
  score: number;
  error?: string;
}

export interface ExposureAttempt<Ref = unknown> {
  seed: number;
  exposed: boolean;
  score: number;
  images: Ref[];
}

/** The outfit describes something on top (and doesn't ask for none). */
export function outfitHasTop(outfit: string): boolean {
  return TOP_GARMENT_RE.test(outfit) && !NO_TOP_RE.test(outfit);
}

/** The check node, reading the image that goes into `saveNodeId`. Null if that node has no image input. */
export function exposureNode(graph: ComfyGraph, saveNodeId: string): ComfyGraph[string] | null {
  const images = graph[saveNodeId]?.inputs?.images;
  if (!Array.isArray(images)) return null;
  return { class_type: EXPOSURE_NODE_CLASS, inputs: { images, threshold: EXPOSURE_THRESHOLD }, _meta: { title: 'Top check (exposure)' } };
}

/** The node's JSON text output, or null if it didn't report. */
export function parseExposure(texts: string[] | undefined): ExposureReport | null {
  try {
    const r = JSON.parse(texts?.[0] ?? '');
    if (!r || typeof r !== 'object') return null;
    return { available: r.available !== false, exposed: !!r.exposed, score: Number(r.score) || 0, error: r.error ?? undefined };
  } catch {
    return null;
  }
}

/** The same graph with every seed input that held `oldSeed` set to `newSeed` (main pass, face pass, refinement). */
export function reseed(graph: ComfyGraph, oldSeed: number, newSeed: number): ComfyGraph {
  const out: ComfyGraph = {};
  for (const [id, node] of Object.entries(graph)) {
    const inputs = { ...node.inputs };
    for (const k of ['seed', 'noise_seed']) if (inputs[k] === oldSeed) inputs[k] = newSeed;
    out[id] = { ...node, inputs };
  }
  return out;
}

/** Each retry turns the style packs down by this factor (lower pack strength = more coverage in testing). */
export const EXPOSURE_PACK_SOFTEN = 0.8;
const PACK_TITLE = 'Style pack:';

/** The same graph with every style-pack LoRA turned down by EXPOSURE_PACK_SOFTEN (Sienna's own LoRA untouched). */
export function softenPacks(graph: ComfyGraph): ComfyGraph {
  const out: ComfyGraph = {};
  for (const [id, node] of Object.entries(graph)) {
    if (!node._meta?.title?.startsWith(PACK_TITLE)) {
      out[id] = node;
      continue;
    }
    const inputs = { ...node.inputs };
    for (const k of ['strength_model', 'strength_clip']) {
      if (typeof inputs[k] === 'number') inputs[k] = Math.round((inputs[k] as number) * EXPOSURE_PACK_SOFTEN * 100) / 100;
    }
    out[id] = { ...node, inputs };
  }
  return out;
}

/** The graph with coverage wording added to the prompt texts (once): positive in front, negative at the end. */
export function addCoverage(
  graph: ComfyGraph,
  prompts: { positive: string; negative: string },
  coverage: { positive: string; negative: string },
): { graph: ComfyGraph; positive: string; negative: string } {
  const positive = coverage.positive && !prompts.positive.includes(coverage.positive) ? `${coverage.positive}, ${prompts.positive}` : prompts.positive;
  const negative = coverage.negative && !prompts.negative.includes(coverage.negative) ? `${prompts.negative}, ${coverage.negative}` : prompts.negative;
  const out: ComfyGraph = {};
  for (const [id, node] of Object.entries(graph)) {
    const text = node.inputs.text;
    out[id] =
      text === prompts.positive && positive !== text ? { ...node, inputs: { ...node.inputs, text: positive } }
      : text === prompts.negative && negative !== text ? { ...node, inputs: { ...node.inputs, text: negative } }
      : node;
  }
  return { graph: out, positive, negative };
}

/** The attempt to keep: the last one if it's covered, else the least exposed. */
export function pickAttempt<Ref>(attempts: ExposureAttempt<Ref>[]): ExposureAttempt<Ref> {
  const last = attempts[attempts.length - 1];
  if (!last.exposed) return last;
  return attempts.reduce((a, b) => (b.score < a.score ? b : a));
}

/** What to tell the user once the guard has finished. */
export function exposureWarning(attempts: ExposureAttempt[], kept: ExposureAttempt): string | null {
  const retried = attempts.length - 1;
  if (kept.exposed) {
    return `Top check: all ${attempts.length} attempts showed a nipple — this is the least exposed one. Try a lower style-pack strength or describe more coverage.`;
  }
  if (!retried) return null;
  return `Top check: ${retried} photo${retried > 1 ? 's' : ''} showed a nipple and ${retried > 1 ? 'were' : 'was'} redone with a new seed (now ${kept.seed}).`;
}
