/**
 * Copy Photo (31 Oct, owner's request: "I upload the picture of what I want and Sienna Studio copies it"). A photo
 * from outside the studio still only lends its pose to the image model (its face, hair and pixels never pass through:
 * see the create route), so on its own it made Sienna in a random outfit and place. Now the photo is also read into
 * words: the exact outfit (cut, coverage, colour), framing, pose details, setting and light, and that description is
 * what gets generated (with the pose from the photo). The owner's own words, if any, win over the description.
 *
 * Reading happens on the photo GPU first: NudeNet checks the photo, and only a photo with nothing exposed is sent to
 * the AI (Claude) to describe; anything else is described by Florence-2 on the GPU (no API).
 */
import { EXPOSURE_NODE_CLASS } from './exposure';
import { FLORENCE_MODEL, TEXT_OUTPUT_CLASS } from './outfit';
import type { ComfyGraph } from './types';

export const COPY_EXPOSURE_NODE = 'copy_exposure';
export const COPY_CAPTION_NODE = 'copy_caption';
/** Lower than the generation check (0.45): a photo is sent to the AI only when NudeNet sees nothing near exposed. */
export const COPY_EXPOSURE_THRESHOLD = 0.25;

export const COPY_WHY = 'Reference photo copied: its outfit, pose, framing, setting and light are read from the photo and recreated with Sienna (the other person’s face, hair and body are never used).';
export const COPY_READING_NOTE = 'Reading your photo (outfit, framing, setting) before making it…';

export function copyPhotoEnabled(env: string | undefined = process.env.SIENNA_COPY_PHOTO): boolean {
  return env !== 'off';
}

/** NudeNet check + Florence-2 caption of the uploaded photo. */
export function buildCopyGateGraph(uploadedName: string): ComfyGraph {
  return {
    '1': { class_type: 'LoadImage', inputs: { image: uploadedName }, _meta: { title: 'Photo to copy' } },
    [COPY_EXPOSURE_NODE]: { class_type: EXPOSURE_NODE_CLASS, inputs: { images: ['1', 0], threshold: COPY_EXPOSURE_THRESHOLD }, _meta: { title: 'Nudity check before the AI reads it' } },
    '20': { class_type: 'DownloadAndLoadFlorence2Model', inputs: { model: FLORENCE_MODEL, precision: 'fp16' }, _meta: { title: 'Florence-2' } },
    '21': {
      class_type: 'Florence2Run',
      inputs: {
        image: ['1', 0],
        florence2_model: ['20', 0],
        text_input: '',
        task: 'more_detailed_caption',
        fill_mask: false,
        keep_model_loaded: false,
        max_new_tokens: 256,
        num_beams: 3,
        do_sample: false,
        seed: 1,
      },
      _meta: { title: 'Describe the photo (no API)' },
    },
    [COPY_CAPTION_NODE]: { class_type: TEXT_OUTPUT_CLASS, inputs: { text: ['21', 2] }, _meta: { title: 'Photo caption' } },
  };
}

/**
 * The owner's words with the copy instruction itself taken out ("Copy this photo exactly as Sienna, in red" →
 * "in red"): the instruction means nothing to the image model.
 */
export function copyUserText(prompt: string): string {
  return prompt
    .replace(/\b(?:please\s+)?(?:copy|recreate|remake|replicate|duplicate|redo|clone|make)\s+(?:(?:this|the|that|my|same)\s+)?(?:exact\s+)?(?:photo|picture|pic|image|shot|one|look|post|it)\b(?:\s+(?:exactly|perfectly|1:1|identically))?(?:\s+(?:as|with|using|for|but as|but with)\s+(?:sienna|her))?/gi, ' ')
    .replace(/\b(?:exactly\s+|perfectly\s+)?(?:the\s+)?same\s+as\s+(?:the|this|my)\s+(?:photo|picture|pic|image)\b|\b(?:exactly|perfectly)\s+(?:the\s+)?same\b|\b(?:as|with)\s+sienna\b|^\s*sienna\s*$/gi, ' ')
    .replace(/^\s*(?:exactly\s+)?(?:the\s+)?same\s*[.!]?\s*$/i, '')
    .replace(/\s+([,.;!?])/g, '$1')
    .replace(/^[\s,.;:!?-]*(?:but|and|with)?\b[\s,]*/i, '')
    .replace(/[\s,;:-]+$/g, '')
    .replace(/\s{2,}/g, ' ')
    .trim();
}

