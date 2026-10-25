/**
 * Simple Mode: one natural-language description → the pipeline's prompt fields.
 *
 * Nothing is paraphrased. The description is split into sentences (and long comma lists into clauses); each piece
 * keeps its exact wording and is filed under the field it is mostly about, scored by keywords. Only three things
 * change the text:
 *  - "no X" / "without X" / "avoid X" / "don't show X" become Avoid terms (a "no …" phrase in the positive prompt
 *    asks SDXL for the very thing — see prompt-advice);
 *  - leading instructions to the app ("Generate", "Create a photo of", "I want") are dropped, as is a sentence that
 *    only says she should look like Sienna (her LoRA, face reference and face check already do that);
 *  - "Sienna" becomes "she", because the character token is added by the prompt builder.
 * Everything else — outfit, pose, scene, camera — is the user's own words, so presets and defaults can't override it.
 */
import { NUDE_COLOUR_LOOKAHEAD, packsForDescription, STYLE_PACKS, TINY_STRING_OUTFIT } from './style-packs';
import { PROMPT_FIELD_KEYS, type ContentMode, type PromptFields } from './types';

export type ReferenceMode = 'none' | 'edit' | 'pose' | 'edit+pose';

export interface Interpretation {
  fields: PromptFields;
  contentMode: ContentMode;
  /** How an uploaded reference photo is used: img2img start image, pose ControlNet, or both. */
  reference: { mode: ReferenceMode; denoise: number | null; why: string };
  /** "change her top to a red tank top" — garment swaps, applied to the source photo's outfit when editing one. */
  changes: ClothingChange[];
  /** Style packs the description switches on (id → strength). */
  packs: Record<string, number>;
  /** Plain-language notes on what was understood (shown under the prompt box). */
  notes: string[];
}

export type GarmentPart = 'top' | 'bottom' | 'dress' | 'shoes' | 'outfit';
export interface ClothingChange {
  part: GarmentPart;
  to: string;
}

const PART_NOUNS: Record<Exclude<GarmentPart, 'outfit'>, string> = {
  top: 'crop top|tank top|bikini top|t-shirt|tee|shirt|top|blouse|sweater|hoodie|cardigan|camisole|cami|bralette|bra|jacket',
  bottom: 'pajama shorts|shorts|pants|jeans|trousers|skirt|leggings|bikini bottoms?|bottoms?|panties|thong',
  dress: 'sundress|dress|gown',
  shoes: 'shoes|sneakers|heels|boots|sandals|slippers',
};
const GARMENT = `${Object.values(PART_NOUNS).join('|')}|clothing|clothes|outfit`;
const CHANGE_RE = new RegExp(`\\b(?:(?:just|only)\\s+)?(?:change|swap|replace|switch)\\s+(?:the\\s+|her\\s+)?(${GARMENT})\\s+(?:to|into|with|for)\\s+(.+)$`, 'i');
const MAKE_RE = new RegExp(`\\b(?:(?:just|only)\\s+)?make\\s+(?:the\\s+|her\\s+)(${GARMENT})\\s+([a-z-]+)$`, 'i');
const KEEP_ALL_RE = /\b(keep|leave)\s+(everything|the rest|all)\s+(else\s+)?(exactly\s+)?(the\s+same|as\s+(it\s+)?is|unchanged|as\s+it\s+was)\b[,;:]?\s*(but\s+|and\s+)?/gi;

function partOf(noun: string): GarmentPart {
  const n = noun.toLowerCase();
  for (const [part, words] of Object.entries(PART_NOUNS)) if (new RegExp(`^(${words})$`).test(n)) return part as GarmentPart;
  return 'outfit';
}

/** The garment swaps a sentence asks for ("change her top to X", "make her shorts red"). */
export function clothingChanges(sentence: string): ClothingChange[] {
  const s = sentence.trim().replace(/[.!?]+$/, '').replace(KEEP_ALL_RE, '');
  const c = CHANGE_RE.exec(s);
  if (c) return [{ part: partOf(c[1]), to: c[2].trim() }];
  const m = MAKE_RE.exec(s);
  if (m) return [{ part: partOf(m[1]), to: `${m[2]} ${m[1]}` }];
  return [];
}

