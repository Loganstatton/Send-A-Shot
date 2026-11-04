// Prompt assembly. Pure and deterministic so the UI preview matches exactly
// what the server sends to ComfyUI.

import { ADULT_ONLY_NEGATIVE, AGE_DRIFT_NEGATIVE, AGE_DRIFT_NEGATIVE_CLEAN, CLOSE_CAMERA_REALISM, EYE_TRAIT, FULL_BODY_CAMERA, FULL_BODY_FRAMING, FULL_BODY_NEGATIVE, KEEP_TOP_NEGATIVE, LEGACY_EYE_TRAIT, LOCK_NEGATIVE, MIN_CHARACTER_AGE, MIRROR_FULL_BODY_FRAMING, NON_STUDIO_NEGATIVE, NUDE_COLOUR_LOOKAHEAD, SFW_NEGATIVE } from './defaults';
import { outfitHasTop } from './exposure';
import { hasFix, type Fix } from './fixes';
import { framingLevels, kneeUpRequest, withoutThighUp } from './framing';
import { rearRequest } from './identity';
import { applyIdentityLock, findHardBlocks, GuardHit, tidy } from './guard';
import { splitAvoid } from './outfit-edit';
import type { CharacterProfile, ContentMode, PromptFields } from './types';
import { PROMPT_FIELD_KEYS, PROMPT_FIELD_LABELS } from './types';

export interface BuildPromptInput {
  fields: PromptFields;
  /** Close-framing wording (closeFraming/inFrame): on for Copy Photo, everywhere with SIENNA_CLOSE_FRAMING=true,
   * until a GPU comparison shows it doesn't cost her likeness on ordinary close-ups. */
  closeFrame?: boolean;
  /** Copy Photo: the photo's hairstyle, bust size and expression win over her profile's defaults (copyTraits). */
  copy?: boolean;
  /** Copy Photo, source-locked: no wording that moves or reshapes the photo's garment. */
  sourceLock?: boolean;
  character: CharacterProfile;
  siennaLock: boolean;
  contentMode: ContentMode;
  /**
   * Experimental prompt cleanup: drop negatives that work against the request — the abstract
   * identity phrases ("different person, altered face…", which CLIP can't act on) and the
   * texture-penalising age terms. Off = the current production prompt.
   */
  cleanup?: boolean;
  /**
   * A pose guide holds her body with a skeleton, so the request's outfit goes ahead of the pose and the guide's own
   * pose wording follows the outfit. In the first guide test the wording in front cost the outfit (sweatpants, the
   * button-up shirt) in 5 of 7 photos and the golden-hour light (21 Oct).
   */
  poseGuide?: string;
  /**
   * 2 = the rebuilt prompt (Oct 22 review of 146 generations): the request written as a photographer's caption first,
   * a short identity line without the weighted body descriptors, three realism phrases instead of fifteen, and
   * natural-proportion wording for full-body shots. 1 = the original prompt (default until the benchmark decides).
   */
  version?: 1 | 2;
  /** Keep an ordinary T-shirt, tank top or button-up full-length (coverGarments): fit wording after the outfit and
   * crop-top/knot wording in the negative. true = all three garments, or a list of the enabled ones. */
  coverStomach?: boolean | readonly CoverGarment[];
  /** Revealing-benchmark fixes switched on (lib/fixes.ts); version 1 only. */
  fixes?: readonly Fix[];
}

export interface BuiltPrompt {
  positive: string;
  negative: string;
  /** Non-fatal notices, e.g. phrases removed by Sienna Lock. */
  warnings: string[];
  /** Fatal problems — generation must not proceed. */
  blocked: GuardHit[];
  /** Fields after Sienna Lock filtering. */
  effectiveFields: PromptFields;
  /** The outfit as written in the positive prompt ('' when none): corrections are placed right after it. */
  outfitText: string;
  /** Version 2: the outfit phrase on its own (for encoding it separately from the scene), '' when none. */
  outfitPart?: string;
}

/**
 * Split profile traits into eye-colour wording and everything else, so the eye
 * description can be placed at the end of the prompt. The pre-reorder default
 * wording is upgraded to EYE_TRAIT; custom eye wording is kept as written.
 */
export function splitEyeTraits(traits: string): { rest: string; eyes: string } {
  const parts = traits.split(',').map((s) => s.trim()).filter(Boolean);
  const isEye = (s: string) => /\b(eyes?|iris(es)?)\b/i.test(s);
  const eyes = parts.filter(isEye).join(', ');
  return {
    rest: parts.filter((s) => !isEye(s)).join(', '),
    eyes: eyes.toLowerCase() === LEGACY_EYE_TRAIT ? EYE_TRAIT : eyes,
  };
}

/**
 * A close shot ("chest up", "waist up", "close-up"): the parts of her below the frame leave the prompt. Copy Photo of
 * chest-up hot-tub clips (31 Oct) came out down to the thighs: the profile's "slim toned waist with defined abs, curvy
 * hips" and an added "string thong bottoms" asked SDXL to show them, whatever the framing said.
 */
export type CloseFraming = 'close-up' | 'chest-up' | 'waist-up' | null;
export function closeFraming(f: Pick<PromptFields, 'framing' | 'camera'>): CloseFraming {
  const levels = framingLevels(`${f.framing} ${f.camera}`);
  if (!levels.length || levels.some((l) => l === 'full body' || l === 'knee-up' || l === 'thigh-up')) return null;
  return levels.includes('close-up') ? 'close-up' : levels.includes('chest-up') ? 'chest-up' : levels.includes('waist-up') ? 'waist-up' : null;
}
const BELOW_CHEST_RE = /\b(waist|abs|stomach|belly|midriff|hips?|legs?|thighs?|butt|buttocks|glutes?|booty|bottom|feet)\b/i;
const BELOW_WAIST_RE = /\b(hips?|legs?|thighs?|butt|buttocks|glutes?|booty|feet)\b/i;
const FRAME_BOTTOM_RE = /\b(bottoms?|thong|g-string|panties|knickers|briefs|shorts|skirt|pants|trousers|jeans|leggings|shoes|sandals|heels|sneakers|boots)\b/i;
/** The comma-separated phrases that stay in frame (a phrase naming only a lower part goes). */
export function inFrame(text: string, frame: CloseFraming, garments = false): string {
  if (!frame) return text;
  const below = frame === 'waist-up' ? BELOW_WAIST_RE : BELOW_CHEST_RE;
  return text
    .split(',')
    .filter((p) => {
      const t = p.trim();
      if (!t) return false;
      // a phrase that also names something in frame stays ("bikini top and thong bottoms" is one garment set)
      if (garments) return !(FRAME_BOTTOM_RE.test(t) && !/\b(top|bra|cups?|bikini|swimsuit|dress|shirt|tee|tank|blouse|sweater|hoodie|jacket|coat)\b/i.test(t));
      return !below.test(t) || /\b(breasts?|chest|bust|shoulders?|face|hair|neck)\b/i.test(t);
    })
    .map((p) => p.trim())
    .join(', ');
}
const CLOSE_FRAMING_WORDS: Record<Exclude<CloseFraming, null>, string> = {
  'close-up': '(close-up shot, head and shoulders only:1.3)',
  'chest-up': '(close shot from the chest up, cropped below the chest:1.3)',
  'waist-up': '(medium shot from the waist up:1.2)',
};
const CLOSE_FRAMING_NEGATIVE: Record<Exclude<CloseFraming, null>, string> = {
  'close-up': 'full body, wide shot, legs, thighs, hips, knees, feet',
  'chest-up': 'full body, wide shot, legs, thighs, hips, knees, feet, navel',
  'waist-up': 'full body, wide shot, legs, thighs, knees, feet',
};

