/**
 * Outfit reference
 * ================
 *
 * The user uploads a photo of an outfit. Two things happen with it:
 *
 *  1. Analysis (POST /api/outfit/analyze): the person in the photo is cut out
 *     with a person segmenter, the face and hair are cut away (face bbox,
 *     generously dilated), the rest is put on flat grey, and Florence-2
 *     describes what is left. The caption is reduced to the garment and parsed
 *     into attributes the user can review before using it as the Outfit text.
 *
 *  2. Generation: the same garment-only crop conditions the first sampling
 *     pass through IPAdapter (clothing only — the reference woman's face never
 *     reaches the model). The face-refinement pass keeps the plain Sienna LoRA
 *     model, so identity settings are unaffected.
 *
 * Neither step reproduces a garment exactly: IPAdapter transfers the overall
 * look (colour, fabric, cut, coverage), and small details such as strap
 * layouts or exact cutout shapes may drift. See the limitation notes below.
 */

import type { ComfyGraph, OutfitMode } from './types';

/** IPAdapter weight type per mode (tune here after fidelity tests). */
export const OUTFIT_WEIGHT_TYPE: Record<OutfitMode, string> = {
  // Style-only blocks: copies colour/fabric/cut but leaves pose, framing and background to the prompt.
  design: 'style transfer',
  // More style blocks for closer garment detail. Not 'linear': in testing that copied the
  // reference's pose, studio background and identity cues (hair, skin tone, a smeared face).
  close: 'strong style transfer',
};

export const OUTFIT_MODE_LABELS: Record<OutfitMode, string> = {
  design: 'Keep design, new pose & background',
  close: 'Match reference closely',
};

/**
 * Modes offered in the UI. 'close' is withheld: in fidelity testing both 'linear' and
 * 'strong style transfer' copied the reference's pose, studio background and identity
 * cues (skin tone, hair), which the outfit feature must never do.
 */
export const OUTFIT_MODES_OFFERED: OutfitMode[] = ['design'];

/** Highest outfit strength applied; above ~0.8 the reference background starts to creep in. */
export const OUTFIT_MAX_STRENGTH = 1.0;
export const OUTFIT_RECOMMENDED = '0.6–0.8';

/** Outfit words that the SFW negative prompt may tone down. */
export const REVEALING_OUTFIT_RE =
  /\b(swimsuit|bikini|monokini|lingerie|bra|bralette|corset|bustier|teddy|babydoll|thong|sheer|see-through|mesh|cut-?outs?|backless|plunging|micro|high-cut)\b/i;

export const OUTFIT_LIMITATIONS = [
  'The outfit is matched by look, not copied pixel-for-pixel: small details (strap layout, lace pattern, exact cutout shape, logos, text) can drift.',
  'Only clothing is used — the face and hair of the person in the photo are masked out before anything reaches the model.',
  'Colour-block and print layouts are reinterpreted (e.g. a diagonal stripe may come out as a V).',
  'Florence-2 can misread details (it called wide swimsuit straps "thin") — check the description before using it.',
  'Above about 0.8 the reference photo’s plain background and pose start to creep in; 0.6–0.8 works best.',
];

// ── Garment isolation (shared by the analysis graph and the production workflow) ──

export const OUTFIT_SEGM_MODEL = 'segm/person_yolov8m-seg.pt';
export const OUTFIT_FACE_MODEL = 'bbox/face_yolov8m.pt';
export const OUTFIT_IPADAPTER_FILE = 'ip-adapter-plus_sdxl_vit-h.safetensors';
export const OUTFIT_CLIP_VISION_FILE = 'CLIP-ViT-H-14-laion2B-s32B-b79K.safetensors';
export const FLORENCE_MODEL = 'microsoft/Florence-2-large';

/**
 * Nodes that turn LoadImage `imageId` into a garment-only image on grey.
 * Returns the nodes and the id of the node whose output 0 is that image.
 */
