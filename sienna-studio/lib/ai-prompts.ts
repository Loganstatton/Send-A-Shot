/**
 * Simple Mode's AI reader and checker: the instructions and output shapes (pure, no network; lib/server/ai.ts sends
 * them). The reader turns a free-form description into the prompt fields SDXL follows best; the checker compares a
 * finished photo with the description and names what is clearly wrong, so the photo can be redone.
 *
 * Nudity never goes to the AI (NUDE_RE): those requests keep the rule-based reader and the GPU checks only.
 */
import { z } from 'zod/v4'; // the SDK's output-format helper takes zod 4 schemas
import { POSE_GUIDES, POSE_PRESET_LABELS } from './pose-presets';
import { STYLE_PACKS } from './style-packs';

/** Requests the AI reader and checker are not used for. */
export const NUDE_RE = /\b(nude|naked|nudity|topless|bottomless|nipples?|areolas?|genitals?|vagina|pussy|penis|bare (breasts|chest|butt|bottom)|implied nud\w*|undressed|nothing on|wearing nothing)\b/i;

export const ReadSchema = z.object({
  outfit: z.string(),
  pose: z.string(),
  bodyPresentation: z.string(),
  expression: z.string(),
  setting: z.string(),
  lighting: z.string(),
  camera: z.string(),
  framing: z.string(),
  realism: z.string(),
  extra: z.string(),
  avoid: z.string(),
  /** A pose preset id from the list, or "" for none. */
  posePreset: z.string(),
  /** Style pack ids from the list (at most two). */
  packs: z.array(z.string()),
  /** One plain sentence: what the photo will show. */
  understood: z.string(),
  /** Parts of the request the image model will probably not manage (shown to the user). */
  hard: z.array(z.string()),
});
export type ReadResult = z.infer<typeof ReadSchema>;

/**
 * The checker grades the photo requirement by requirement, not with one overall impression: one general score let a
 * cropped turtleneck, straight ankle trousers and missing golden-hour light pass as "7/10, matches" (21 Oct).
 */
export const CHECK_CATEGORIES = ['identity', 'clothing', 'position', 'camera', 'background', 'lighting', 'anatomy', 'unwanted'] as const;
export type CheckCategory = (typeof CHECK_CATEGORIES)[number];
export const CheckSchema = z.object({
  /** true only when the photo can't be assessed at all (then say why). */
  cannot_judge: z.boolean(),
  cannot_judge_reason: z.string(),
  requirements: z.array(
    z.object({
      category: z.enum(CHECK_CATEGORIES),
      /** One concrete requirement, in the request's words ("fitted black turtleneck", "camera low, looking up at her"). */
      requirement: z.string(),
      /** met; minor = a small difference; major = wrong or missing; unsure = can't be told confidently from the photo. */
      status: z.enum(['met', 'minor', 'major', 'unsure']),
      /** What the photo actually shows for it. */
      observed: z.string(),
      /** For minor/major: a short image-prompt phrase for what the photo must show instead. */
      emphasize: z.string(),
      /** For minor/major: a short phrase naming what wrongly appeared, for the negative prompt. */
      avoid: z.string(),
    }),
  ),
  /** 0–10: how much it looks like a real, unedited photo (not how well it matches; that is the requirements). */
  realism: z.number(),
});
export type CheckResult = z.infer<typeof CheckSchema>;

/** The categories as the correction code names them (pose, outfit, scene … ). */
const ASPECT: Record<CheckCategory, string> = {
  identity: 'look', clothing: 'outfit', position: 'pose', camera: 'camera', background: 'scene', lighting: 'lighting', anatomy: 'anatomy', unwanted: 'artifacts',
};

export interface CheckIssueOut { aspect: string; problem: string; major: boolean; emphasize: string; avoid: string }
export interface Graded {
  /** pass = no requirement is wrong or missing; unconfirmed ones are listed, never counted as met. */
  status: 'pass' | 'fail';
  /** major and minor misses, for corrections and the warning. */
  issues: CheckIssueOut[];
  /** Share of the judged requirements the photo meets (a minor difference counts half), 0–1. */
  compliance: number;
  majors: number;
  /** Requirements the checker couldn't confirm. */
  unsure: string[];
  checklist: { category: CheckCategory; requirement: string; status: 'met' | 'minor' | 'major' | 'unsure'; observed: string }[];
  realism: number;
}

