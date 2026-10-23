/**
 * Targeted fixes from the revealing-clothing benchmark (22 Oct). Each changes what is generated or checked, so each
 * stays off until a matched-seed GPU test shows it improves the photos: SIENNA_FIXES lists the ones that are on
 * ("rearguide,shorts", or true = all); a benchmark request can set its own.
 *
 *  rearguide   a clothing pack turned a from-behind request into a front view (D4); a standing rear skeleton
 *              (head to knees) holds the view. First test (23 Oct): rear in 1 of 2 at ControlNet 0.85.
 *  kneeguide   "head to knees" came out cut at the upper thigh in 14 of 14 photos; wording alone didn't change it
 *              (0 of 4, 23 Oct) while the rear skeleton showed her knees 2 of 2. A front head-to-knees skeleton.
 *  shorts      short and athletic shorts keep a short inseam and no brand logos; explicitly cheeky / booty shorts get a
 *              cheeky cut described as the garment's cut only, never her body.
 *  checkrules  the AI check grades a cheeky cut and the requested framing strictly.
 *
 * Tested and removed (23 Oct, no improvement or unsafe): the pack's text encoding off on rear requests, the underboob
 * pack on tank tops (2 of 2 exposed), "long tank top", knee-up framing wording, the colour negative, per-garment
 * encoding, the lower-body coverage negative.
 */
export const FIXES = ['rearguide', 'kneeguide', 'shorts', 'checkrules'] as const;
export type Fix = (typeof FIXES)[number];

export function fixesFromEnv(v: string | undefined): Fix[] {
  if (v === 'true') return [...FIXES];
  return (v ?? '').split(',').map((x) => x.trim()).filter((x): x is Fix => (FIXES as readonly string[]).includes(x));
}

export const hasFix = (fixes: readonly Fix[] | undefined, f: Fix) => !!fixes?.includes(f);
