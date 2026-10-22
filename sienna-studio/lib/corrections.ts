/**
 * Targeted corrections: what the AI check found wrong becomes concrete changes to the next attempt, instead of the
 * same prompt with a new seed. The original request stays in the prompt; each fix adds
 *  - its "emphasize" phrase, weighted, at the very front of the positive prompt (SDXL follows the start best), and
 *  - its "avoid" phrase in the negative prompt;
 * anatomy problems also add the usual anatomy negatives. A pose, anatomy or framing problem needs a new seed (the
 * composition itself was wrong); an outfit, colour, scene or lighting fix keeps the seed so the rest of the photo,
 * which was fine, stays close.
 */
export interface CheckIssue {
  aspect: string;
  problem: string;
  major: boolean;
  emphasize: string;
  avoid: string;
}

export interface Correction {
  /** Weighted phrases put in front of the positive prompt. */
  positive: string;
  /** Added to the negative prompt. */
  negative: string;
  newSeed: boolean;
  /** Plain-language list of what was corrected (for the warning). */
  summary: string[];
}

const ANATOMY_NEGATIVE = 'extra limbs, extra legs, extra arms, extra fingers, missing fingers, fused fingers, deformed hands, malformed feet';
const NEW_COMPOSITION = new Set(['pose', 'anatomy', 'framing', 'camera']);
const MAX_FIXES = 3;
/** Prompt weight for a corrected detail: strong enough to change the next photo, not so strong it distorts it. */
export const CORRECTION_WEIGHT = 1.25;

const clean = (s: string) =>
  s
    .replace(/[()[\]:]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 120);

/**
 * The fixes for the next attempt: the latest photo's major issues first, then earlier photos' fixes for other aspects
 * (so a fix that worked isn't dropped), at most MAX_FIXES. Always applied to the ORIGINAL prompt: stacking each redo's
 * fixes on the last one put five weighted phrases ahead of the request and the living-room test lost its sofa and
 * golden light (21 Oct).
 */
export function pickFixes(latest: CheckIssue[], earlier: CheckIssue[][]): CheckIssue[] {
  const out: CheckIssue[] = [];
  const seen = new Set<string>();
  const add = (i: CheckIssue) => {
    const k = i.emphasize.trim().toLowerCase() || i.problem;
    if (!i.major || seen.has(k) || out.length >= MAX_FIXES) return;
    seen.add(k);
    out.push(i);
  };
  latest.forEach(add);
  const covered = new Set(out.map((i) => i.aspect));
  for (const list of [...earlier].reverse()) list.filter((i) => !covered.has(i.aspect)).forEach(add);
  return out;
}

export function buildCorrection(issues: CheckIssue[], prompts: { positive: string; negative: string }, maxFixes = MAX_FIXES): Correction {
  const major = issues.filter((i) => i.major).slice(0, maxFixes);
  const pos: string[] = [];
  const neg: string[] = [];
  const summary: string[] = [];
  for (const i of major) {
    const e = clean(i.emphasize);
    const a = clean(i.avoid);
    if (e && !prompts.positive.includes(`(${e}:`)) pos.push(`(${e}:${CORRECTION_WEIGHT})`);
    if (a && !prompts.negative.toLowerCase().includes(a.toLowerCase())) neg.push(a);
    summary.push(e ? `${i.aspect}: ${e}${a ? ` (not ${a})` : ''}` : `${i.aspect}: ${i.problem}`);
  }
  if (major.some((i) => i.aspect === 'anatomy') && !prompts.negative.includes('fused fingers')) neg.push(ANATOMY_NEGATIVE);
  return {
    positive: pos.join(', '),
    negative: [...new Set(neg)].join(', '),
    newSeed: major.some((i) => NEW_COMPOSITION.has(i.aspect)),
    summary,
  };
}

/**
 * Fixes for a keep-person redraw: every serious room and light miss (up to six). She is pasted back unchanged, so
 * extra wording can't push her outfit out of the prompt — the reason ordinary corrections stop at three.
 */
export function backgroundFixes(issues: CheckIssue[]): CheckIssue[] {
  return issues.filter((i) => i.major && (i.aspect === 'scene' || i.aspect === 'lighting')).slice(0, 6);
}