/** Turns the checker's requirement list into a verdict. The verdict is computed here, never taken on the AI's word. */
export function gradeCheck(r: CheckResult): Graded {
  const reqs = r.requirements;
  const judged = reqs.filter((q) => q.status !== 'unsure');
  const met = judged.filter((q) => q.status === 'met').length + judged.filter((q) => q.status === 'minor').length / 2;
  const misses = reqs.filter((q) => q.status === 'major' || q.status === 'minor');
  return {
    status: misses.some((q) => q.status === 'major') ? 'fail' : 'pass',
    issues: misses.map((q) => ({
      aspect: ASPECT[q.category],
      problem: `${q.requirement} — ${q.observed}`,
      major: q.status === 'major',
      emphasize: q.emphasize,
      avoid: q.avoid,
    })),
    compliance: judged.length ? met / judged.length : 0,
    majors: misses.filter((q) => q.status === 'major').length,
    unsure: reqs.filter((q) => q.status === 'unsure').map((q) => q.requirement),
    checklist: reqs.map(({ category, requirement, status, observed }) => ({ category, requirement, status, observed })),
    realism: Math.max(0, Math.min(10, r.realism)),
  };
}

/** Packs and pose presets the reader may pick from (adult packs only when adult mode is allowed). */
function packList(adultAllowed: boolean) {
  return STYLE_PACKS.filter((p) => adultAllowed || p.section !== 'adult')
    .filter((p) => !['real_photo', 'real_innie', 'realistic_nudes'].includes(p.id))
    .map((p) => `- ${p.id}: ${p.label}. ${p.hint.split('. ')[0]}.`)
    .join('\n');
}

/** The presets the reader may choose: the keyword presets, plus the offered pose guides. */
export function readerPresets(guides: readonly string[] = []): string[] {
  return Object.keys(POSE_PRESET_LABELS).filter((id) => !POSE_GUIDES[id] || guides.includes(id));
}

const POSE_RULE = `posePreset: a ready-made pose skeleton the studio can hold her in; it also fixes the camera at eye level, straight on. Choose one only when the requested pose is that pose; choose "" when the user describes her hands, arms or legs in a way the preset doesn't show, or asks for a camera angle (low angle, from above, side view …). Ids:`;
const GUIDE_RULE = `posePreset: a pose skeleton the studio holds her body in — image models get positions, hands, legs and camera height wrong from text alone, so pick one whenever one fits. It fixes her body position, where her hands and feet are, and the camera height (eye level, unless the line says low angle). Choose the one whose line matches the requested position, hands and legs; small differences in what she holds are fine, a different position or a hand/leg doing something else is not. Choose "" when none fits, or when the user asks for a camera angle no line offers (from above, side view, from behind …). Ids:`;

export function readerSystem(adultAllowed: boolean, guides: readonly string[] = []): string {
  const poses = readerPresets(guides)
    .map((id) => `- ${id}: ${POSE_GUIDES[id] ?? POSE_PRESET_LABELS[id]}`)
    .join('\n');
  return `You prepare photo requests for an image studio that photographs Sienna Brooks, a fictional 24-year-old adult woman. The studio runs Stable Diffusion XL with Sienna's own identity model, so her face, hair colour, eye colour, skin tone, age and figure are already fixed by her profile.

Read the user's description and fill each field with what SDXL should draw. SDXL follows short, concrete, comma-separated phrases far better than sentences, and it pays most attention to what comes first in each field.

Rules:
- Keep every concrete thing the user asked for: garments, colours, materials, places, objects, light, camera, pose details. Never drop or change a detail, and never add one that changes the request. Small clarifications that make the request drawable are fine (for example "head to toe" for a full-body shot).
- outfit: each garment as its own phrase with its colour directly before it, top first, then bottom, then footwear (e.g. "white ribbed crop top, gray cotton pajama shorts, barefoot"). Put the colour on every garment so colours don't bleed into each other.
- pose: her body position, then what her hands, arms, legs and head do, then where she is looking. Nothing about the photographer.
- expression: her face (smile, mouth, gaze).
- setting: the place and the things in it.
- lighting: the light, its direction and time of day.
- camera: who takes the photo and how (phone, distance, height, angle). Sentences about the photographer go here, never in pose.
- framing: how much of her shows (full body head to toe, waist up, close-up), only when asked for or clearly implied.
- realism: photo look (candid, unedited, natural skin texture), only what the user asked for.
- bodyPresentation: hairstyle, makeup, tan lines, wet skin; never hair colour, eye colour, skin tone, body size or face shape.
- extra: anything that fits nowhere else; usually empty.
- avoid: things to keep out of the picture, as a short comma list without "no" (e.g. "sunglasses, jewelry"). Put every "no X / without X / don't show X" here, never in the other fields.
- Never write "Sienna", "she", instructions to the app, or parentheses/weights. Leave a field empty ("") when the description says nothing about it.

${guides.length ? GUIDE_RULE : POSE_RULE}
${poses}

packs: style add-ons, at most two, chosen only when the description asks for exactly what the pack draws (most requests need none):
${packList(adultAllowed)}

understood: one plain sentence telling the user what the photo will show.
hard: short notes on parts SDXL will probably not manage (unusual poses, text, several people, exact object counts); empty when none.`;
}

