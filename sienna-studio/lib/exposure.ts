/**
 * Exposure guard. When the outfit has a top, SiennaExposureCheck (NudeNet, on the GPU) reports whether a
 * nipple showed anyway; the server then regenerates with a new seed, up to EXPOSURE_MAX_ATTEMPTS photos in all,
 * and keeps the first covered one (none, with an error, if every attempt showed a nipple). Prompt wording alone kept the top on in
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
  /** Face check result (absent when the face check isn't running). */
  similarity?: number | null;
  /** True only when the face was verified as Sienna's; false when it clearly wasn't; unset when it couldn't be judged. */
  faceOk?: boolean;
  /** Pose-aware verdict (lib/identity.ts) and, when not verified, why. */
  identity?: 'verified' | 'mismatch' | 'inconclusive';
  identityReason?: string;
  colour?: 'consistent' | 'differs' | 'unknown';
  /** False when a full-body request came back as a closer shot. */
  framingOk?: boolean;
  images: Ref[];
}

/** This attempt needs redoing: a nipple showed, her face drifted, or a full-body shot came out too close. */
export function failed(a: ExposureAttempt): boolean {
  return a.exposed || a.faceOk === false || a.framingOk === false;
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

/** The attempt to keep: the last one if it passed; else, among covered ones, the closest face; else the least exposed. */
export function pickAttempt<Ref>(attempts: ExposureAttempt<Ref>[]): ExposureAttempt<Ref> {
  const last = attempts[attempts.length - 1];
  if (!failed(last)) return last;
  const covered = attempts.filter((a) => !a.exposed);
  if (covered.length) {
    // right framing first, then a verified face over one that couldn't be judged over a mismatch, then the closest
    const idRank = (a: ExposureAttempt<Ref>) => (a.identity === 'verified' ? 4 : a.identity === 'inconclusive' ? 2 : 0);
    const rank = (a: ExposureAttempt<Ref>) => (a.framingOk === false ? 0 : 10) + idRank(a) + (a.similarity ?? -1);
    return covered.reduce((a, b) => (rank(b) > rank(a) ? b : a));
  }
  return attempts.reduce((a, b) => (b.score < a.score ? b : a));
}

/** What to tell the user once the checks have finished (null if the first photo passed). */
export function exposureWarning(attempts: ExposureAttempt[], kept: ExposureAttempt): string | null {
  if (kept.exposed) {
    return `Top check: all ${attempts.length} attempts showed a nipple — this is the least exposed one. Try a lower style-pack strength or describe more coverage.`;
  }
  const redone = attempts.filter((a) => a !== kept && failed(a));
  // never let an unjudged face read as a match
  const unverified =
    kept.identity === 'inconclusive'
      ? `Face check inconclusive: ${kept.identityReason ?? 'her face could not be judged'}${typeof kept.similarity === 'number' ? ` (similarity ${kept.similarity})` : ''}, so this photo is not confirmed as Sienna. Other checks passed.`
      : '';
  if (!redone.length) return unverified || null;
  const nip = redone.filter((a) => a.exposed).length;
  const face = redone.filter((a) => !a.exposed && a.faceOk === false).length;
  const frame = redone.filter((a) => !a.exposed && a.faceOk !== false && a.framingOk === false).length;
  const why = [nip ? `${nip} showed a nipple` : '', face ? `${face} didn't look enough like Sienna` : '', frame ? `${frame} came out closer than full body` : '']
    .filter(Boolean)
    .join(', ');
  const tail = kept.faceOk === false ? ` None matched her face closely; kept the closest (similarity ${kept.similarity}).` : unverified ? ` ${unverified}` : '';
  return `Photo checks: redid ${redone.length} photo${redone.length > 1 ? 's' : ''} (${why}); kept seed ${kept.seed}.${tail}`;
}