/**
 * Applies garment swaps to the outfit of the photo being edited: "change her top to a red tank top" on "gray pajama
 * shorts and a loose white crop top" → "gray pajama shorts and a red tank top". A whole-outfit or dress change
 * replaces the outfit; a garment the outfit doesn't mention is added.
 */
export function applyClothingChanges(outfit: string, changes: ClothingChange[]): string {
  let out = outfit;
  for (const { part, to } of changes) {
    if (part === 'outfit' || part === 'dress' || !out.trim()) {
      out = `wearing ${to}`;
      continue;
    }
    const mod = `(?:(?!(?:and|or|with|wearing|in|she|she's|is|over|under)\\b)[\\w'-]+\\s+){0,3}`;
    const re = new RegExp(`\\b(?:(?:an?|her|the)\\s+)?${mod}(?:${PART_NOUNS[part]})\\b`, 'i');
    out = re.test(out) ? out.replace(re, to) : `${out}, ${to}`;
  }
  return out;
}

type Slot = Exclude<keyof PromptFields, 'avoid'> | 'identity';

const K = (words: string) => new RegExp(`\\b(${words})\\b`, 'gi');
const SLOT_WORDS: [Slot, RegExp][] = [
  ['outfit', K('wear|wears|wearing|dressed|outfit|clothes|clothing|bikini|thong|g-string|swimsuit|lingerie|bra|bralette|panties|underwear|shirt|t-shirt|tee|top|crop top|tank top|blouse|sweater|hoodie|jacket|coat|dress|sundress|gown|skirt|shorts|pants|jeans|leggings|pajamas?|pyjamas?|robe|towel|corset|bodysuit|leotard|heels|shoes|sneakers|boots|sandals|socks|stockings|jewelry|necklace|earrings|nude|naked|topless|fabric|denim|cotton|silk|lace|satin|knit')],
  ['pose', K('stand|standing|stands|sit|sitting|sits|seated|lying|laying|lies|lean|leaning|leans|kneel|kneeling|bend|bending|bent|squat|squatting|crouch|crouching|walk|walking|run|running|pose|posing|leg|legs|knee|knees|foot|feet|arm|arms|hand|hands|holding|holds|hold|resting|rests|hip|hips|turned|facing|back to the camera|from behind|over her shoulder|stretching|dancing|jumping|reaching|propped|crossed')],
  ['expression', K('smile|smiling|smiles|grin|grinning|laugh|laughing|expression|pout|pouting|smirk|playful|serious|relaxed|happy|sultry|flirty|shy|looking at the camera|eye contact|eyes closed|mouth|lips|biting')],
  ['setting', K('kitchen|bedroom|bathroom|living room|room|apartment|house|home|office|gym|pool|beach|ocean|sea|lake|forest|park|street|city|cafe|café|restaurant|bar|car|hotel|balcony|garden|backyard|mountain|desert|studio|background|indoors|outdoors|outside|inside|cabinets|counter|couch|sofa|bed|mirror|window|wall|floor|shower|sand|waves|scenery|environment|interior')],
  ['lighting', K('light|lighting|lit|sunlight|sunlit|sunset|sunrise|golden hour|daylight|shadows?|shade|lamp|neon|flash|backlit|backlighting|glow|overcast|morning light|night|dim|bright')],
  ['camera', K('iphone|phone|selfie|camera|lens|angle|perspective|shot from|taken from|point of view|pov|eye level|low angle|high angle|wide angle|wide-angle|dslr|35mm|50mm|24mm|portrait mode|zoom|tripod|mirror selfie|front camera|rear camera')],
  ['framing', K('full body|full-body|full length|full-length|head to toe|head to feet|close-up|closeup|close up|waist up|waist-up|half body|half-body|portrait|headshot|cropped|framing|framed|in frame|wide shot|medium shot|centered|centred')],
  ['realism', K('realistic|realism|photorealistic|unedited|real photo|real photograph|raw|natural skin|skin texture|pores|grain|noise|candid|authentic|believable|no filter|unretouched|amateur')],
  ['bodyPresentation', K('hair|ponytail|bun|braid|curls|makeup|tan|tanned|skin|freckles|body|figure|curves|waist|abs|nails|tattoo')],
];
const PRIORITY: Slot[] = ['outfit', 'pose', 'setting', 'lighting', 'camera', 'framing', 'expression', 'bodyPresentation', 'realism', 'extra'];

