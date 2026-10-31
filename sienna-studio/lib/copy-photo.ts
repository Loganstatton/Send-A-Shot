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
- Clothing (only what is visible in the photo; never guess at garments out of frame or under the water): each garment's type and exact cut and size (for example "tiny string triangle bikini top whose small cups cover only the centre of each breast, wide gap between the cups, thin strings tied behind the neck"), how much skin it leaves showing (cleavage, side, underneath), colour, fabric, pattern or plain, wet or dry, how it sits.
- For a bikini top or bra, the exact shape of each cup, because "small triangle" draws an ordinary triangle top: its proportions (tall and very narrow like a sliver, or as wide as it is tall), how wide it is compared with the breast (a narrow strip about a quarter of the breast's width, half, all of it), where its top and bottom edges sit (from the ring high on the chest down to the band under the breast, or only the lower half), which part of the breast it covers and which parts are bare (the inner and outer curves, the underside), how it hangs or is pulled (tight to the skin, hanging loose, pulled to the side), and say "not a regular triangle top" when it isn't one. The same care for bottoms: cut, width and rise.
- Accessories and props: sunglasses, jewellery, hats, anything held or nearby.
- Hair style exactly (high messy top-knot bun, slicked back into a low bun, wet ponytail, down and wavy, wet strands on the shoulders) — never the hair colour.
- Bust size in general words only (small, medium, large, very large breasts), so the recreation's figure is similar; nothing more about her body.
- Pose: body position, where her arms and hands are, head tilt, which way she faces.
- Expression, exactly: mouth (talking mid-sentence, lips parted, closed, smiling or not), eyes (open, closed, looking at the lens or away), mood (neutral, relaxed, serious).
- Camera: framing, judged by where the bottom edge of the photo cuts her body ("chest up" when it cuts just below her breasts or at the water line there, "waist up" only when her navel shows, "full body" only with her feet), how close, the angle, selfie at arm's length or filmed by someone else, where she is in the frame, how much of the frame the background takes.
- Setting: the visible objects, plants, water, buildings and surfaces with their colours and positions (behind her, left, right), the sky, time of day, weather, the light's direction and quality.
- Photo look: candid phone photo, video still, sharpness, grain.

Never describe her face features, hair colour, skin colour, ethnicity, age, tattoos, piercings or anything else that identifies the person, and nothing about her body beyond the general bust size. Ignore everything an app put on top of the photo — icons, like and comment counts, usernames, captions, buttons, progress bars, watermarks — and never mention them.

Write one paragraph of short comma-separated phrases, 90 to 180 words, no full sentences about the photo itself ("the photo shows"), no names. If there is no person in the photo, describe the scene and set person_found to false.`;

export const describeUser = 'Describe this photo for the recreation.';

/** The garment piece names Florence-2 segments for the garment-only crop (max 3), read from the described outfit. */
const GARMENT_PHRASES: [RegExp, string][] = [
  [/\bbikini\b|\btriangle (?:bikini )?top\b|\bstring top\b/i, 'bikini top'],
  [/\b(?:bra|bralette)\b/i, 'bra'],
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
