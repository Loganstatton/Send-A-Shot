/**
 * Targeted fixes from the revealing-clothing benchmark (22 Oct). Each changes what is generated or checked, so each
 * stays off until a matched-seed GPU test shows it improves the photos: SIENNA_FIXES lists the ones that are on
 * ("rearguide,kneeguide,shorts", or true = all); a benchmark request can set its own.
 *
 *  rearguide   a clothing pack turned a from-behind request into a front view (D4); a standing rear skeleton
 *              (head to knees, profile head, ControlNet 1.0) holds the view. Final test (23 Oct): rear 2 of 2 with knees
 *              in frame (production 0 of 2); head turned back 1 of 2. Passed.
 *  kneeguide   "head to knees" came out cut at the upper thigh in 14 of 14 photos; wording alone didn't change it. A
 *              front head-to-knees skeleton (7.5-head proportions): knees in frame 2 of 2, faces verified. Passed.
 *  shorts      short and athletic shorts keep a short inseam and no brand logos: 2 of 2 short athletic shorts, no
 *              logos (production: bike or boy shorts). Passed.
 *  cheeky      explicitly cheeky / booty shorts get a cheeky cut, described as the garment only. Failed twice (23 Oct):
 *              the cut showed in 3 of 6 photos but her buttocks came out exaggerated, and once the wrong colour with
 *              extra limbs. Keep off — the image model ties a cheeky cut to a reshaped body.
 *  checkrules  the AI check grades a cheeky cut and the requested framing strictly (redoes photos; not needed while
 *              the knee report stays report-only).
 *
 * Tested and removed (23 Oct, no improvement or unsafe): the pack's text encoding off on rear requests, the underboob
 * pack on tank tops (2 of 2 exposed), "long tank top", knee-up framing wording, the colour negative, per-garment
 * encoding, the lower-body coverage negative.
 */
export const FIXES = ['rearguide', 'kneeguide', 'shorts', 'cheeky', 'checkrules'] as const;
export type Fix = (typeof FIXES)[number];

export function fixesFromEnv(v: string | undefined): Fix[] {
  if (v === 'true') return [...FIXES];
  return (v ?? '').split(',').map((x) => x.trim()).filter((x): x is Fix => (FIXES as readonly string[]).includes(x));
}

export const hasFix = (fixes: readonly Fix[] | undefined, f: Fix) => !!fixes?.includes(f);
