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
/** With the AI check on: one more photo in all, so a correction is still possible after face redos. */
export const AI_MAX_ATTEMPTS = 5;

/**
 * Retry budget inside the total: the face check may redo at most RETRY_BUDGET.face photos and corrections (the AI
 * check, framing, pose) at most RETRY_BUDGET.correction, so neither can use up every attempt; an exposed photo (the
 * top check) is always redone while attempts remain. First live AI test (21 Oct): face redos used all 4 tries and the
 * AI check's findings were never acted on.
 */
export type RetryKind = 'safety' | 'face' | 'correction';
export const RETRY_BUDGET = { face: 2, correction: 2 };

export function nextRetry(attempts: ExposureAttempt[], maxAttempts: number): RetryKind | null {
  const latest = attempts[attempts.length - 1];
  if (!latest || attempts.length >= maxAttempts || !failed(latest)) return null;
  if (latest.exposed) return 'safety';
  const used = (k: RetryKind) => attempts.slice(0, -1).filter((a) => a.redoneFor === k).length;
  const needsCorrection = latest.aiOk === false || latest.framingOk === false || latest.poseOk === false;
  if (needsCorrection && used('correction') < RETRY_BUDGET.correction) return 'correction';
  if (latest.faceOk === false && used('face') < RETRY_BUDGET.face) return 'face';
  return null;
}
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
  identity?: 'verified' | 'likely' | 'mismatch' | 'inconclusive' | 'unchecked';
  identityReason?: string;
  /** False when a full-body request came back as a closer shot. */
  framingOk?: boolean;
  /** False when a pose preset with a body check (bent over) came back in another pose: squatting, kneeling, upright. */
  poseOk?: boolean;
  /** AI check (Simple Mode): false when the photo clearly doesn't match the description; unset when it didn't run. */
  aiOk?: boolean;
  /** AI check score 0–10 and its major issues. */
  aiScore?: number;
  aiIssues?: string[];
  /** The AI check's outcome: pass / fail / unavailable (couldn't judge — never a pass), and why when unavailable. */
  aiStatus?: 'pass' | 'fail' | 'unavailable';
  aiReason?: string;
  /** Why the next attempt was made (set when this one was redone). */
  redoneFor?: RetryKind;
  /** What the next attempt corrected, in plain words (correction redos). */
  corrected?: string[];
  /** The AI check's major issues with their fixes (used to build the correction). */
  aiFixes?: import('./corrections').CheckIssue[];
  images: Ref[];
}

/** This attempt needs redoing: a nipple showed, her face drifted, or a full-body shot came out too close. */
export function failed(a: ExposureAttempt): boolean {
  return a.exposed || a.faceOk === false || a.framingOk === false || a.poseOk === false || a.aiOk === false;
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

/** The same graph with its prompt texts set back to `to` (nodes whose text is exactly `from`). */
export function swapPrompts(graph: ComfyGraph, from: { positive: string; negative: string }, to: { positive: string; negative: string }): ComfyGraph {
  const out: ComfyGraph = {};
  for (const [id, node] of Object.entries(graph)) {
    const text = node.inputs.text;
    out[id] =
      text === from.positive && to.positive !== text ? { ...node, inputs: { ...node.inputs, text: to.positive } }
      : text === from.negative && to.negative !== text ? { ...node, inputs: { ...node.inputs, text: to.negative } }
      : node;
  }
  return out;
}

/** The attempt to keep: the last one if it passed; else, among covered ones, the closest face; else the least exposed. */
export function pickAttempt<Ref>(attempts: ExposureAttempt<Ref>[]): ExposureAttempt<Ref> {
  const last = attempts[attempts.length - 1];
  if (!failed(last)) return last;
  const covered = attempts.filter((a) => !a.exposed);
  if (covered.length) {
    // right framing first, then a verified face over one that couldn't be judged over a mismatch, then the closest
    const idRank = (a: ExposureAttempt<Ref>) => (a.identity === 'verified' ? 4 : a.identity === 'likely' ? 3 : a.identity === 'inconclusive' ? 2 : 0);
    // then the AI check (a match beats a miss; the face still outranks it), then its score; broken anatomy (a third
    // hand) counts against a photo — the controlled test kept one on a tied score (21 Oct)
    const rank = (a: ExposureAttempt<Ref>) =>
      (a.poseOk === false ? 0 : 20) + (a.framingOk === false ? 0 : 10) + idRank(a) + (a.aiOk === true ? 3 : a.aiOk === false ? 0 : 1.5) + (a.aiScore ?? 0) / 20 - (a.aiFixes?.some((i) => i.aspect === 'anatomy') ? 1 : 0) + (a.similarity ?? -1);
    return covered.reduce((a, b) => (rank(b) > rank(a) ? b : a));
  }
  return attempts.reduce((a, b) => (b.score < a.score ? b : a));
}

/** What to tell the user once the checks have finished (null if the first photo passed and nothing is left open). */
export function exposureWarning(attempts: ExposureAttempt[], kept: ExposureAttempt): string | null {
  if (kept.exposed) {
    return `Top check: all ${attempts.length} attempts showed a nipple — this is the least exposed one. Try a lower style-pack strength or describe more coverage.`;
  }
  const redone = attempts.filter((a) => a !== kept && failed(a));
  // never let an unjudged face read as a match
  const unverified =
    kept.identity === 'unchecked'
      ? `Face not verified — manual review required: ${kept.identityReason ?? 'no face was found'}, so it was not retried and is in Needs Review.`
      : kept.identity === 'inconclusive'
      ? `Face check inconclusive: ${kept.identityReason ?? 'her face could not be judged'}${typeof kept.similarity === 'number' ? ` (similarity ${kept.similarity})` : ''}, so this photo is not confirmed as Sienna and is in Needs Review.`
      : '';
  const parts: string[] = [];
  if (redone.length) {
    const nip = redone.filter((a) => a.exposed).length;
    const face = redone.filter((a) => !a.exposed && a.faceOk === false).length;
    const frame = redone.filter((a) => !a.exposed && a.framingOk === false).length;
    const pose = redone.filter((a) => !a.exposed && a.poseOk === false).length;
    const ai = redone.filter((a) => !a.exposed && a.aiOk === false);
    const why = [
      nip ? `${nip} showed a nipple` : '',
      face ? `${face} didn't look enough like Sienna` : '',
      frame ? `${frame} came out closer than full body` : '',
      pose ? `${pose} came out in the wrong pose` : '',
      ai.length ? `${ai.length} didn't match your description` : '',
    ]
      .filter(Boolean)
      .join(', ');
    parts.push(`Photo checks: made ${attempts.length} photos (${why}); kept the best (seed ${kept.seed}).`);
    const fixes = [...new Set(attempts.flatMap((a) => a.corrected ?? []))];
    if (fixes.length) parts.push(`Corrected on the redo: ${fixes.slice(0, 4).join('; ')}.`);
  }
  if (kept.aiOk === false && kept.aiIssues?.length) parts.push(`Still not right in the kept photo: ${kept.aiIssues.slice(0, 3).join('; ')}.`);
  if (kept.aiStatus === 'unavailable') parts.push(`Not checked against your description: ${kept.aiReason ?? 'the AI check could not run'}.`);
  if (kept.faceOk === false) parts.push(`None matched her face closely; the closest (similarity ${kept.similarity}) is in Needs Review, not the gallery.`);
  else if (unverified) parts.push(unverified);
  return parts.length ? parts.join(' ') : null;
}