/**
 * Copy Photo: "copy everything in the photo, with Sienna" (31 Oct). Her profile says long wavy hair and her usual bust,
 * which beat the photo's high bun and figure in the copies. When the request describes a hairstyle, the profile's hair
 * keeps only its colour; when it names a bust size, the profile's goes. Her face, hair colour and skin stay hers.
 */
const HAIRSTYLE_RE = /\b(bun|top-?knot|ponytail|pony tail|braids?|updo|up-do|pulled back|slicked back|tied up|tied back|pigtails|claw clip|chignon|bob|pixie)\b/i;
const BUST_SIZE_RE = /\b(?:small|medium|large|huge|big|full|heavy|ample|modest)\s+(?:(?:round|natural|soft|perky)\s+)*(?:breasts|bust|chest)\b|\bbreasts (?:set|sitting) (?:wide|close)/i;
/** Her profile's body-shape traits ("slim toned waist with defined abs", "curvy hips"): a source-locked copy takes the
 * photo's body instead (the owner, 2 Nov: the source decides the body silhouette). */
const BODY_SHAPE_TRAIT_RE = /\b(waist|abs|hips|figure|physique|toned|curvy|slim|athletic|butt|glutes|thighs|legs|stomach|belly|hourglass)\b/i;
export function copyTraits(traits: string, request: string, sourceLock = false): string {
  const style = HAIRSTYLE_RE.test(request);
  const bust = BUST_SIZE_RE.test(request);
  return traits
    .split(',')
    .map((p) => p.trim())
    .filter((p) => p && !(bust && /\b(breasts|bust|chest)\b/i.test(p)))
    .filter((p) => !(sourceLock && BODY_SHAPE_TRAIT_RE.test(p) && !/\b(hair|face|eyes?|freckles?|skin)\b/i.test(p)))
    .map((p) => (style && /\bhair\b/i.test(p) ? p.replace(/\b(long|short|wavy|curly|straight|loose)\s+/gi, '') : p))
    .map((p) => (/\b(breasts|bust)\b/i.test(p) ? p.replace(/^\((.*):[\d.]+\)$/, '$1') : p))
    .join(', ');
}

/** Copy Photo: the photo's hairstyle as one weighted phrase, and whether it is up (bun, ponytail…): her LoRA draws
 * long loose hair, which beat "high top-knot bun" in every copy (1 Nov). */
const UPDO_RE = /\b(bun|top-?knot|ponytail|pony tail|updo|up-do|pulled back|slicked back|tied up|tied back|claw clip|chignon|braided)\b/i;
export function copyHairstyle(text: string): { phrase: string; up: boolean } | null {
  const phrase = text.split(',').map((p) => p.trim()).find((p) => HAIRSTYLE_RE.test(p) && /\bhair\b|\bbun\b|top-?knot|ponytail/i.test(p));
  return phrase ? { phrase, up: UPDO_RE.test(phrase) } : null;
}

function copyEyewear(text: string): string {
  const g = text.split(',').map((p) => p.trim()).find((p) => /\b(sunglasses|glasses|shades|aviators)\b/i.test(p));
  return g ? `(wearing ${g.replace(/^(wearing|with)\s+/i, '')}:1.3)` : '';
}
function copyNoSmile(expression: string): boolean {
  return /\b(neutral|serious|mid-?sentence|talking|speaking|lips (softly )?parted|calm|blank|unsmiling|no smile)\b/i.test(expression) && !/\b(smil|grin|laugh)/i.test(expression.replace(/\bno smile\b/gi, ''));
}
const COPY_EXTRA_ACCESSORIES: [RegExp, string][] = [
  [/\b(bracelets?|bangles?|wristbands?|watch)\b/i, 'bracelets, bangles, wristband'],
  [/\b(hair ?ties?|scrunchies?)\b/i, 'hair tie on her wrist, scrunchie on her arm'],
  [/\b(rings?)\b(?! slider| joining| at| high| where| near)/i, 'rings on her fingers'],
  [/\b(necklaces?|pendants?|chains?)\b/i, 'necklace, pendant'],
  // gold hoops appeared where the photo had none (1 Nov)
  [/\b(hoops?|dangl\w*|drop earrings?)\b/i, 'hoop earrings, large earrings'],
];
/** The colours a copied garment drifts to (a purple bikini came out royal blue, a white one blue-tinted, 1 Nov). */
const NEAR_COLOURS: Record<string, string> = {
  purple: 'blue fabric, royal blue bikini',
  white: 'blue-tinted fabric, grey fabric',
  yellow: 'orange fabric, mustard fabric',
  pink: 'red fabric, magenta fabric',
  red: 'orange fabric, pink fabric',
  green: 'teal fabric, blue fabric',
  black: 'navy fabric, grey fabric',
};
function copyNearColours(outfit: string): string {
  const own = Object.keys(NEAR_COLOURS).filter((c) => new RegExp(`\\b${c}\\b`, 'i').test(outfit));
  return own.length === 1 ? NEAR_COLOURS[own[0]] : '';
}
const STRAP_COLOURS = ['black', 'white', 'red', 'pink', 'purple', 'blue', 'green', 'yellow', 'orange', 'brown', 'beige', 'gold', 'silver'];
function copyStrapColours(outfit: string): string {
  const own = STRAP_COLOURS.filter((c) => new RegExp(`\\b${c}\\b`, 'i').test(outfit));
  if (own.length !== 1) return '';
  return STRAP_COLOURS.filter((c) => c !== own[0] && c !== 'gold' && c !== 'silver').map((c) => `${c} straps`).join(', ');
}
// lace, mesh and fishnet are patterns that can be copied over covered skin; a sheer or see-through top can't be: the
// top check rejects any nipple showing through it, so all three boat tries were thrown away (1 Nov)
const COPY_MICRO_TOP_RE = /\b(micro|tiny|very small|sliver|narrow)\b[^,]*\b(cups?|top|triangles?)\b/i;
const COPY_SHEER_RE = /\b(mesh|lace|fishnet)\b/i;
const COPY_COVER_POSITIVE = '(each cup centred over the nipple, fully covering the nipple and areola:1.35)';
const COPY_UPDO_NEGATIVE = 'long loose hair down, hair falling over her shoulders, hair worn down';
/** Source-locked copies: colours the strong guides drifted to (red hair, orange skin, a glowing outline, 2 Nov). */
// (black too: with only red avoided, the boat copies' hair went near-black and straight, 2 Nov)
/** Her hair phrase from the profile ("long dark-brown wavy hair with lighter caramel ends"), weighted; '' if none. */
export function lockHairColour(traits: string, updo = false): string {
  const parts = traits.split(',').map((t) => t.trim());
  const found = parts.find((t) => /\bhair\b/i.test(t) && !/[()]/.test(t));
  // the colour only when the photo's hair is up: "(long dark-brown wavy hair:1.25)" against "(hair slicked back into a
  // bun:1.3)" and "hair worn down" in the negative drew no head at all, on every try (hot tub, 4 Nov)
  const h = found && updo ? found.replace(/\b(long|short|medium-length|shoulder-length|waist-length|wavy|curly|straight|loose|flowing|voluminous)\s+/gi, '').replace(/\s{2,}/g, ' ').trim() : found;
  // her eye colour too: locked copies drew icy blue eyes under heavy black liner, and the face check fell to 0.54-0.59
  // on the cut-out (4 Nov); her reference photos show hazel-green eyes and natural makeup
  const e = parts.find((t) => /\beyes?\b/i.test(t) && /\b(hazel|green|brown|blue|grey|gray|amber)\b/i.test(t) && !/[()]/.test(t));
  const eyes = e ? e.replace(/\s+with\b.*$/i, '').trim() : '';
  return [h ? `(${coolHair(h)}:1.25)` : '', eyes ? `(${eyes}, natural soft makeup:1.2)` : ''].filter(Boolean).join(', ');
}
/** "Caramel" ends drew copper-orange lengths and a ginger ponytail on locked copies (4 Nov); her reference photos show
 * dark-brown hair with only softly lighter, cool brown ends. */