/** The text the reader and the checker get: the owner's changes first (they win), then the photo's description. */
export function copyRequestText(description: string, userText: string): string {
  const d = description.trim().replace(/\s+/g, ' ');
  return userText ? `${userText}. Everything else as in this photo: ${d}` : d;
}

/** Florence-2's caption, cleaned for the reader: its "The image shows" openers and the person's hair colour go. */
export function cleanCaption(caption: string): string {
  return caption
    // sentences about an app's on-screen buttons, menus or text (Florence-2 read "Made with Edits" and the username)
    .split(/(?<=[.!?])\s+/)
    .filter((x) => !/\b(menu|button|icon|text|caption|username|watermark|logo|app|screen|interface|options?)\b|"[^"]+"/i.test(x))
    .join(' ')
    .replace(/<\/?s>|<pad>/g, '')
    .replace(/\b(?:the|this) (?:image|photo|picture) (?:shows|is of|depicts|features)\s+/gi, '')
    .replace(/\b(?:blonde?|brunette|red-haired|redhead(?:ed)?|black-haired|brown-haired|grey-haired|gray-haired)\s+/gi, '')
    .replace(/\s{2,}/g, ' ')
    .trim();
}

/** The AI's instructions for describing the photo (Claude, vision). */
export const DESCRIBE_SYSTEM = `You write the description an image model uses to recreate a photo with a different woman: Sienna, a fictional adult character whose face, hair colour, skin tone and body come from her own model. Everything else must match the original photo as closely as words allow, so the owner's followers see the same shot.

Describe precisely, most important first:
- Clothing (only what is visible in the photo; never guess at garments out of frame or under the water): each garment's type and exact cut and size (for example "tiny string triangle bikini top whose small cups cover only the centre of each breast, thin strings tied behind the neck"), how much skin it leaves showing (cleavage, side, underneath), colour, fabric, pattern or plain, wet or dry, how it sits.
- For a bikini top or bra, the exact shape of each cup, because "small triangle" draws an ordinary triangle top: its proportions (tall and very narrow like a sliver, or as wide as it is tall), how wide it is compared with the breast (a narrow strip about a quarter of the breast's width, half, all of it), where its top and bottom edges sit (from the ring high on the chest down to the band under the breast, or only the lower half), which part of the breast it covers and which parts are bare (the inner and outer curves, the underside), how it hangs or is pulled (tight to the skin, hanging loose, pulled to the side), and say "not a regular triangle top" when it isn't one. The same care for bottoms: cut, width and rise.
- Where each cup sits on the breast (toward the cleavage, centred, toward the outer side) and whether the breast hangs below the under-bust string (the lower curve showing beneath it).
- Straps and strings exactly: where each one runs from and to (two thin strings from the top of each cup up to the back of the neck; one from each cup's side round the back), how many there are, and say "crossing" only when strings visibly cross each other, never for two strings meeting at the neck.
- Bottoms exactly: the front panel's size and shape, how low it sits below the navel, the angle of the side strings (straight across the hips or pulled up at an angle toward her hands) and where they meet her hips.
- The cups of a top always cover the nipples and areolae, however small or narrow they are: describe the cup's shape around that, never as leaving a nipple uncovered.
- Accessories and props: sunglasses, jewellery, hats, anything held or nearby.
- Hair style exactly (high messy top-knot bun, slicked back into a low bun, wet ponytail, down and wavy, wet strands on the shoulders) — never the hair colour.
- Bust in general words only, so the recreation's figure is similar: size (small, medium, large, very large breasts), how they sit (set wide apart with a visible gap of bare skin between them / close together with a cleavage line / pushed together), and how they hang (natural and soft, slightly low, high and round). Look at the lower half of the bust in particular: if bare skin shows between the two breasts there (even when they touch higher up), say "set apart with a gap of bare skin between them lower down" rather than "pressed together"; say "pressed together" only when they touch all the way down. Nothing more about her body.
- Pose: body position, where her arms and hands are, head tilt, which way she faces, and what she leans, sits or rests against and with which part of her body (hip pressed against the tub's edge, back against the wall).
- Expression, exactly: mouth (talking mid-sentence, lips parted, closed, smiling or not), eyes (open, closed, looking at the lens or away), mood (neutral, relaxed, serious).
- Camera: framing, judged by where the bottom edge of the photo cuts her body ("chest up" when it cuts just below her breasts or at the water line there, "waist up" only when her navel shows, "full body" only with her feet), how close, the angle, selfie at arm's length or filmed by someone else, where she is in the frame, how much of the frame the background takes.
- Setting: the visible objects, plants, water, buildings and surfaces with their colours and positions (behind her, left, right), the sky, time of day, weather, the light's direction and quality.
- Photo look: candid phone photo, video still, sharpness, grain.

Never describe her face features, hair colour, skin colour, ethnicity, age, tattoos, piercings or anything else that identifies the person, and nothing about her body beyond the general bust size. Ignore everything an app put on top of the photo — icons, like and comment counts, usernames, captions, buttons, progress bars, watermarks — and never mention them.

Also answer bust_size, bust_gap and bust_height. For bust_gap, look at the lower half of the bust: if any bare skin shows between the two breasts there, even where they touch higher up, the answer is "gap of bare skin between them lower down"; "touching all the way down" only when no skin shows between them anywhere. For bust_height, look at where the tops of the breasts and the top of the cleavage start on the chest: "sitting low and natural" when the upper chest below the collarbones is flat for a good stretch before the breasts begin and they hang softly with their fullness low; "high and round" when they start just below the collarbones, round and lifted (push-up look); "average" in between.

Write one paragraph of short comma-separated phrases, 90 to 180 words, no full sentences about the photo itself ("the photo shows"), no names. If there is no person in the photo, describe the scene and set person_found to false.`;