/** A sentence that only asks for Sienna's established look adds nothing: her LoRA + face reference handle it. */
const IDENTITY_ONLY_RE =
  /\b(her )?(face|features|appearance|identity|likeness)\b[^.]*\b(sienna|established|exactly|same|consistent|match(es)?|look(s)? like)\b|\b(look|looks|looking) (exactly )?like (sienna|herself|her established)\b|\bsienna'?s? (established |usual |real )?(face|appearance|look|identity)\b/i;
const LEAD_IN_RE =
  /^\s*(please\s+)?((generate|create|make|render|produce|draw|show|give me|i want|i'd like|i would like)\b(\s+(me|an?|the|one))*(\s+(image|picture|photo|photograph|shot|selfie|pic)s?\s+(of|showing|with|where))?\s*)/i;
const NEGATION_RE = /\b(?:no|without|avoid|avoiding|never|not|don't|do not|doesn't|does not|shouldn't|should not)\b\s+(?:(?:show|include|add|have|use|make|be|any|wear|wearing)\s+)*(?:(?:an?|the|any|her)\s+)?([^,.;]+)/gi;
const KEEP_NEGATION_RE = /^(too|very|overly|so|that|just|only|exactly|quite)\b/i;

/** A leading or trailing "(completely) nude / naked" in a clause that says more (pose, place …). */
const NUDE_INTENSIFIER = String.raw`(?:completely|fully|totally|entirely|stark)\s+`;
const NUDE_FOLLOW = String.raw`(?=\s*(?:[,;]|$)|\s+(?:on|in|at|by|lying|laying|sitting|standing|kneeling|posing|leaning|bent|bending|with|and|under|against|outside|inside)\b)`;
const NUDE_PART_RE = new RegExp(
  [
    String.raw`^\s*${NUDE_INTENSIFIER}(?:nude|naked)\b(?!-)${NUDE_COLOUR_LOOKAHEAD}[\s,;]*`,
    String.raw`^\s*naked\b(?!-)${NUDE_COLOUR_LOOKAHEAD}[\s,;]*`,
    String.raw`^\s*nude\b(?!-)${NUDE_FOLLOW}[\s,;]*`,
    String.raw`[\s]*[,;]\s*(?:${NUDE_INTENSIFIER})?(?:nude|naked)\s*$`,
    String.raw`\s+${NUDE_INTENSIFIER}(?:nude|naked)\s*$`,
    String.raw`\s+naked\s*$`,
  ].join('|'),
  'i',
);

const ADULT_RE = /\b(nude|naked|nudity|topless|bottomless|lingerie|see-through|sheer|bare (breasts|chest|butt|bottom)|nipples?|implied nud\w*|g-string|thong)\b/i;
const OUTDOOR_RE = /\b(beach|ocean|sea|lake|forest|park|street|city|outdoors?|outside|garden|backyard|mountain|desert|pool|balcony|sun|sunlight|sunset|sunrise|golden hour|daylight)\b/i;

/**
 * Instructions to the app rather than things to draw: lead-ins ("Generate …"), reference-photo directions ("use this
 * photo as the reference", "keep the same pose" — the reference settings do that), "make it look like X" → X, and
 * "replace the background with X" → "X background". Wording that describes the picture is left as written.
 */
export function tidyClause(raw: string): string {
  let s = raw.trim().replace(/^(and|but|so|then|also|plus)\s+/i, '');
  // "make X look like Y" → Y (before the lead-in rule, which would eat the "make")
  s = s.replace(/\bmake\s+(the\s+final\s+(result|image|photo|picture)|it|everything|the\s+(photo|image|picture|result|whole\s+(photo|image|picture)))\s+(look|looks)\s+(like\s+)?/gi, '');
  s = s.replace(KEEP_ALL_RE, '');
  s = s.replace(CHANGE_RE, (m, noun: string, to: string) => (/^(background|setting|scene|location)$/i.test(noun) ? m : `wearing ${to}`));
  s = s.replace(MAKE_RE, (_m, noun: string, adj: string) => `wearing ${/^(clothing|clothes|outfit)$/i.test(noun) ? `${adj} clothes` : `a ${adj} ${noun}`}`);
  s = s.replace(/^\s*(?:(?:just|only)\s+)?make\s+it\s+(?:into\s+)?(?=(an?|the)\b)/i, ''); // "make it a beach at sunset" → "a beach at sunset"
  s = s.replace(LEAD_IN_RE, '');
  // ("a friend is taking the picture" describes the photo: only "take … as the reference" is an instruction)
  s = s.replace(/\b(use|using)\s+(this|the|my|that)\s+(uploaded\s+)?(photo|photograph|image|picture|pic|reference)(\s+as\s+(the|a)\s+reference)?\b/gi, '');
  s = s.replace(/\b(take|taking)\s+(this|the|my|that)\s+(uploaded\s+)?(photo|photograph|image|picture|pic)\s+as\s+(the|a)\s+reference\b/gi, '');
  s = s.replace(/\b(keep|preserve|maintain|retain)\s+(the\s+)?(exact\s+)?same\s+(overall\s+)?(pose|composition|framing|position|posture|angle|layout)\b/gi, '');
  s = s.replace(/\b(replace|change|swap)\s+(the\s+)?(background|setting|scene|location)\s+(with|to|for|into)\s+(.+)$/i, '$5 background');
  s = s.replace(/\b(change|replace|swap)\s+(the\s+|her\s+)?(clothing|clothes|outfit)\s+(with|to|for|into)\s+(.+)$/i, 'wearing $5');
  s = s.replace(/^\s*(change|replace|swap)\s+(the\s+|her\s+)?(clothing|clothes|outfit|background|setting)\s*$/i, '');
  s = s.replace(/\b(of|with|for|to|at|like|beside|next to)\s+Sienna(?: Brooks)?\b/g, '$1 her');
  s = s.replace(/\bSienna(?: Brooks)?'s\b/g, 'her').replace(/\bSienna(?: Brooks)?\b/g, 'she');
  s = s.replace(/^she\s+(in|wearing|with|on|at)\b/i, '$1'); // "Sienna in a red dress" → "in a red dress"
  s = s.replace(/^she\s+(?=\w+ing\b|(completely|fully|totally|entirely|stark|nude|naked|topless|barefoot)\b)/i, ''); // "Sienna standing in …" / "Sienna completely nude" → "standing in …" / "completely nude"
  return s.replace(/\s{2,}/g, ' ').replace(/^[\s,;:]+|[\s,;:]+$/g, '').trim();
}

function sentences(text: string): string[] {
  const out: string[] = [];
  for (const s of text.replace(/\r/g, '').split(/(?<=[.!?])\s+|\n+/)) {
    const t = s.trim().replace(/[.!?]+$/, '');
    if (!t) continue;
    // a long comma list (keyword-style prompt) is split into clauses so each lands in the right field
    // "standing by the pool …, wearing a pink bikini …" → the outfit is its own piece (else the place rides in Outfit)
    // ("She's wearing …" stays whole: only a clause of four or more words before "wearing" is split off)
    const m = /^(.{12,}?\S+(?:\s+\S+){3,}?),?\s+((?:and\s+)?wearing\b.*)$/i.exec(t);
    const pieces = m && m[1].split(/\s+/).length >= 4 ? [m[1], m[2]] : [t];
    const parts = pieces.flatMap((p) => (p.length > 140 && (p.match(/,/g)?.length ?? 0) >= 3 ? p.split(/\s*,\s*/) : [p]));
    out.push(...parts.map((p) => p.trim()).filter(Boolean));
  }
  return out;
}

function score(s: string, re: RegExp) {
  return (s.match(re) ?? []).length;
}

/** A sentence about the photographer, not about her ("a friend is taking the picture, standing seven feet away"). */
const PHOTOGRAPHER_RE =
  /\b(friend|photographer|boyfriend|girlfriend|someone|somebody|he|they|camera(wo)?man)\b[^.]{0,40}\b(tak(e|es|ing)|took|hold(s|ing)?|shoot(s|ing)?|snap(s|ping)?)\b|\b(taking|takes|took|snapping) (the|a|this) (picture|photo|shot|pic)\b|\bholding the (phone|camera)\b|\bphone (held )?(vertically|horizontally)\b|\bcamera (at|held at) (waist|chest|eye|hip) (height|level)\b/i;

function classify(s: string): Slot {
  if (PHOTOGRAPHER_RE.test(s)) return 'camera';
  if (IDENTITY_ONLY_RE.test(s) && !/\b(wear|wearing|standing|sitting|lying|holding|in (her|a|the))\b/i.test(s)) return 'identity';
  let best: Slot = 'extra';
  let bestScore = 0;
  for (const slot of PRIORITY) {
    const re = SLOT_WORDS.find(([k]) => k === slot)?.[1];
    if (!re) continue;
    const n = score(s, re);
    if (n > bestScore) {
      best = slot;
      bestScore = n;
    }
  }
  return best;
}

/** "no X" phrases out of a piece of text: [text without them, avoid terms]. */
export function splitNegatives(s: string): [string, string[]] {
  const avoid: string[] = [];
  const kept = s.replace(NEGATION_RE, (m, what: string) => {
    const w = what.trim().replace(/\s+(at all|whatsoever|please)$/i, '');
    if (!w || KEEP_NEGATION_RE.test(w) || w.split(/\s+/).length > 8) return m; // "not too bright", long clauses: leave as said
    avoid.push(w);
    return '';
  });
  return [kept.replace(/\s{2,}/g, ' ').replace(/\s+([,.;])/g, '$1').replace(/^[\s,;]+|[\s,;]+$/g, ''), avoid];
}

export function interpretPrompt(
  text: string,
  opts: { hasReference?: boolean; adultAllowed?: boolean; defaultMode?: ContentMode } = {},
): Interpretation {
  const fields = Object.fromEntries(PROMPT_FIELD_KEYS.map((k) => [k, ''])) as unknown as PromptFields;
  const buckets: Record<string, string[]> = {};
  const avoid: string[] = [];
  const notes: string[] = [];
  const changes: ClothingChange[] = [];
  let identityDropped = 0;

  for (const raw of sentences(text)) {
    changes.push(...clothingChanges(raw));
    const s = tidyClause(raw);
    if (!s) continue;
    const [kept0, neg] = splitNegatives(s);
    avoid.push(...neg);
    // "completely nude lying on her back …": the nudity is the outfit, the rest is classified on its own (else the
    // pose words win and the outfit stays empty, so nude-only steps never see a nude request — fig21, 24 Oct)
    const nude = NUDE_PART_RE.exec(kept0);
    const kept = nude ? kept0.replace(NUDE_PART_RE, ' ').replace(/\s{2,}/g, ' ').replace(/^[\s,;]+|[\s,;]+$/g, '') : kept0;
    if (nude && kept) (buckets.outfit ??= []).push(nude[0].replace(/^[\s,;]+|[\s,;]+$/g, ''));
    else if (nude) {
      (buckets.outfit ??= []).push(kept0);
      continue;
    }
    if (!kept) continue;
    const slot = classify(kept);
    if (slot === 'identity') {
      identityDropped++;
      continue;
    }
    (buckets[slot] ??= []).push(kept);
  }
  for (const k of PROMPT_FIELD_KEYS) if (k !== 'avoid') fields[k] = (buckets[k] ?? []).join(', ');
  fields.avoid = [...new Set(avoid.map((a) => a.toLowerCase()))].join(', ');

  if (identityDropped) notes.push('Sienna’s face, hair and body come from her profile, model and face reference — no need to describe them.');
  if (avoid.length) notes.push(`Kept out of the picture: ${fields.avoid}.`);

  // content mode: an explicit request for nudity or adult wardrobe needs adult mode (SFW adds "nude, lingerie,
  // see-through" to the negative and would quietly cover her up)
  let contentMode: ContentMode = opts.defaultMode ?? 'sfw';
  const adultAsked = ADULT_RE.test(text.replace(NEGATION_RE, ''));
  if (adultAsked && contentMode === 'sfw') {
    if (opts.adultAllowed) {
      contentMode = 'adult';
      notes.push('Adult mode, because the description asks for nudity or adult wardrobe.');
    } else notes.push('The description asks for nudity or adult wardrobe, but adult mode is off on this server — it will be generated as SFW.');
  }

  // a pack that only runs in adult mode (string bikini, lace lingerie, monokini …) asks for adult wardrobe too
  let packs = packsForDescription(fields, contentMode);
  if (contentMode === 'sfw' && opts.adultAllowed) {
    const adultPacks = packsForDescription(fields, 'adult');
    if (STYLE_PACKS.some((p) => p.section === 'adult' && adultPacks[p.id])) {
      contentMode = 'adult';
      packs = adultPacks;
      notes.push('Adult mode, because the outfit you describe uses an adult style pack.');
    }
  }
  // the tiny string look at full strength also needs its shape in words, or the cups stay regular-sized
  const string = STYLE_PACKS.find((p) => p.id === 'string_swimsuit');
  if (string && packs.string_swimsuit === string.max && !fields.outfit.includes(TINY_STRING_OUTFIT)) fields.outfit = `${fields.outfit}, ${TINY_STRING_OUTFIT}`;
  if (Object.keys(packs).length) notes.push(packNote(packs));

  const reference = referenceIntent(text, !!opts.hasReference);
  if (reference.mode !== 'none') notes.push(reference.why);
  if (OUTDOOR_RE.test(`${fields.setting} ${fields.lighting}`) && !fields.lighting) notes.push('Outdoor scene: natural daylight instead of the default indoor lighting.');
  return { fields, contentMode, reference, changes, packs, notes };
}

export function packNote(packs: Record<string, number>): string {
  const names = Object.entries(packs).map(([id, v]) => `${STYLE_PACKS.find((p) => p.id === id)?.label ?? id} (${v})`);
  return `Style ${names.length > 1 ? 'packs' : 'pack'} switched on by your description: ${names.join(', ')}.`;
}

/**
 * How to use an uploaded photo. "Keep the same pose" → pose ControlNet (new scene, clothes and background, same
 * body position); "keep the composition / only change …" → img2img from the photo at a moderate change level; a
 * photo with no instructions → both (her pose and the overall photo, redrawn as Sienna).
 */
export function referenceIntent(text: string, hasReference: boolean): Interpretation['reference'] {
  if (!hasReference) return { mode: 'none', denoise: null, why: '' };
  const t = text.toLowerCase();
  const pose = /\b(same|keep|copy|match|use)\b[^.]{0,30}\b(pose|position|posture|stance|body position)\b|\b(pose|position) (from|of|in) (the|this) (photo|image|picture|reference)\b/.test(t);
  const composition = /\b(same|keep|preserve|match)\b[^.]{0,30}\b(composition|framing|angle|photo|picture|image|scene|layout|everything)\b|\b(only|just) (change|replace|swap|edit|fix)\b|\b(recreate|remake|redo|touch up|retouch)\b/.test(t);
  const bigChange = /\b(replace|change|swap|different|new)\b[^.]{0,30}\b(background|setting|location|room|scene|clothes|clothing|outfit|dress)\b/.test(t);
  const garmentSwap = clothingChanges(text.split(/(?<=[.!?])\s+|\n+/).find((x) => clothingChanges(x).length) ?? '').length > 0;
  if (pose && !composition) return { mode: 'pose', denoise: null, why: 'Reference photo: her pose is copied; outfit, background and look follow your description.' };
  // a colour or garment swap needs more change than 0.5 allows (a gray top stayed gray), and the pose ControlNet
  // keeps her body where it was at the higher level
  if (composition && garmentSwap && !/\b(background|setting|location|room|scene)\b/.test(t))
    return { mode: 'edit+pose', denoise: 0.62, why: 'Reference photo: edited in place — same pose and composition, with the clothing change you describe.' };
  if (composition && !bigChange)
    return { mode: pose ? 'edit+pose' : 'edit', denoise: 0.5, why: 'Reference photo: edited in place — composition kept, only what you describe changes.' };
  if (composition || bigChange)
    return { mode: 'edit+pose', denoise: 0.72, why: 'Reference photo: same pose and framing, with the changes you describe (new background or clothing redrawn).' };
  return { mode: 'edit+pose', denoise: 0.62, why: 'Reference photo: recreated as Sienna — same pose and composition.' };
}