export function coolHair(text: string): string {
  return text.replace(/\b(warm\s+)?(caramel|honey|golden)(-brown|\s+brown)?\b/gi, 'soft light-brown');
}
/**
 * Copy Photo detail the owner marked missing (hot tub, 4 Nov: "this is what I mean by I want details"): the photo's
 * narrow ruched cups came out as wide smooth cups with a knot at the centre, its thin strings as thick straps, its wet
 * skin with droplets as dry matte skin, its soft stomach with defined abs. Each part is asked for only when the photo's
 * description shows it, and its opposite kept out.
 */
const WET_RE = /\b(wet|glisten\w*|droplets?|dripping|beads? of water|water beading)\b/i;
const RUCHED_RE = /\b(ruched|gathered|scrunch\w*|shirred)\b/i;
const KNOT_TOP_RE = /\b(knot\w*|bow|tie-?front|tied (at|in) the (front|centre|center|middle))\b/i;
const THIN_STRING_RE = /\b(thin|skinny|string|spaghetti)\b[^,]*\b(strings?|ties?|straps?)\b/i;
const ABS_RE = /\b(abs|six-?pack|muscular|athletic|defined stomach|toned stomach|toned midriff)\b/i;
export function copyDetailParts(f: { outfit: string; bodyPresentation: string; extra: string }, sourceLock: boolean, hasTop: boolean): { positive: string; negative: string; wet: boolean } {
  const all = `${f.outfit}, ${f.bodyPresentation}, ${f.extra}`;
  const wet = WET_RE.test(all);
  const pos: string[] = [];
  const neg: string[] = [];
  if (wet) pos.push('(wet skin with small water droplets beading on it, natural wet sheen:1.2)');
  else neg.push('oiled skin, greasy shine');
  if (hasTop && RUCHED_RE.test(f.outfit)) pos.push('(ruched gathered fabric on the cups:1.15)');
  if (hasTop && !KNOT_TOP_RE.test(f.outfit)) neg.push('knot-front bikini top, tied knot between the cups, bow on the top');
  if (THIN_STRING_RE.test(f.outfit)) {
    pos.push('(very thin string ties:1.15)');
    neg.push('thick straps, wide straps');
  }
  if (sourceLock && !ABS_RE.test(all)) {
    pos.push('soft natural stomach');
    neg.push('(defined abs, six-pack, muscular stomach:1.2)');
  }
  return { positive: pos.join(', '), negative: neg.join(', '), wet };
}

const SOURCE_LOCK_NEGATIVE = 'red hair, ginger hair, auburn hair, copper hair, orange hair, reddish-brown hair, strawberry blonde hair, jet-black hair, black hair, icy blue eyes, heavy black eyeliner, winged eyeliner, dramatic eye makeup, orange skin, spray tan, fake tan, oversaturated skin, glowing outline, halo around body, tattoo, tattoos';
function weighHairstyle(text: string): string {
  const h = copyHairstyle(text);
  return h ? text.replace(h.phrase, `(${h.phrase}:1.3)`) : text;
}

/** With "barefoot": the model still added sandals from habit. */
const BAREFOOT_NEGATIVE = 'shoes, sandals, flip-flops, footwear';
const FULL_BODY_RE = /\b(full[\s-]?body|head[\s-]?to[\s-]?toe|full[\s-]?length|entire\s+body)\b/i;
const NOT_FULL_BODY_RE = /\b(close[\s-]?up|portrait|waist[\s-]?up|chest[\s-]?up|half[\s-]?body|head[\s-]?and[\s-]?shoulders|headshot)\b/i;

/**
 * Whether to prepend FULL_BODY_FRAMING. The Framing field decides when filled:
 * a full-body framing there is strengthened unless it already carries the
 * strong wording; any other framing (waist-up, medium shot…) is left alone.
 * Otherwise the request must ask for full body and not also for a tighter shot.
 */
export function fullBodyFraming(f: PromptFields): { add: boolean; conflict: boolean; mirror: boolean } {
  const request = [f.pose, f.outfit, f.bodyPresentation, f.expression, f.setting, f.lighting, f.extra].join(' \n ');
  const mirror = /\bmirror\b/i.test(`${f.framing} ${request}`);
  const framing = f.framing.trim();
  if (framing) {
    const add = FULL_BODY_RE.test(framing) && !NOT_FULL_BODY_RE.test(framing) && !/entire (reflected )?body visible/i.test(framing);
    return { add, conflict: false, mirror };
  }
  const full = FULL_BODY_RE.test(request);
  const tight = NOT_FULL_BODY_RE.test(request);
  return { add: full && !tight, conflict: full && tight, mirror };
}

/** Join comma-separated fragments, dropping blanks and exact duplicates. */
/** Colour words that get extra weight in the Outfit field (the model drifted to olive/beige without it). */
const COLOUR_RE = /\b(black|white|red|pink|blue|navy|green|olive|yellow|orange|purple|lilac|lavender|beige|nude|tan|brown|grey|gray|silver|gold|cream|ivory|burgundy|maroon|teal|turquoise|coral|denim|light-wash|dark-wash|khaki)\b/i;

/** Wrap text in a prompt weight, unless it is empty or already weighted. */
export function emphasize(text: string, weight: number): string {
  const t = text.trim().replace(/[,.\s]+$/, '');
  if (!t || /^\(.*:\d(\.\d+)?\)$/.test(t) || t.includes('(')) return t;
  return `(${t}:${weight})`;
}

export const COLOUR_WEIGHT = 1.1;

/** Outfit with each comma-separated item that names a colour weighted COLOUR_WEIGHT, so the colour sticks. */
export function emphasizeColours(outfit: string): string {
  return outfit
    .split(',')
    .map((item) => (COLOUR_RE.test(item) && !item.includes('(') ? ` ${emphasize(item, COLOUR_WEIGHT)}` : item))
    .join(',')
    .trim();
}