export const describeUser = 'Describe this photo for the recreation.';

/** The garment piece names Florence-2 segments for the garment-only crop (max 3), read from the described outfit. */
const GARMENT_PHRASES: [RegExp, string][] = [
  [/\bbikini\b|\btriangle (?:bikini )?top\b|\bstring top\b/i, 'bikini top'],
  // the bottoms too: only the top was traced and the copy drew its own higher, larger bottoms (boat photo, 1 Nov)
  [/\b(?:bikini|string|micro|tie-side|thong|g-string)\b[^,]*\b(?:bottoms?|thong|g-string|briefs)\b|\bthong\b|\bg-string\b/i, 'bikini bottom'],
  [/\b(?:bra|bralette)\b/i, 'bra'],
  [/\b(?:panties|knickers|underwear briefs)\b/i, 'panties'],
  [/\b(?:swimsuit|one-piece|monokini|bodysuit|leotard)\b/i, 'swimsuit'],
  [/\b(?:dress|gown)\b/i, 'dress'],
  [/\b(?:crop top|tank top|camisole|cami|t-shirt|tee|shirt|blouse|top)\b/i, 'top'],
  [/\b(?:sweater|hoodie|cardigan|jacket)\b/i, 'jacket'],
  [/\b(?:skirt)\b/i, 'skirt'],
  [/\b(?:shorts)\b/i, 'shorts'],
  [/\b(?:jeans|pants|trousers|leggings)\b/i, 'pants'],
];
export function copyGarmentPhrases(outfit: string): string[] {
  const out: string[] = [];
  for (const [re, phrase] of GARMENT_PHRASES) {
    if (re.test(outfit) && !out.includes(phrase) && !(phrase === 'top' && (out.includes('bikini top') || out.includes('bra')))) out.push(phrase);
  }
  return out.slice(0, 3);
}
/** The garment crop guides the outfit (IP-Adapter, style transfer) at this strength: the tested 0.6–0.8 range's low end,
 * so her own look stays first. */
export const COPY_GARMENT_STRENGTH = 0.6;