export function garmentIsolationNodes(imageId: string, start = 61): { nodes: ComfyGraph; outputId: string } {
  const id = (n: number) => String(start + n);
  const nodes: ComfyGraph = {
    [id(0)]: { class_type: 'UltralyticsDetectorProvider', inputs: { model_name: OUTFIT_SEGM_MODEL }, _meta: { title: 'Outfit: Person Segmenter' } },
    [id(1)]: {
      class_type: 'SegmDetectorCombined_v2',
      inputs: { segm_detector: [id(0), 1], image: [imageId, 0], threshold: 0.4, dilation: 4 },
      _meta: { title: 'Outfit: Person Mask' },
    },
    [id(2)]: { class_type: 'UltralyticsDetectorProvider', inputs: { model_name: OUTFIT_FACE_MODEL }, _meta: { title: 'Outfit: Face Detector' } },
    [id(3)]: {
      class_type: 'BboxDetectorCombined_v2',
      inputs: { bbox_detector: [id(2), 0], image: [imageId, 0], threshold: 0.3, dilation: 48 },
      _meta: { title: 'Outfit: Face + Hair Mask' },
    },
    [id(4)]: {
      class_type: 'MaskComposite',
      inputs: { destination: [id(1), 0], source: [id(3), 0], x: 0, y: 0, operation: 'subtract' },
      _meta: { title: 'Outfit: Body Minus Face' },
    },
    [id(5)]: { class_type: 'GetImageSizeAndCount', inputs: { image: [imageId, 0] }, _meta: { title: 'Outfit: Image Size' } },
    [id(6)]: {
      class_type: 'EmptyImage',
      inputs: { width: [id(5), 1], height: [id(5), 2], batch_size: 1, color: 0x808080 },
      _meta: { title: 'Outfit: Grey Background' },
    },
    [id(7)]: {
      class_type: 'ImageCompositeMasked',
      inputs: { destination: [id(6), 0], source: [id(5), 0], x: 0, y: 0, resize_source: false, mask: [id(4), 0] },
      _meta: { title: 'Outfit: Garment Only' },
    },
  };
  return { nodes, outputId: id(7) };
}

/** Node in the analysis graph whose text output is the caption (other nodes, e.g. KJNodes, also publish text). */
export const OUTFIT_CAPTION_NODE = '22';

/** Node class that publishes a STRING to the job history (installed by scripts/comfyui-bootstrap.sh). */
export const TEXT_OUTPUT_CLASS = 'SiennaTextOutput';

/**
 * Analysis graph: garment isolation → Florence-2 detailed caption.
 * Outputs: the garment-only preview (PreviewImage) and the caption (SiennaTextOutput).
 */