/**
 * Clothing colours the model drifts to (her green eyes and brown hair bleed into the outfit): in testing a
 * "red bodycon dress" came out green, brown or beige in 13 of 15 photos. When the outfit names a colour, the
 * drift colours it didn't ask for go in the negative prompt — as clothing, so her hair and eyes are untouched.
 */
const DRIFT_COLOURS: { phrase: string; family: RegExp }[] = [
  { phrase: 'olive green clothing, sage green clothing', family: /\b(green|olive|sage|khaki|teal|turquoise)\b/i },
  { phrase: 'brown clothing', family: /\b(brown|chocolate|tan|camel|khaki|burgundy|maroon)\b/i },
  { phrase: 'beige clothing', family: /\b(beige|nude|tan|cream|ivory|camel|khaki)\b/i },
];

export function colourDriftNegative(outfit: string): string {
  // "completely nude" is not a clothing colour
  const clothing = outfit.replace(/\b(completely|fully|totally)\s+nude\b/gi, '').replace(/^\s*nude\s*$/i, '');
  if (!COLOUR_RE.test(clothing)) return '';
  return DRIFT_COLOURS.filter((d) => !d.family.test(clothing))
    .map((d) => d.phrase)
    .join(', ');
}

export function joinParts(parts: (string | undefined | null)[]): string {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of parts) {
    const p = tidy(raw ?? '');
    if (!p) continue;
    const key = p.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(p);
  }
  return out.join(', ');
}

// Rear-view requests came back facing the camera: the rear wording sat mid-prompt, unweighted, behind full-body
// framing, while her face traits (freckles, eye colour) pulled her face into view. Weighted up front it held (9 of 10
// test photos from behind vs 1 of 4 without, same base model and Sienna LoRA).
const REAR_VIEW = '(view from behind:1.3), (back view:1.3)';
const FACE_AWAY = '(head facing away from the camera:1.2)';
const REAR_NEGATIVE_FACE_AWAY = '(looking at viewer:1.3), (facing the camera:1.3), (front view:1.3)';
const REAR_NEGATIVE = '(front view:1.2)';
const LOOKING_BACK_RE = /\b(looking back|over (her|the|his) shoulder|profile view|side profile|looks? at the camera|eye contact)\b/i;

const OUTDOOR_SCENE_RE = /\b(beach|ocean|sea|lake|river|forest|woods|park|street|city|outdoors?|outside|garden|backyard|mountains?|desert|pool|balcony|rooftop|field|sunlight|sunlit|sunset|sunrise|golden hour|daylight)\b/i;
const LIGHT_WORDS_RE = /\b(lighting|light|lit|sunlight|sunlit|daylight|lamp|lamplight|candlelight|neon|golden hour|sunset|sunrise|backlit|flash)\b/i;
const NON_PHONE_CAMERA_RE = /\b(dslr|mirrorless|film camera|35mm film|medium format|professional (camera|photographer|photo ?shoot)|studio (photo|shoot|portrait)|canon|nikon|sony a\d|leica|hasselblad)\b/i;

