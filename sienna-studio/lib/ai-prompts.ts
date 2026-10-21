/**
 * Simple Mode's AI reader and checker: the instructions and output shapes (pure, no network; lib/server/ai.ts sends
 * them). The reader turns a free-form description into the prompt fields SDXL follows best; the checker compares a
 * finished photo with the description and names what is clearly wrong, so the photo can be redone.
 *
 * Nudity never goes to the AI (NUDE_RE): those requests keep the rule-based reader and the GPU checks only.
 */
import { z } from 'zod/v4'; // the SDK's output-format helper takes zod 4 schemas
import { POSE_PRESET_LABELS } from './pose-presets';
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

export const CHECK_ASPECTS = ['outfit', 'pose', 'anatomy', 'scene', 'framing', 'lighting', 'camera', 'artifacts', 'look', 'other'] as const;
export const CheckSchema = z.object({
  /** pass / fail, or cannot_judge when the photo can't be assessed (then say why in cannot_judge_reason). */
  verdict: z.enum(['pass', 'fail', 'cannot_judge']),
  cannot_judge_reason: z.string(),
  /** 0–10: how well the photo matches the request and looks like a real, flawless photo. */
  score: z.number(),
  issues: z.array(
    z.object({
      aspect: z.enum(CHECK_ASPECTS),
      problem: z.string(),
      major: z.boolean(),
      /** A short image-prompt phrase for what the photo must show instead ("both hands holding the white mug"). */
      emphasize: z.string(),
      /** A short phrase naming what wrongly appeared, for the negative prompt ("denim shorts", "shoes"). */
      avoid: z.string(),
    }),
  ),
});
export type CheckResult = z.infer<typeof CheckSchema>;

/** Packs and pose presets the reader may pick from (adult packs only when adult mode is allowed). */
function packList(adultAllowed: boolean) {
  return STYLE_PACKS.filter((p) => adultAllowed || p.section !== 'adult')
    .filter((p) => !['real_photo', 'real_innie', 'realistic_nudes'].includes(p.id))
    .map((p) => `- ${p.id}: ${p.label}. ${p.hint.split('. ')[0]}.`)
    .join('\n');
}

export function readerSystem(adultAllowed: boolean): string {
  const poses = Object.entries(POSE_PRESET_LABELS)
    .map(([id, label]) => `- ${id}: ${label}`)
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

posePreset: a ready-made pose skeleton the studio can hold her in. Choose one only when the requested pose is that pose; when the user describes her hands, arms or legs in a way the preset doesn't show, choose "". Ids:
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

export const CHECK_SYSTEM = `You inspect photos made by an image studio before the user sees them. The photo shows Sienna, a fictional 24-year-old adult woman. Her established look: long dark-brown wavy hair with lighter caramel ends, light freckles across her nose and cheeks, natural hazel-green eyes, a curvy figure. (Fine details of her face are checked by a separate system.)

The user's request is the source of truth. Compare the photo with it, and with what a real, unedited photo looks like. Report every problem as an issue:
- outfit: wrong, missing or extra garments, wrong colours or materials, garments merged or changed (lace shorts that became denim, a white top that came out gray), shoes when bare feet were asked for
- pose: body position, hands, arms, legs or head clearly not as described (one hand instead of both, a leg on the floor instead of on the counter)
- anatomy: malformed hands (merged, missing or extra fingers, claw or paw shapes), extra or missing arms or legs, twisted joints, broken feet
- scene: wrong place (a bedroom instead of a living room), missing key objects
- framing / camera / lighting: clearly not what was asked (much closer or wider, a different angle, flash instead of golden hour)
- artifacts: text, logos, watermarks, app interface overlays, extra people, duplicated objects, obvious AI smearing
- look: hair colour clearly not hers (blonde, black, red), or plainly a different woman

major = a viewer would notice it at once or it contradicts the request; minor = a small deviation. Don't report things the request didn't ask for, and don't be picky about small creative choices.
For each issue give "emphasize": a short image-prompt phrase describing what the photo must show instead (e.g. "both hands holding the white mug", "white lace shorts", "living room with a gray sofa", "barefoot"), and "avoid": a short phrase naming what wrongly appeared (e.g. "denim shorts", "shoes", "bedroom", "extra fingers"); use "" when there is nothing to say.

verdict: "fail" when there is at least one major issue, "pass" when there is none, "cannot_judge" only when you cannot assess the photo at all (then explain in cannot_judge_reason; otherwise leave it ""). score = 0–10 for how well it matches and how real it looks.`;

export function checkUser(request: string): string {
  return `Request:\n${request}\n\nDoes this photo match the request?`;
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

/** Keep only known pose presets and packs, at most two packs. */
export function cleanRead(r: ReadResult, allowedPacks: string[]): ReadResult {
  const packs = [...new Set(r.packs)].filter((p) => allowedPacks.includes(p)).slice(0, 2);
  const posePreset = POSE_PRESET_LABELS[r.posePreset] ? r.posePreset : '';
  return { ...r, packs, posePreset };
}