export function readerUser(description: string, reference: 'none' | 'pose' | 'edit' | 'edit+pose'): string {
  const ref =
    reference === 'none'
      ? ''
      : `\n\n(A reference photo is attached to this request; the studio copies ${reference === 'pose' ? 'its pose' : 'its composition'} on its own. Describe only what the user wants.)`;
  return `Description:\n${description}${ref}`;
}

const checkSystem = (fieldRules: string) => `You inspect photos made by an image studio before the user sees them. The photo shows Sienna, a fictional 24-year-old adult woman. Her normal look: long dark-brown wavy hair with lighter caramel ends, light freckles across her nose and cheeks, natural hazel-green eyes, light-tan skin, a curvy figure. (Fine details of her face are checked by a separate system.)

The user's request is the source of truth. Go through it requirement by requirement and grade each one against the photo. List every concrete thing the request asks for as its own requirement — each garment separately with its colour, cut, length and fit; each body detail (what each hand, arm, leg and foot does, posture, where she looks); camera height, angle, distance and framing; the place and every named piece of furniture or object (with its colour); the light (direction, colour, shadows, time of day). Use the request's own words for the requirement. Always add these three as well:
- identity: "looks like Sienna (her normal hair and appearance)" — major if the hair colour or texture is clearly different (blonde, black, red, tight curls) or she is plainly another woman
- anatomy: "correct anatomy" — major for any extra or missing arm, leg, hand or finger, a hand or limb growing out of something, merged or claw-like hands, twisted joints, broken feet
- unwanted: "nothing unrequested" — major for logos or text on clothes, app overlays, extra people, duplicated objects, or a garment/accessory swapped for something not asked for; minor for small unrequested accessories

For each requirement give a status:
- met: the photo clearly shows it as asked
- minor: close, with a small difference a casual viewer wouldn't mind (cream instead of white, mug held a little higher than the chest)
- major: wrong or missing (a cropped top instead of a fitted turtleneck, ankle-length straight trousers instead of wide-leg, no golden-hour light, eye level instead of a low angle, the coffee table missing, sitting on top of the bed instead of on its edge with feet on the floor)
- unsure: you cannot tell confidently from the photo (hidden, too small, ambiguous) — never guess "met"
Be strict and literal about what was asked, and don't invent requirements the request didn't make.
${fieldRules}
realism: 0–10 for how much it looks like a real, unedited photo. cannot_judge: true only if the photo can't be assessed at all (then explain in cannot_judge_reason, otherwise "").`;

/** The checker as first used live (22 Oct): a sentence on what it saw for every requirement (about 4.4¢ a check). */
export const CHECK_SYSTEM = checkSystem(`In "observed" say what the photo actually shows. For minor and major give "emphasize" (a short image-prompt phrase for what the photo must show, e.g. "fitted black turtleneck covering her waist") and "avoid" (a short phrase for what wrongly appeared, e.g. "cropped top, bare midriff"); otherwise "".
`);
/** The same grading with short fields: what it saw only for misses, a few words each (cost test, 22 Oct). */
export const CHECK_SYSTEM_LEAN = checkSystem(`Keep every field short — the grading is what matters, not prose:
- requirement: the request's own words, at most 8 words
- observed: "" when met; otherwise what the photo shows instead, at most 10 words ("cream turtleneck, not black")
- emphasize / avoid: "" when met; for minor and major, "emphasize" is a short image-prompt phrase for what the photo must show (e.g. "fitted black turtleneck covering her waist") and "avoid" a short phrase for what wrongly appeared (e.g. "cropped top, bare midriff")
`);

export function checkUser(request: string): string {
  return `Request:\n${request}\n\nGrade this photo against every requirement of the request.`;
}

/** Prices per million tokens (input, output) for the cost ledger. */
export const AI_PRICES: Record<string, [number, number]> = {
  'claude-opus-5-5': [4, 20],
  'claude-sonnet-5-5': [2, 10],
  'claude-haiku-5-5': [0.1, 0.5],
};
export function aiCost(model: string, usage: { input_tokens: number; output_tokens: number; cache_read_input_tokens?: number | null; cache_creation_input_tokens?: number | null }): number {
  const [i, o] = AI_PRICES[model] ?? AI_PRICES['claude-opus-5-5'];
  const read = usage.cache_read_input_tokens ?? 0;
  const write = usage.cache_creation_input_tokens ?? 0;
  return (usage.input_tokens * i + read * i * 0.1 + write * i * 1.25 + usage.output_tokens * o) / 1e6;
}

/** Keep only offered pose presets and known packs, at most two packs. */
export function cleanRead(r: ReadResult, allowedPacks: string[], guides: readonly string[] = []): ReadResult {
  const packs = [...new Set(r.packs)].filter((p) => allowedPacks.includes(p)).slice(0, 2);
  const posePreset = readerPresets(guides).includes(r.posePreset) ? r.posePreset : '';
  return { ...r, packs, posePreset };
}
