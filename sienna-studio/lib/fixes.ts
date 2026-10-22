/**
 * Targeted fixes from the revealing-clothing benchmark (22 Oct, 14 photos, seed 101). Each one changes what is
 * generated or checked, so each stays off until a matched-seed GPU test shows it improves the photos:
 * SIENNA_FIXES lists the ones that are on ("keepbottom,framing", or true = all); a benchmark request can set its own.
 *
 *  keepbottom    adult mode (often switched on by a clothing pack alone) drops the SFW "no nudity" wording; with
 *                the micro + string packs stacked a bikini came out with its bottoms not covering (D3). With an
 *                outfit that covers her lower body, a lower-body coverage negative is added in either mode.
 *  framing       "head to knees" came out cut at the upper thigh in 14 of 14 photos; the reader also added
 *                "three-quarter shot" (a mid-thigh crop) next to it. Knee-up wording, the contradiction removed,
 *                and a photo with her knees cut off is redone instead of only reported.
 *  rearpack      a clothing pack turned a from-behind request into a front view (D4): on a rear request the pack
 *                LoRA shapes the image but no longer the text encoding (strength_clip 0).
 *  rearguide     a standing rear skeleton (head to knees) holds the from-behind view.
 *  underboobtank "underboob tank top" may use the underboob pack (it was blocked by "tank top"); the tank top stays
 *                a tank top (sleeves in the negative).
 *  colour        a garment's colour stays on that garment: "red top, blue jeans" gave a navy top (B3) and a black
 *                underboob tank came out denim blue (C2). The other garment's colour on this garment goes in the negative.
 *  garmentsplit  each garment encoded on its own and joined (ConditioningConcat), so colour words can't attach to
 *                the other garment inside the text encoder.
 *  shorts        "tiny running shorts" came out as bike shorts (E3); cheeky / booty shorts came out fully covering
 *                (E2, E4). Short shorts keep a short inseam; explicitly cheeky shorts get a cheeky cut.
 *  tankfit       ordinary tank tops still came out cropped (B1) or knotted (E1) with the negative-only rule.
 *  checkrules    the AI check grades cheeky-shorts coverage and requested framing strictly (both butt cheeks fully
 *                covered fails a cheeky request; knees cut off fails "head to knees").
 */
export const FIXES = ['keepbottom', 'framing', 'rearpack', 'rearguide', 'underboobtank', 'colour', 'garmentsplit', 'shorts', 'tankfit', 'checkrules'] as const;
export type Fix = (typeof FIXES)[number];

export function fixesFromEnv(v: string | undefined): Fix[] {
  if (v === 'true') return [...FIXES];
  return (v ?? '').split(',').map((x) => x.trim()).filter((x): x is Fix => (FIXES as readonly string[]).includes(x));
}

export const hasFix = (fixes: readonly Fix[] | undefined, f: Fix) => !!fixes?.includes(f);