export function buildPrompt({ fields, character, siennaLock, contentMode, cleanup = false, poseGuide, version = 1, coverStomach = false, fixes = [], closeFrame = false, copy = false, sourceLock = false }: BuildPromptInput): BuiltPrompt {
  const warnings: string[] = [];
  const effectiveFields = { ...fields };

  // 1. Hard blocks across every user-editable field and the profile traits.
  const allText = [...PROMPT_FIELD_KEYS.map((k) => fields[k]), character.appearanceTraits].join(' \n ');
  const blocked = findHardBlocks(allText);

  // 2. Sienna Lock: strip identity-altering phrases from free-text fields.
  if (siennaLock) {
    for (const key of PROMPT_FIELD_KEYS) {
      // scene fields: words like "Indian restaurant" or "blonde wood" describe the place, not her
      const res = applyIdentityLock(fields[key] ?? '', character.extraLockedTerms, { scene: SCENE_FIELDS.has(key) });
      effectiveFields[key] = res.text;
      for (const r of res.removed) {
        warnings.push(`Sienna Lock removed “${r.term}” from ${PROMPT_FIELD_LABELS[key]} (${r.category} is locked).`);
      }
    }
  }

  const age = Math.max(MIN_CHARACTER_AGE, Math.round(character.age || MIN_CHARACTER_AGE));
  const f = effectiveFields;

  // 3. Positive prompt. SDXL weighs the start of the prompt most, so the
  // request (framing, then scene and outfit) comes first and identity after it;
  // with identity first, outfit colours and full-body framing were ignored.
  // Eye-colour wording goes last because it bled into clothing colour
  // (requested red/yellow tops came out muted green).
  // The LoRA was captioned "<token> woman", so the token is sent in that form.
  const token = character.triggerToken.trim();
  const tokenPhrase = !token || /\bwoman$/i.test(token) ? token : `${token} woman`;
  const traits = splitEyeTraits(character.appearanceTraits);
  const identityFor = (rest: string) => (siennaLock ? [tokenPhrase, `${age}-year-old adult woman`, rest] : [`adult woman`]);
  const identity = identityFor(traits.rest);

  const fullBody = fullBodyFraming(f);
  if (fullBody.conflict) warnings.push('Request mixes full-body and close-up/half-body framing — no full-body framing was added.');
  // Full-body shots came out as arm's-length selfies, so the default close
  // phone-camera wording is swapped out (only when the user set no camera):
  // normal shots get a "taken by another person" camera and anti-crop
  // negatives; mirror selfies get a full-length mirror composition instead.
  const fullBodyMode = !fullBody.add ? null : fullBody.mirror ? 'mirror' : 'normal';
  // "barefoot" anywhere (or shoes in Avoid): the full-body wording's "feet and shoes" put sandals on her (live, 18 Oct)
  const barefoot =
    /\b(barefoot(ed)?|bare[- ]feet|bare[- ]foot)\b/i.test([f.outfit, f.pose, f.bodyPresentation, f.setting, f.framing, f.extra].join(' ')) ||
    /\b(shoes|sandals|footwear|flip[- ]flops)\b/i.test(f.avoid ?? '');
  // fix kneeguide (a head-to-knees skeleton holds the framing): "three-quarter shot" (a mid-thigh crop) next to
  // "head to knees" contradicts it and goes
  const kneeUp = hasFix(fixes, 'kneeguide') && !fullBodyMode && kneeUpRequest(f.framing);
  const addedFraming =
    fullBodyMode === 'mirror'
      ? MIRROR_FULL_BODY_FRAMING
      : fullBodyMode
        ? barefoot
          ? FULL_BODY_FRAMING.replace('including feet and shoes', 'including her bare feet')
          : FULL_BODY_FRAMING
        : '';

  const defaultCamera = siennaLock ? character.defaultCameraStyle : '';
  const camera = f.camera || (fullBodyMode === 'normal' ? FULL_BODY_CAMERA : fullBodyMode === 'mirror' ? '' : defaultCamera);
  // The profile's default realism wording must not contradict the request: its indoor-lighting phrase goes when the
  // scene is outdoors or the lighting is described, and its phone-camera phrases go when another camera is asked for.
  const outdoors = OUTDOOR_SCENE_RE.test(`${f.setting} ${f.lighting} ${f.pose}`);
  // the light may be described in any field ("a modern kitchen with natural morning lighting")
  const lightDescribed = !!f.lighting.trim() || LIGHT_WORDS_RE.test(PROMPT_FIELD_KEYS.filter((k) => k !== 'avoid').map((k) => f[k]).join(' '));
  const otherCamera = !!f.camera && NON_PHONE_CAMERA_RE.test(f.camera) && !/\b(phone|iphone|selfie)\b/i.test(f.camera);
  const baseRealism = character.defaultRealismPrompt
    .split(',')
    .filter((s) => {
      const t = s.trim().toLowerCase();
      if (fullBodyMode && t === CLOSE_CAMERA_REALISM) return false;
      if ((outdoors || lightDescribed) && /\bindoor lighting\b/.test(t)) return false;
      if (otherCamera && /\b(iphone|phone|smartphone|selfie)\b/.test(t)) return false;
      return true;
    })
    .join(',');
  const realism = joinParts([baseRealism, f.realism]);

  // Drop Framing fragments the added wording already covers (e.g. "head to toe").
  const framing = kneeUp
    ? withoutThighUp(f.framing)
    : addedFraming
      ? f.framing.split(',').filter((s) => !addedFraming.includes(s.trim().toLowerCase())).join(',')
      : f.framing;

  // From-behind request: weighted rear wording first; unless she looks back, her face turned away and no eye wording.
  const poseText = `${f.pose} ${f.framing} ${f.extra}`;
  const rear = rearRequest(poseText, null, false);
  const faceAway = rear && !LOOKING_BACK_RE.test(`${poseText} ${f.expression}`);

  const frame = closeFrame && !fullBodyMode ? closeFraming(f) : null;
  const outfitText = tidy(emphasizeColours(inFrame(f.outfit, frame, true)));
  if (version === 2) {
    return buildV2({ f, fields, character, siennaLock, contentMode, cleanup, poseGuide, warnings, blocked, effectiveFields, tokenPhrase, age, traits, fullBodyMode, barefoot, rear, faceAway, outfitText, framing: f.framing, coverStomach });
  }
  const cover = coverParts(f.outfit, coverStomach);
  // cheeky shorts are left to the request's own words unless fix cheeky is on (it reshaped her in testing)
  const shorts = hasFix(fixes, 'shorts') || hasFix(fixes, 'cheeky') ? shortsParts(f.outfit, hasFix(fixes, 'cheeky')) : { fit: '', negative: '' };
  const detail = copy ? copyDetailParts(f, sourceLock, outfitHasTop(f.outfit)) : null;
  const positive = joinParts([
    rear ? REAR_VIEW : '',
    faceAway ? FACE_AWAY : '',
    addedFraming,
    frame ? CLOSE_FRAMING_WORDS[frame] : '',
    framing,
    poseGuide === undefined ? f.pose : '',
    // outfit colours get a little extra weight: in the audit "red bikini" came out beige/green. 1.1 keeps her face
    // (1.2 cost likeness, and so did weighting the pose)
    outfitText,
    cover.fit,
    shorts.fit,
    poseGuide ?? '',
    poseGuide === undefined ? '' : f.pose,
    copy ? weighHairstyle(f.bodyPresentation) : f.bodyPresentation,
    // narrow copied cups left her nipples at the cup edges (1 Nov): in copy mode a top always covers them
    copy && !sourceLock && outfitHasTop(f.outfit) ? COPY_COVER_POSITIVE : '',
    // her own hair colour, firmly: the photo's hair guided the redraw toward its colour
    copy && sourceLock && siennaLock ? lockHairColour(character.appearanceTraits, !!copyHairstyle(`${f.bodyPresentation}, ${f.extra}`)?.up) : '',
    // the photo's breasts hung below the under-bust string; the copy's ended at it (1 Nov)
    copy && /\b(hangs?|hanging|showing|visible)\b[^,]*\bbelow the (thin )?(under-?(bust|band)? ?)?(string|band)\b|\bunderside[s]? (largely |mostly )?bare\b|\bunderboob\b/i.test(`${f.outfit}, ${f.bodyPresentation}`) ? '(lower curve of each breast hanging below the thin under-bust string:1.2)' : '',
    // a wet micro bikini was drawn see-through on every try (1 Nov): opaque unless the photo's garment is sheer
    copy && outfitHasTop(f.outfit) && !COPY_SHEER_RE.test(f.outfit) ? '(solid opaque fabric cups:1.2)' : '',
    copy ? 'her natural light-tan skin' : '',
    detail?.positive ?? '',
    // a real body, not an airbrushed one: the owner marked the copy's smooth, perfectly round bust and body (1 Nov)
    copy ? `(realistic natural body with real skin texture and fine pores${COPY_MICRO_TOP_RE.test(f.outfit) ? '' : ', natural soft breast shape with weight'}, natural shading and creases:1.15)` : '',
    // fingers pinching a string, not fists round it (boat copy, 1 Nov)
    copy && /\b(hold\w*|pull\w*|tug\w*|pinch\w*|lift\w*|hook\w*)\b[^,]*\b(strings?|straps?|ties?|bottoms?|waistband)\b/i.test(f.pose) ? '(thumb and index finger delicately pinching the thin string:1.2)' : '',
    // face accessories: the face pass redraws her face and dropped the photo's sunglasses (1 Nov)
    copy ? copyEyewear(`${f.outfit}, ${f.bodyPresentation}`) : '',
    // a hand at her waist came out as one big thumb (1 Nov)
    copy && /\bhands?\b/i.test(f.pose) ? 'natural hands with separate fingers and knuckles' : '',
    // the photo's expression over her usual smile (the LoRA and the face pass pull towards it)
    // a neutral or talking face loses to her LoRA's smile at 1.2 (1 Nov): 1.4, and the smile goes to the negative
    // 1.4 gave a wide-open mouth and her head thrown back, looking away (1 Nov): 1.25
    copy && f.expression.trim() ? `(${f.expression.trim()}:${copyNoSmile(f.expression) ? 1.25 : 1.2})` : f.expression,
    copy && /\b(at the (lens|camera)|toward the (lens|camera)|to the lens|into the camera)\b/i.test(`${f.pose} ${f.expression}`) ? '(face turned toward the camera, looking into the lens:1.35)' : '',
    f.setting,
    f.lighting,
    f.extra,
    ...(frame || copy ? identityFor(inFrame(copy ? (sourceLock ? coolHair : (t: string) => t)(copyTraits(traits.rest, [f.outfit, f.pose, f.bodyPresentation, f.expression, f.extra].join(' '), sourceLock)) : traits.rest, frame)) : identity),
    camera,
    realism,
    siennaLock && !faceAway ? traits.eyes : '',
  ]);

  // 4. Negative prompt. The Avoid box goes here (never the positive prompt); with Sienna Lock on, identity terms
  // ("freckles", "dark hair") can't be avoided.
  const avoidItems = siennaLockedAvoid(splitAvoid(fields.avoid ?? ''), siennaLock, character, warnings);
  const wantsStudio = /\bstudio\b/i.test(`${f.lighting} ${f.setting} ${f.camera}`);
  const negative = joinParts([
    character.defaultNegativePrompt,
    wantsStudio ? '' : NON_STUDIO_NEGATIVE,
    siennaLock && !cleanup ? LOCK_NEGATIVE : '',
    ADULT_ONLY_NEGATIVE,
    contentMode === 'sfw' ? SFW_NEGATIVE : '',
    siennaLock ? (cleanup ? AGE_DRIFT_NEGATIVE_CLEAN : AGE_DRIFT_NEGATIVE) : '',
    fullBodyMode === 'normal' ? FULL_BODY_NEGATIVE : '',
    frame ? CLOSE_FRAMING_NEGATIVE[frame] : '',
    barefoot ? BAREFOOT_NEGATIVE : '',
    outfitHasTop(f.outfit) ? KEEP_TOP_NEGATIVE : '',
    cover.negative,
    shorts.negative,
    colourDriftNegative(f.outfit),
    faceAway ? REAR_NEGATIVE_FACE_AWAY : rear ? REAR_NEGATIVE : '',
    copy && copyHairstyle(`${f.bodyPresentation}, ${f.extra}`)?.up ? COPY_UPDO_NEGATIVE : '',
    copy && sourceLock ? SOURCE_LOCK_NEGATIVE : '',
    copy && outfitHasTop(f.outfit) ? 'nipple slip, areola peeking out of the cup, nipples visible at the cup edge' : '',
    copy && outfitHasTop(f.outfit) && !COPY_SHEER_RE.test(f.outfit) ? '(see-through fabric, sheer cups, transparent wet fabric, nipples showing through:1.3)' : '',
    // the cups drawn as bare string outlines and loose strings dangling at her side (1 Nov)
    copy && outfitHasTop(f.outfit) ? 'open cups, cupless string outline, empty string frame cups, dangling loose strings, extra strings' : '',
    // her own skin tone, not the photo's warm light: copies came out deeply bronzed and oily (1 Nov)
    copy ? 'deep tan, bronzed skin, dark tanned skin' : '',
    detail?.negative ?? '',
    copy ? copyNearColours(f.outfit) : '',
    copy ? 'cold blue colour cast, washed-out colours' : '',
    copy ? 'airbrushed body, smooth plastic skin, perfectly round spherical breasts, implant-looking breasts, CGI body, doll skin, clenched fists' : '',
    // a hand on the tub rim came out with long black claw nails (1 Nov): natural nails unless the photo shows polish
    copy && !/\b(nail polish|manicure|painted nails|long nails)\b/i.test(`${f.outfit} ${f.bodyPresentation} ${f.pose}`) ? 'long black nails, dark nail polish, claw nails, stiletto nails' : '',
    // nothing invented in her hands (a sprig of leaves appeared in one, 1 Nov) unless the photo shows her holding something
    copy && copyNoSmile(f.expression) ? 'smiling, smile, grin, showing teeth' : '',
    copy && /\b(parted|mid-?sentence|talking|speaking)\b/i.test(f.expression) ? 'mouth wide open, head thrown back, looking up at the sky' : '',
    // her head turned away in profile on one try in three (the photo's sunglasses confuse the pose's head points, 1 Nov)
    copy && /\b(at the (lens|camera)|toward the (lens|camera)|to the lens|into the camera)\b/i.test(`${f.pose} ${f.expression}`) ? 'profile view, face turned away, looking away from the camera, back of the head' : '',
    // topless in the photo: no top invented (a bra strap appeared across a bare back, 1 Nov)
    copy && /\btopless\b/i.test(`${f.outfit} ${f.bodyPresentation}`) ? 'bra, bra strap, strap across her back, bikini top' : '',
    // accessories the photo doesn't have (a yellow hair tie appeared on her arm, 1 Nov)
    copy ? COPY_EXTRA_ACCESSORIES.filter(([re]) => !re.test(`${f.outfit} ${f.bodyPresentation} ${f.pose}`)).map(([, w]) => w).join(', ') : '',
    // straps and strings in another colour than the garment (a black strap on an all-white bikini, 1 Nov)
    copy ? copyStrapColours(f.outfit) : '',
    copy && !/\b(holding|holds|in (her|one|each) hand|grips?|gripping|carrying|clutching)\b/i.test(`${f.pose} ${f.outfit} ${f.extra} ${f.bodyPresentation}`) ? 'holding flowers, holding leaves, holding a plant, object in her hand' : '',
    avoidItems.join(', '),
  ]);

  if (siennaLock && !character.triggerToken.trim()) {
    warnings.push('No trigger token set in the Sienna profile — identity will rely on the LoRA and face reference only.');
  }

  return { positive, negative, warnings, blocked, effectiveFields, outfitText };
}