/** Packs that reshape her body: Copy Photo leaves them off — the photo's figure comes from its description (31 Oct:
 * the reader added Fuller Bust 0.8 and her bust came out far larger than the photo's). */
export const COPY_BODY_PACKS: ReadonlySet<string> = new Set(['fuller_bust', 'breast_detail']);

/** The description's phrases about her bust ("very large natural breasts set wide apart, no cleavage"), which the
 * reader tends to drop or turn into a pack: they go into her body presentation as written. */
export function bustPhrases(description: string): string[] {
  return description
    .split(/[,;.]/)
    .map((p) => p.trim())
    .filter((p) => /\b(breasts?|bust|cleavage)\b/i.test(p) && !/\b(bikini|cups?|top|bra|strings?|fabric|ring|straps?)\b/i.test(p));
}

/** The fixed bust answers as prompt words (positive, avoid). A gap gets weight and its opposite goes to Avoid: the
 * Sienna LoRA's own figure leans to a pushed-together bust. */
export function bustWords(b: { size: string; gap: string; height?: string }): { positive: string; avoid: string } {
  const size = b.size && b.size !== 'not visible' ? `${b.size} natural breasts` : '';
  // where they sit: her LoRA draws them high and round with a cleavage starting near the collarbones (1 Nov). Weighted
  // gently: a 1.4 "short cleavage" push pulled the nipples out of narrow cups on every try (1 Nov)
  // both the same size: one came out much smaller than the other where the photo's matched (1 Nov)
  const even = size ? '(both breasts the same size and shape:1.1)' : '';
  const evenAvoid = size ? 'uneven breasts, one breast smaller than the other' : '';
  const low = b.height?.startsWith('sitting low');
  const lowPositive = low ? '(breasts sitting low on the chest, fullness in the lower half, natural teardrop shape:1.2)' : '';
  const lowAvoid = low ? 'perky breasts sitting high on the chest, high round breasts, cleavage starting near the collarbones' : '';
  if (b.gap.startsWith('gap')) {
    return {
      positive: [size, even, '(breasts set apart with a visible gap of bare skin between them:1.3)', 'natural soft breasts hanging slightly apart', lowPositive].filter(Boolean).join(', '),
      avoid: ['deep cleavage, pushed-up breasts, breasts pressed together, push-up bra effect', lowAvoid, evenAvoid].filter(Boolean).join(', '),
    };
  }
  return { positive: [size, even, b.gap.startsWith('touching') ? 'breasts close together with a cleavage line' : '', lowPositive].filter(Boolean).join(', '), avoid: [lowAvoid, evenAvoid].filter(Boolean).join(', ') };
}

/** Eyewear in a copied photo: phrases naming sunglasses or glasses. Copies leave them off by default, so her face
 * shows and the face check can confirm her (the owner, 1 Nov: "if it's easier don't require sunglasses"). */
const EYEWEAR_RE = /\b(sunglasses|glasses|shades|aviators|eyewear)\b/i;
export const COPY_EYEWEAR_AVOID = 'sunglasses, glasses, eyewear';
export function dropEyewear(text: string): string {
  return text
    .split(',')
    .filter((p) => !EYEWEAR_RE.test(p))
    .join(',')
    .replace(/^\s*,\s*|\s*,\s*$/g, '')
    .trim();
}
export const copyKeepsEyewear = () => process.env.SIENNA_COPY_EYEWEAR === 'keep';

/** Small stud earrings in a copied photo: "small stud earring" drew gold hoops in the copy (1 Nov), so studs, barely
 * visible anyway, are left off and every earring is avoided; bigger earrings (hoops, drops) are copied as described. */
const STUD_RE = /\b(stud|small|tiny)\b[^,]*\bearrings?\b|\bearrings?\b[^,]*\bstuds?\b/i;
export function dropStudEarrings(text: string): { text: string; dropped: boolean } {
  const parts = text.split(',');
  const kept = parts.filter((p) => !STUD_RE.test(p));
  return { text: kept.join(',').replace(/^\s*,\s*|\s*,\s*$/g, '').trim(), dropped: kept.length < parts.length };
}
