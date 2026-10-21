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
const MAX_FIXES = 4;
/** Prompt weight for a corrected detail: strong enough to change the next photo, not so strong it distorts it. */
export const CORRECTION_WEIGHT = 1.3;

const clean = (s: string) =>
  s
    .replace(/[()[\]:]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 120);

export function buildCorrection(issues: CheckIssue[], prompts: { positive: string; negative: string }): Correction {
  const major = issues.filter((i) => i.major).slice(0, MAX_FIXES);
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