// ── Prompt version 2 ─────────────────────────────────────────────────────────────────────────────────────────────
// The Oct 22 review (146 generations, 29 checked at full size): about 40% of every prompt was fixed text — fifteen
// "realism" phrases and a weighted body description, "(large round natural breasts:1.2), slim toned waist with defined
// abs, curvy hips" — and the photos looked like AI influencer shots (glossy tanned skin, saturated colour, about
// 8.4 head-lengths tall instead of ~7.5). Version 2 writes the request like a caption for a photographer, keeps the
// identity (trigger, hair, freckles, eyes) and describes her figure without weights.

/** Body descriptors in the profile traits. Version 2 keeps them word for word but without emphasis weights: dropping
 * them (benchmark, 22 Oct) shrank her bust visibly against her approved photos — the LoRA alone doesn't carry her figure. */
const BODY_TRAIT_RE = /\b(breasts?|bust|chest|waist|abs|hips?|curv\w*|figure|thighs?|glutes?|butt|legs?)\b/i;
/** "(large round natural breasts:1.2)" → "large round natural breasts". */
export const unweighted = (t: string) => t.replace(/^\((.+?)(?::\s*[\d.]+)?\)$/, '$1').trim();
/** Garments that came out cropped or knotted when an ordinary one was asked for (22 Oct: tank tops 8 of 8, a T-shirt,
 * a button-up shirt), and the fit wording that keeps each one full-length. Sweaters, dresses and the rest came out
 * right on their own, so they get nothing extra. */
export type CoverGarment = 'tee' | 'tank' | 'buttonup';
export const COVER_GARMENTS: CoverGarment[] = ['tee', 'tank', 'buttonup'];
const GARMENT_RE: Record<CoverGarment, RegExp> = {
  tee: /\b(t-?shirt|tee)\b/i,
  tank: /\btank(\s+top)?\b/i,
  buttonup: /\b(button[\s-]?(up|down)|oxford shirt|dress shirt)\b/i,
};
// Final test (22 Oct, seed 101): the button-up came out full-length with this wording (was knotted above the navel);
// the T-shirt stayed cropped with or without it; for the tank top the wording brought the crop back, while the
// negative alone had kept it full-length in 2 of 2 — so the tank top gets the negative only.
export const COVER_FIT: Record<CoverGarment, string> = {
  tee: 'untucked T-shirt with its hem below her waistband, stomach completely covered',
  tank: '',
  buttonup: 'full-length button-up shirt hanging naturally, buttoned down to the hem, untucked, hem below her waistband, not tied or knotted',
};
/** The request itself shows her stomach or asks for its own style (a crop top, a bikini, a tied, knotted, tucked or
 * open shirt…): the request wins and nothing is added. */