export function buildOutfitAnalysisGraph(uploadedName: string): ComfyGraph {
  const iso = garmentIsolationNodes('1', 2);
  return {
    '1': { class_type: 'LoadImage', inputs: { image: uploadedName }, _meta: { title: 'Outfit Reference Image' } },
    ...iso.nodes,
    '20': { class_type: 'DownloadAndLoadFlorence2Model', inputs: { model: FLORENCE_MODEL, precision: 'fp16' }, _meta: { title: 'Florence-2' } },
    '21': {
      class_type: 'Florence2Run',
      inputs: {
        image: [iso.outputId, 0],
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
      _meta: { title: 'Describe Outfit' },
    },
    [OUTFIT_CAPTION_NODE]: { class_type: TEXT_OUTPUT_CLASS, inputs: { text: ['21', 2] }, _meta: { title: 'Outfit Caption' } },
    '23': { class_type: 'PreviewImage', inputs: { images: [iso.outputId, 0] }, _meta: { title: 'Garment Preview' } },
  };
}

// ── Caption → outfit description ───────────────────────────────────────────

const GARMENT_NOUNS =
  'dress|gown|slip|bikini|swimsuit|one-piece|monokini|bodysuit|jumpsuit|romper|playsuit|top|crop top|tank|camisole|cami|blouse|shirt|t-shirt|tee|sweater|jumper|hoodie|cardigan|jacket|blazer|coat|vest|skirt|shorts|jeans|pants|trousers|leggings|lingerie|bra|bralette|corset|bustier|teddy|babydoll|robe|kimono|sarong|outfit|garment|set|suit|halter|straps?|neckline|sleeves?|hem|waist(?:band)?|belt|bottoms?|briefs|heels|boots|sandals|shoes|sneakers|stockings|tights|necklace|bracelet|earrings?|choker';
// String concatenation, not a template literal: the production minifier mangles "\\b" inside templates.
const GARMENT_RE = new RegExp('\\b(?:' + GARMENT_NOUNS + ')\\b', 'i');
/** "in a/an/her <up to 6 words> <garment>" — the garment phrase is group 1. */
const IN_GARMENT_RE = new RegExp('\\bin\\s+(?:a|an|her)\\s+((?:[\\w-]+,?\\s+){0,6}?(?:' + GARMENT_NOUNS + '))\\b', 'i');
/** Sentences about the person, setting or photo rather than the clothes. */
const NON_GARMENT_RE =
  /\b(hair|face|faces|eyes?|smil\w*|expression|lips|mouth|makeup|head|headless|background|wall|room|floor|ground|backdrop|scene|grey|gray|photo|photograph|picture|image|camera|lighting|light|shadow|skin|tattoo\w*)\b/i;
/** Body descriptors that must not transfer to Sienna (her body comes from the LoRA). */
const BODY_WORDS_RE =
  /\b(?:(?:slender|skinny|petite|curvy|voluptuous|busty|athletic|muscular|young|beautiful|pretty|attractive|sexy)\b|(?:slim|thin|tall|short|lean|toned|fit)\s+(?=(?:woman|girl|lady|body|figure|frame|build|physique|waist|legs|arms|model)\b))\s*/gi;
/** Where a "wearing …" clause stops describing clothes. */
const CLAUSE_END_RE =
  /\s*(?:,\s*)?\b(?:and (?:she|her|appears|stands|looks)|and (?:is|are) \w+ing|while|revealing|showing|she is|she's|her (?:hair|face|arms?|hands?|legs?|body)|standing|sitting|posing|leaning|holding|looking|in front of|against|with (?:her|a) (?:hair|hand|arm)|the background)\b.*$/i;

function sentences(text: string): string[] {
  return text
    .replace(/\s+/g, ' ')
    .split(/(?<=[.!?])\s+/)
    .map((s) => s.trim())
    .filter(Boolean);
}

function tidy(phrase: string): string {
  return phrase
    .replace(BODY_WORDS_RE, '')
    .replace(/\b(she is|she's|it is|it's|the woman is|the person is|the model is)\s+/gi, '')
    .replace(/\bher\s+/gi, '')
    .replace(/^(?:a|an)\s+/i, '')
    .replace(/\s{2,}/g, ' ')
    .replace(/^[\s,;:-]+|[\s,;:.-]+$/g, '')
    .trim();
}

/**
 * Reduce a Florence-2 caption to the clothing only. Sentences about the face,
 * hair, body, pose or background are dropped; body descriptors are removed so
 * nothing about the reference person's appearance reaches Sienna's prompt.
 */
export function outfitFromCaption(caption: string): string {
  const out: string[] = [];
  for (const s of sentences(caption)) {
    const wearing = s.match(/\b(?:wearing|dressed in|wears|has on)\s+(.+)$/i);
    if (wearing) {
      const phrase = tidy(wearing[1].replace(CLAUSE_END_RE, ''));
      if (phrase) out.push(phrase);
      continue;
    }
    if (!GARMENT_RE.test(s)) continue;
    // "taking a selfie in a white bikini", "posing in her red satin dress"
    const inGarment = s.match(IN_GARMENT_RE);
    if (inGarment) {
      const phrase = tidy(inGarment[1]);
      if (phrase) out.push(phrase);
      continue;
    }
    // "The dress has thin straps…" — keep, unless the sentence is really about the person or setting.
    const subject = s.split(/\s+/).slice(0, 5).join(' ');
    if (!GARMENT_RE.test(subject) && NON_GARMENT_RE.test(s)) continue;
    const phrase = tidy(s.replace(CLAUSE_END_RE, ''));
    if (phrase && !NON_GARMENT_RE.test(phrase.split(/\s+/).slice(0, 3).join(' '))) out.push(phrase);
  }
  const seen = new Set<string>();
  return out
    .map((p) => p.charAt(0).toLowerCase() + p.slice(1))
    .filter((p) => (seen.has(p) ? false : (seen.add(p), true)))
    .join(', ');
}

// ── Attribute extraction ────────────────────────────────────────────────────

export const OUTFIT_ATTRIBUTE_KEYS = ['type', 'colour', 'fabric', 'straps', 'neckline', 'cutouts', 'coverage', 'fit', 'accessories'] as const;
export type OutfitAttributeKey = (typeof OUTFIT_ATTRIBUTE_KEYS)[number];
export type OutfitAttributes = Record<OutfitAttributeKey, string[]>;

export const OUTFIT_ATTRIBUTE_LABELS: Record<OutfitAttributeKey, string> = {
  type: 'Garment type',
  colour: 'Colour',
  fabric: 'Fabric',
  straps: 'Straps',
  neckline: 'Neckline',
  cutouts: 'Cutouts / openings',
  coverage: 'Coverage / length',
  fit: 'Fit',
  accessories: 'Accessories',
};

// Longer phrases first so "mini dress" wins over "dress".
const VOCAB: Record<OutfitAttributeKey, string[]> = {
  type: [
    'slip dress', 'bodycon dress', 'mini dress', 'midi dress', 'maxi dress', 'wrap dress', 'sundress', 'cocktail dress', 'evening gown', 'gown', 'dress',
    'one-piece swimsuit', 'swimsuit', 'bikini top', 'bikini bottoms', 'bikini', 'monokini', 'bodysuit', 'jumpsuit', 'romper', 'playsuit',
    'crop top', 'tank top', 'tube top', 'camisole', 'blouse', 't-shirt', 'shirt', 'sweater', 'hoodie', 'cardigan', 'jacket', 'blazer', 'coat', 'vest',
    'mini skirt', 'pencil skirt', 'skirt', 'shorts', 'jeans', 'trousers', 'pants', 'leggings',
    'lingerie', 'bralette', 'bra', 'corset', 'bustier', 'teddy', 'babydoll', 'robe', 'kimono', 'sarong', 'top',
  ],
  colour: [
    'black', 'white', 'ivory', 'cream', 'beige', 'nude', 'tan', 'brown', 'camel', 'grey', 'gray', 'silver', 'gold',
    'red', 'burgundy', 'wine', 'maroon', 'pink', 'hot pink', 'blush', 'rose', 'coral', 'orange', 'peach', 'yellow', 'mustard',
    'green', 'olive', 'emerald', 'sage', 'mint', 'teal', 'turquoise', 'blue', 'navy', 'royal blue', 'baby blue', 'light blue', 'cobalt',
    'purple', 'lavender', 'lilac', 'violet', 'plum', 'magenta', 'floral', 'striped', 'polka dot', 'leopard print', 'animal print', 'plaid', 'checked', 'patterned', 'metallic', 'neon',
  ],
  fabric: [
    'satin', 'silk', 'lace', 'mesh', 'chiffon', 'cotton', 'denim', 'faux leather', 'leather', 'latex', 'vinyl', 'pvc', 'velvet', 'ribbed', 'knit',
    'linen', 'sequined', 'sequins', 'sequin', 'crochet', 'nylon', 'spandex', 'lycra', 'jersey', 'tulle', 'organza', 'wool', 'cashmere', 'fishnet', 'sheer', 'shiny', 'glossy', 'matte',
  ],
  straps: [
    'spaghetti straps', 'spaghetti strap', 'thin straps', 'wide straps', 'adjustable straps', 'strapless', 'halter', 'one-shoulder', 'one shoulder',
    'off-the-shoulder', 'off the shoulder', 'cross-back', 'criss-cross', 'crisscross', 'lace-up', 'tie straps', 'tie-up', 'harness', 'straps', 'strap',
  ],
  neckline: [
    'deep v-neck', 'deep v', 'plunging neckline', 'plunging', 'v-neck', 'v neckline', 'sweetheart', 'scoop neck', 'square neck', 'crew neck',
    'high neck', 'turtleneck', 'mock neck', 'cowl neck', 'boat neck', 'halter neck', 'collared', 'collar', 'keyhole neckline',
  ],
  cutouts: [
    'side cutouts', 'cutouts', 'cutout', 'cut-outs', 'cut-out', 'open back', 'backless', 'low back', 'keyhole', 'high slit', 'thigh slit', 'slit',
    'peekaboo', 'mesh panels', 'mesh panel', 'ring detail', 'o-ring',
  ],
  coverage: [
    'see-through', 'sheer', 'cropped', 'micro', 'mini', 'midi', 'maxi', 'floor-length', 'knee-length', 'ankle-length', 'long sleeves', 'long-sleeved',
    'short sleeves', 'short-sleeved', 'sleeveless', 'high-cut', 'high cut', 'low-cut', 'low cut', 'high-waisted', 'low-rise', 'thong', 'cheeky', 'full coverage', 'modest',
  ],
  fit: [
    'form-fitting', 'skin-tight', 'tight-fitting', 'tight', 'fitted', 'bodycon', 'loose-fitting', 'loose', 'oversized', 'flowy', 'flowing', 'relaxed', 'wrap',
    'a-line', 'pencil', 'ruched', 'draped', 'corseted', 'tailored', 'pleated', 'ruffled', 'flared',
  ],
  accessories: [
    'belt', 'necklace', 'pendant', 'earrings', 'bracelet', 'choker', 'hat', 'sunglasses', 'handbag', 'bag', 'purse', 'clutch', 'high heels', 'heels', 'boots',
    'sandals', 'sneakers', 'gloves', 'scarf', 'garter', 'stockings', 'tights', 'watch', 'ring', 'headband', 'bow',
  ],
};

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** Keyword attributes found in an outfit description. Empty list = not detected. */
export function extractOutfitAttributes(text: string): OutfitAttributes {
  const lower = ` ${text.toLowerCase().replace(/\s+/g, ' ')} `;
  const out = {} as OutfitAttributes;
  for (const key of OUTFIT_ATTRIBUTE_KEYS) {
    let rest = lower;
    const found: string[] = [];
    for (const term of VOCAB[key]) {
      // "square neck" also matches "square neckline".
      const re = new RegExp('(^|[^a-z-])' + escapeRe(term) + (term.endsWith('neck') ? '(?:line)?' : '') + '(?![a-z])', 'g');
      if (re.test(rest)) {
        // "the dress" later in the text refers to the "midi dress" already found.
        if (!found.some((f) => new RegExp('(^|[^a-z-])' + escapeRe(term) + '(?![a-z])').test(f))) found.push(term);
        // Blank the match so "dress" isn't also reported after "mini dress".
        rest = rest.replace(re, (_m, pre: string) => pre + ' '.repeat(term.length));
      }
    }
    out[key] = found;
  }
  return out;
}

/** What the mock backend's "Florence-2" says about any outfit reference. */
export const MOCK_OUTFIT_CAPTION =
  'The image shows a woman wearing a fitted emerald green satin midi dress with thin spaghetti straps and a square neckline. ' +
  'The dress has a high slit on the left side and a thin gold belt at the waist. The background is a plain grey wall.';

export interface OutfitAnalysis {
  /** Raw Florence-2 caption of the garment-only crop. */
  caption: string;
  /** Caption reduced to clothing, ready for the Outfit field. */
  outfitText: string;
  attributes: OutfitAttributes;
  /** Problems the user should know about (nothing detected, person not found …). */
  notes: string[];
}

export function analyzeCaption(caption: string): OutfitAnalysis {
  const clean = caption.replace(/<\/?s>|<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
  const outfitText = outfitFromCaption(clean);
  const attributes = extractOutfitAttributes(outfitText || clean);
  const notes: string[] = [];
  if (!clean) notes.push('Florence-2 returned no description.');
  else if (!outfitText) notes.push('No clothing was recognised in the description — check the garment preview (was the person found?).');
  if (!attributes.type.length) notes.push('Garment type not detected — add it to the Outfit text yourself.');
  return { caption: clean, outfitText, attributes, notes };
}