const SHOWS_STOMACH_RE = /\b(crop|cropped|midriff|belly|stomach|navel|abs|underboob|bralette|bra|bikini|bandeau|tube top|tied|knotted|tie-front|tucked|half[\s-]?shirt|cut-?out|open|unbuttoned)\b/i;
export const COVER_STOMACH_NEGATIVE = '(crop top, cropped shirt, exposed midriff, bare stomach, shortened shirt:1.2)';
export const KNOT_NEGATIVE = '(tied shirt, knotted shirt, front knot:1.2)';
/** Which of the enabled garments the outfit asks for in their ordinary, full-length form. */
export function coverGarments(outfit: string, enabled: readonly CoverGarment[] = COVER_GARMENTS): CoverGarment[] {
  if (!outfit || SHOWS_STOMACH_RE.test(outfit)) return [];
  return enabled.filter((g) => GARMENT_RE[g].test(outfit));
}
export const coversStomach = (outfit: string) => coverGarments(outfit).length > 0;
const coverEnabled = (c: boolean | readonly CoverGarment[] | undefined): readonly CoverGarment[] => (c === true ? COVER_GARMENTS : Array.isArray(c) ? c : []);
function coverParts(outfit: string, c: boolean | readonly CoverGarment[] | undefined) {
  const g = coverGarments(outfit, coverEnabled(c));
  return {
    fit: g.map((x) => COVER_FIT[x]).filter(Boolean).join(', '),
    negative: g.length ? [COVER_STOMACH_NEGATIVE, g.includes('buttonup') ? KNOT_NEGATIVE : ''].filter(Boolean).join(', ') : '',
  };
}
// ── Revealing-benchmark fixes (lib/fixes.ts), version 1 ──────────────────────────────────────────────────────────

/** Avoid items under Sienna Lock: identity-altering phrases and her own traits (freckles, wavy hair) are removed. */
function siennaLockedAvoid(avoidItems: string[], siennaLock: boolean, character: CharacterProfile, warnings: string[]): string[] {
  if (!siennaLock || !avoidItems.length) return avoidItems;
  // her own traits (freckles, wavy hair, eye colour) can't be avoided either
  const traitWords = new Set((character.appearanceTraits.toLowerCase().match(/[a-z]{4,}/g) ?? []).filter((w) => !['with', 'across', 'light', 'long'].includes(w)));
  return avoidItems.flatMap((item) => {
    const res = applyIdentityLock(item, character.extraLockedTerms);
    for (const r of res.removed) warnings.push(`Sienna Lock removed “${r.term}” from Avoid (${r.category} is locked).`);
    const kept = res.text.trim();
    // "bare breasts" / "exposed nipples" ask for coverage, not a smaller bust — let those through
    // and the shape words ("breasts pressed together", "pushed-up breasts", "deep cleavage") are about how they sit, not
    // their size: Copy Photo uses them to copy a photo's bust (1 Nov: the lock dropped them and the copy stayed pushed up),
    // and so is where they sit ("perky breasts sitting high on the chest": her copies sat higher than the photo's, 1 Nov)
    const coverage = /\b(bare|topless|nude|naked|exposed|nipples?|areolae?|uncovered|see-through|pressed together|pushed[- ]up|push-up|cleavage|perky|sitting high|high on the chest|high[- ]set|high round|uneven|smaller than the other)\b/i.test(kept);
    const hit = coverage ? undefined : (kept.toLowerCase().match(/[a-z]{4,}/g) ?? []).find((w) => traitWords.has(w) || traitWords.has(w.replace(/s$/, '')));
    if (hit) warnings.push(`Sienna Lock removed “${kept}” from Avoid (it is one of her traits).`);
    return kept && !hit ? [kept] : [];
  });
}

/** Fields that describe the scene rather than her (the identity lock's bare place/material words stay in them). */
const SCENE_FIELDS = new Set<string>(['setting', 'lighting', 'camera', 'framing']);

/** An outfit that covers her lower body (the AI check's coverage rule applies to it). */
const BOTTOM_GARMENT_RE = /\b(bikinis?|bottoms?|thong|g-string|panties|briefs|knickers|underwear|shorts|jeans|pants|trousers|skirt|leggings|swimsuit|monokini|one-piece|bodysuit|leotard|dress|romper|jumpsuit)\b/i;
const NO_BOTTOM_RE = new RegExp(String.raw`\b(bottomless|nude${NUDE_COLOUR_LOOKAHEAD}|naked|no (bottoms|panties|underwear)|nothing on|wearing nothing)\b`, 'i');
export function outfitHasBottom(outfit: string): boolean {
  return BOTTOM_GARMENT_RE.test(outfit) && !NO_BOTTOM_RE.test(outfit);
}

/**
 * Fix shorts. Ordinary shorts keep ordinary coverage. Short, tiny or athletic shorts keep a short inseam ("tiny
 * low-coverage running shorts" came out as bike shorts, E3). Explicitly cheeky shorts (cheeky, booty shorts, the lower
 * buttocks showing) get a cheeky cut: in E2 and E4 the hems covered both cheeks completely. Her figure is untouched —
 * only the garment's cut is described.
 */
const SHORTS_RE = /\bshorts\b|\bhot ?pants\b|\bcut-?offs\b/i;
const LONG_SHORTS_RE = /\b(bike|biker|cycling|bermuda|board|cargo|knee[- ]length|long)\s+shorts\b/i;
export const CHEEKY_RE = /\b(cheeky|booty shorts|bum shorts|butt[- ]?cheeks?|lower (butt|buttocks|bum|cheeks)|under-?butt)\b/i;
const SHORT_SHORTS_RE = /\b(tiny|very short|super short|short|mini|micro|low[- ]coverage|running|athletic|gym|track|sleep|pajama|pyjama|lounge)\b[^,]*\bshorts\b|\bhot ?pants\b|\bcut-?offs\b/i;
const TINY_SHORTS_RE = /\b(tiny|very short|super short|micro|low[- ]coverage)\b/i;
export const SHORT_SHORTS_NEGATIVE = '(bike shorts, cycling shorts, knee-length shorts, bermuda shorts:1.2)';
export const TINY_SHORTS_FIT = 'very short inseam, upper thighs bare';
// The garment's cut only: the first wording, "(lower curve of her buttocks showing below the hem:1.1)", gave a cheeky
// cut in 2 of 4 test photos but once turned the shorts into briefs and exaggerated her figure (23 Oct).
export const CHEEKY_FIT = 'cheeky-cut shorts, high-cut back leg openings, short back rise, fitted waistband, side seams';
export const CHEEKY_NEGATIVE = '(boy shorts, full-coverage shorts, long shorts:1.2), (briefs, panties, bikini bottoms, thong:1.2)';
/** Athletic shorts: the athletic cut, and no brand logos (a swoosh appeared on "tiny running shorts", 23 Oct). */
const ATHLETIC_SHORTS_RE = /\b(running|athletic|gym|track|sport|sports|workout)\b[^,]*\bshorts\b/i;
export const ATHLETIC_SHORTS_FIT = 'lightweight athletic shorts with split side hems';
export const LOGO_NEGATIVE = '(brand logo, swoosh, printed text, lettering:1.2)';
/** Fix shorts (short and athletic shorts); `cheeky` adds the cheeky cut for explicitly cheeky / booty shorts (fix cheeky). */
export function shortsParts(outfit: string, cheeky = true): { fit: string; negative: string } {
  if (!SHORTS_RE.test(outfit) || LONG_SHORTS_RE.test(outfit)) return { fit: '', negative: '' };
  if (CHEEKY_RE.test(outfit)) return cheeky ? { fit: CHEEKY_FIT, negative: `${SHORT_SHORTS_NEGATIVE}, ${CHEEKY_NEGATIVE}` } : { fit: '', negative: '' };
  if (!SHORT_SHORTS_RE.test(outfit)) return { fit: '', negative: '' };
  const athletic = ATHLETIC_SHORTS_RE.test(outfit);
  return {
    fit: [TINY_SHORTS_RE.test(outfit) ? TINY_SHORTS_FIT : '', athletic ? ATHLETIC_SHORTS_FIT : ''].filter(Boolean).join(', '),
    negative: [SHORT_SHORTS_NEGATIVE, athletic ? LOGO_NEGATIVE : ''].filter(Boolean).join(', '),
  };
}

/** Her traits without the "with defined abs" wording, everything else as written (test switch figureNoAbs). */
export const withoutAbs = (traits: string) => traits.replace(/\s*(?:with\s+)?(?:defined|visible|toned)\s+abs\b/gi, '').replace(/,\s*,/g, ',');
/** Said after her figure, without weights: a reminder, not a body change. */
export const NATURAL_PROPORTIONS = 'realistic proportions';
/** A standing request: furniture in the room ("gray sofa") pulled her into sitting in 4 of 4 photos (22 Oct). */
const STANDING_RE = /\bstand(ing|s)?\b/i;
const NOT_STANDING_RE = /\b(sit|sits|sitting|seated|lying|lies|lie|kneel\w*|crouch\w*|squat\w*|reclin\w*)\b/i;
export const V2_STANDING_NEGATIVE = 'sitting, seated, sitting on the sofa';
/** Full-length framing without "wide shot / several meters away": that wording stretched her to fill the frame. */
export const V2_FULL_BODY = 'full-length photo with her whole body in frame from head to feet and some space around her, natural proportions';
export const V2_FULL_BODY_NEGATIVE = 'cropped feet, cut off legs, elongated legs, stretched body, tall fashion model proportions, small head';
export const V2_REALISM = 'unretouched, natural skin texture, natural skin tone, true-to-life colors';
export const V2_NEGATIVE = 'glossy skin, oily shine, orange tan, overly tanned skin, oversaturated, high contrast, hdr, heavy retouching, beauty filter, fashion editorial pose';

function buildV2(a: {
  f: PromptFields; fields: PromptFields; character: CharacterProfile; siennaLock: boolean; contentMode: ContentMode; cleanup: boolean;
  poseGuide?: string; warnings: string[]; blocked: GuardHit[]; effectiveFields: PromptFields; tokenPhrase: string; age: number;
  traits: { rest: string; eyes: string }; fullBodyMode: 'mirror' | 'normal' | null; barefoot: boolean; rear: boolean; faceAway: boolean;
  outfitText: string; framing: string; coverStomach?: boolean | readonly CoverGarment[];
}): BuiltPrompt {
  const { f, fields, character, siennaLock, contentMode, cleanup, warnings, blocked, effectiveFields } = a;
  // camera first, the way a person describes a photo ("casual iPhone photo of …"); the user's own camera wording wins
  const camera = f.camera.trim() || (a.fullBodyMode === 'normal' ? 'casual iPhone photo taken by a friend' : 'casual iPhone photo');
  const traitList = a.traits.rest.split(',').map((t) => t.trim()).filter(Boolean);
  const identityTraits = traitList.filter((t) => !BODY_TRAIT_RE.test(t));
  const figure = traitList.filter((t) => BODY_TRAIT_RE.test(t)).map(unweighted);
  const fullBody = a.fullBodyMode === 'mirror' ? MIRROR_FULL_BODY_FRAMING : a.fullBodyMode ? V2_FULL_BODY : '';
  const framing = fullBody ? a.framing.split(',').filter((t) => !/\b(full[\s-]?body|head[\s-]?to[\s-]?toe|full[\s-]?length|entire body)\b/i.test(t)).join(',') : a.framing;
  const outfitPart = a.outfitText ? `wearing ${a.outfitText.replace(/^wearing\s+/i, '')}` : '';
  const pose = a.poseGuide === undefined ? f.pose : [f.pose, a.poseGuide].filter(Boolean).join(', ');
  const cover = coverParts(f.outfit, a.coverStomach);
  const positive = joinParts([
    a.rear ? REAR_VIEW : '',
    a.faceAway ? FACE_AWAY : '',
    camera,
    siennaLock ? a.tokenPhrase : 'adult woman',
    fullBody,
    framing,
    pose,
    outfitPart,
    cover.fit,
    f.bodyPresentation,
    f.expression,
    f.setting,
    f.lighting,
    f.extra,
    ...(siennaLock ? [`${a.age}-year-old`, ...identityTraits, ...figure, figure.length ? NATURAL_PROPORTIONS : ''] : []),
    V2_REALISM,
    f.realism,
    siennaLock && !a.faceAway ? a.traits.eyes : '',
  ]);
  // the same Avoid rules as version 1: her own traits can't be avoided either
  const avoidItems = siennaLockedAvoid(splitAvoid(fields.avoid ?? ''), siennaLock, character, warnings);
  const negative = joinParts([
    character.defaultNegativePrompt,
    V2_NEGATIVE,
    siennaLock && !cleanup ? LOCK_NEGATIVE : '',
    ADULT_ONLY_NEGATIVE,
    contentMode === 'sfw' ? SFW_NEGATIVE : '',
    siennaLock ? (cleanup ? AGE_DRIFT_NEGATIVE_CLEAN : AGE_DRIFT_NEGATIVE) : '',
    a.fullBodyMode === 'normal' ? `${FULL_BODY_NEGATIVE}, ${V2_FULL_BODY_NEGATIVE}` : '',
    a.barefoot ? BAREFOOT_NEGATIVE : '',
    outfitHasTop(f.outfit) ? KEEP_TOP_NEGATIVE : '',
    cover.negative,
    colourDriftNegative(f.outfit),
    a.faceAway ? REAR_NEGATIVE_FACE_AWAY : a.rear ? REAR_NEGATIVE : '',
    STANDING_RE.test(f.pose) && !NOT_STANDING_RE.test(f.pose) ? V2_STANDING_NEGATIVE : '',
    avoidItems.join(', '),
  ]);
  return { positive, negative, warnings, blocked, effectiveFields, outfitText: a.outfitText, outfitPart: tidy(outfitPart) };
}
