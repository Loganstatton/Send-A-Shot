/**
 * Edit Outfit (optional, Qwen-Image-Edit-2509)
 * ============================================
 *
 * Changes the clothes on an EXISTING Sienna image and saves the result as a new image; the
 * original is never touched. This is separate from the generator and the Outfit Reference
 * feature (neither is changed).
 *
 *   source image ──► scale to ~1 MP, same aspect ──┐
 *   clothing photo ─► crop below the chin ─────────┼─► Qwen-Image-Edit-2509 ─► back to the
 *                     (SiennaChinCrop)             │      (prompt below)          source size
 *                                                  │                                  │
 *                                                  └──────── Sienna FaceDetailer ◄────┘
 *                                                            (production settings; 0.3 or 0.45)
 *
 * Findings from the two GPU tests this is built on:
 *  - Qwen follows the TEXT over the photo: a wrong description (an invented cut-out) is copied and
 *    can leave the old trousers on. The description must match the clothing photo.
 *  - A clothing photo that shows a face makes Qwen copy that person → crop below the chin.
 *  - Explicitly listing the old outfit to remove ("replace-all" wording) removed jeans/sneakers
 *    for swimwear and bikinis in every test.
 *  - Qwen's own face drifts on small/angled faces; Sienna's FaceDetailer brings it back.
 *  - Footwear in the clothing photo can be copied even when "barefoot" is asked for.
 *
 * Pure module (no server imports): shared by the API route, the editor UI (prompt preview) and tests.
 */

import type { ComfyGraph } from './types';

export type OutfitEditScope = 'full' | 'top' | 'bottom';
export type OutfitEditFootwear = 'keep' | 'barefoot' | 'reference';
export type OutfitEditFace = 'off' | 'standard' | 'strong';

export const SCOPE_LABELS: Record<OutfitEditScope, string> = {
  full: 'Entire outfit',
  top: 'Top only',
  bottom: 'Bottom only',
};
export const FOOTWEAR_LABELS: Record<OutfitEditFootwear, string> = {
  keep: 'Keep current',
  barefoot: 'Barefoot',
  reference: 'From photo',
};
export const FACE_LABELS: Record<OutfitEditFace, string> = {
  off: 'Off',
  standard: 'Standard (0.3)',
  strong: 'Strong (0.45)',
};
/** FaceDetailer denoise per face-restore level. 0.3 = the production face refinement. */
export const FACE_DENOISE: Record<Exclude<OutfitEditFace, 'off'>, number> = { standard: 0.3, strong: 0.45 };

export const QWEN_EDIT_FILES = {
  unet: 'qwen_image_edit_2509_fp8_e4m3fn.safetensors',
  clip: 'qwen_2.5_vl_7b_fp8_scaled.safetensors',
  vae: 'qwen_image_vae.safetensors',
} as const;
export const FACE_DETECTOR_FILE = 'bbox/face_yolov8m.pt';

/** Sampling settings used in both GPU tests. */
export const QWEN_SAMPLING = { steps: 20, cfg: 2.5, sampler: 'euler', scheduler: 'simple', shift: 3 } as const;

/** Node classes the edit graph needs (besides core ComfyUI loaders). */
export const OUTFIT_EDIT_NODE_CLASSES = [
  'TextEncodeQwenImageEditPlus',
  'ModelSamplingAuraFlow',
  'CFGNorm',
  'SiennaChinCrop',
  'BboxDetectorCombined_v2',
  'UltralyticsDetectorProvider',
  'FaceDetailer',
] as const;

// ── Body protection (experimental) ───────────────────────────────────────────
// A: garmentOnly — the clothing photo's skin/figure/feet are removed, so there is no body to copy.
// B: bodyRef     — Sienna's approved body references go to the editor as image 3.
// C: bodyCheck   — her proportions are measured before/after (pose-, angle- and clothing-aware) + scene check.
export interface BodyProtect {
  garmentOnly: boolean;
  bodyRef: boolean;
  bodyCheck: boolean;
}
export const NO_PROTECT: BodyProtect = { garmentOnly: false, bodyRef: false, bodyCheck: false };
export const PROTECT_LABELS: Record<keyof BodyProtect, { label: string; description: string }> = {
  bodyRef: {
    label: 'Use Sienna’s body references',
    description: 'Shows the editor her approved body photos and tells it to keep her proportions.',
  },
  garmentOnly: {
    label: 'Clothing only',
    description: 'Removes the clothing model’s skin, figure and feet from the photo (falls back to the chin crop if a piece is missed).',
  },
  bodyCheck: {
    label: 'Check her body afterwards',
    description: 'Compares her proportions before and after; warns only where pose, angle and clothing allow a fair comparison.',
  },
};
export const PERSON_SEGM_FILE = 'segm/person_yolov8m-seg.pt';
const DWPOSE_FILES = { bbox_detector: 'yolox_l.onnx', pose_estimator: 'dw-ll_ucoco_384.onnx' };
/** Extra node classes each option needs on the GPU server. */
export const PROTECT_NODES: Record<keyof BodyProtect, string[]> = {
  garmentOnly: ['SiennaGarmentOnly', 'DWPreprocessor', 'SegmDetectorCombined_v2'],
  bodyRef: ['SiennaBodySheet'],
  bodyCheck: ['SiennaBodyMeasure', 'SiennaBodyCheck', 'DWPreprocessor', 'SegmDetectorCombined_v2'],
};

const UPPER_RE = /\b(top|bra|bralette|bandeau|halter|shirt|blouse|tee|t-shirt|tank|camisole|cami|sweater|jumper|hoodie|cardigan|jacket|blazer|corset|bustier|vest)\b/i;
const LOWER_RE = /\b(bottoms?|briefs|skirt|trousers|pants|jeans|shorts|leggings|culottes)\b/i;
const WHOLE_RE = /\b(bikini|two-piece|one-piece|swimsuit|swim ?suit|monokini|dress|gown|jumpsuit|romper|playsuit|bodysuit|catsuit|overalls)\b/i;
/** Which garment pieces the clothing photo must contain (the isolation step checks each one is found). */
export function expectedPieces(scope: OutfitEditScope, description: string): ('upper' | 'lower')[] {
  if (scope === 'top') return ['upper'];
  if (scope === 'bottom') return ['lower'];
  const d = description;
  const up = UPPER_RE.test(d) || WHOLE_RE.test(d);
  const low = LOWER_RE.test(d) || WHOLE_RE.test(d);
  return up || low ? [...(up ? ['upper' as const] : []), ...(low ? ['lower' as const] : [])] : ['upper', 'lower'];
}
/** A skirt or dress hides the legs, so leg lengths can't be compared. */
export function legsHidden(...texts: string[]): boolean {
  return /\b(skirt|dress|gown|kaftan|caftan|sarong|robe|coat|maxi)\b/i.test(texts.join(' '));
}

export const SWIMWEAR_RE = /\b(bikini|swimsuit|swim ?suit|swimwear|one-piece|monokini|bathing suit|tankini)\b/i;

export const MAX_DESCRIPTION = 600;

/** Garment-only redraw: how far beyond the old garment the new one may reach (SiennaGarmentRedrawMask). */
export type RedrawGrow = 'garment' | 'torso' | 'legs' | 'body';
export const REDRAW_NODES = ['SiennaGarmentRedrawMask', 'SetLatentNoiseMask', 'ImageCompositeMasked', 'DWPreprocessor', 'SegmDetectorCombined_v2'];
const COVERS_LEGS_RE = /\b(dress|gown|jumpsuit|romper|playsuit|overalls|trousers|pants|jeans|leggings|skirt|shorts|culottes|maxi|robe|coat|kaftan|sarong)\b/i;
const COVERS_TORSO_RE = /\b(one-piece|swimsuit|swim ?suit|monokini|bodysuit|catsuit|leotard|shirt|blouse|tee|t-shirt|tank|camisole|cami|sweater|jumper|hoodie|cardigan|jacket|blazer|corset|bustier|vest|crop top|tube top)\b/i;
/**
 * How much room the new garment needs. A bikini needs only the old garment's area (plus strings); a one-piece or a
 * shirt may cover the midriff; a skirt, trousers or a dress cover the legs.
 */
export function redrawGrow(scope: OutfitEditScope, description: string): RedrawGrow {
  const legs = COVERS_LEGS_RE.test(description);
  const torso = COVERS_TORSO_RE.test(description) && !/\bbikini\b/i.test(description);
  if (scope === 'top') return torso ? 'torso' : 'garment';
  if (scope === 'bottom') return legs ? 'legs' : 'garment';
  return legs ? 'body' : torso ? 'torso' : 'garment';
}

const REDRAW_TEXT =
  'The flat grey area in image 1 is where her old outfit was. Draw the new outfit there, and her natural skin, matching the skin around it, ' +
  'wherever the new outfit leaves her uncovered; no grey may remain. Do not change anything outside the grey area. ';

export interface EditPromptInput {
  scope: OutfitEditScope;
  /** What she should wear (for top/bottom: only that piece). Must match the clothing photo. */
  description: string;
  /** What she wears in the source image (the record's outfit text), so it can be named for removal. */
  originalOutfit: string;
  footwear: OutfitEditFootwear;
  protect?: BodyProtect;
  /** Garment-only redraw: image 1 shows the old garment greyed out. */
  redraw?: boolean;
}

const NOCOPY =
  'Image 2 is only a clothing reference: do not copy the body shape, figure, proportions, height or skin tone of the person in image 2. ';
// Body references share image 2 with the clothing (left: clothing, right: her body cut out). As a third image, or cut
// out on flat grey, they made the editor replace her room with a grey studio (GPU comparison), so the cut-outs sit on a
// blurred copy of her own scene.
const BODYREF =
  'Image 2 has two parts. The left part shows the clothing to dress her in; do not copy the body, figure, proportions or skin tone of anyone wearing it. ' +
  'The right part shows approved photos of the same woman as image 1, cut out over a blurred copy of image 1’s room: her real body. Her body (shoulders, bust, waist, hips, ' +
  'thighs, legs and overall build) must stay exactly as in image 1 and in the right part of image 2. Take only the clothing from the left part, and ' +
  'nothing else from image 2: the background, lighting, framing and pose come from image 1. ';
const protectText = (p?: BodyProtect) => (p?.bodyRef ? BODYREF : p?.garmentOnly ? NOCOPY : '');

// Release check: on a photo cropped at the hips, footwear wording made Qwen zoom out to show her feet, which changed
// framing, pose and background. The frame of image 1 is fixed; footwear only applies where her feet are visible.
const FRAME = 'Keep the exact camera framing, crop and zoom of image 1: do not zoom out and do not show any part of her that is outside the frame of image 1. ';
const KEEP =
  FRAME +
  'Keep her face, hair, skin, body shape and proportions (same leg length and limb thickness), pose, expression, ' +
  'background, framing and lighting from image 1 unchanged.';

const clean = (s: string) => s.replace(/\s+/g, ' ').trim().replace(/[.;,\s]+$/, '');

/** Footwear default: barefoot for a whole-outfit swim edit, otherwise keep what she has on. */
export function defaultFootwear(scope: OutfitEditScope, description: string): OutfitEditFootwear {
  return scope === 'full' && SWIMWEAR_RE.test(description) ? 'barefoot' : 'keep';
}

/**
 * "No beige fabric, no wide cups" sentences in a description. Text encoders read "no X" as X, so these move to the
 * negative prompt (live case: "no wide bikini cups" in the positive prompt, wide cups in the result).
 */
export function splitNegations(description: string): { positive: string; avoid: string[] } {
  const keep: string[] = [];
  const avoid: string[] = [];
  for (const sentence of clean(description).split(/(?<=[.;])\s+/)) {
    if (/^\s*(no|without)\b/i.test(sentence)) {
      for (const part of sentence.replace(/[.;]+$/, '').split(/,|\band\b/i)) {
        const item = part.replace(/^\s*(no|without|nor)\s+/i, '').trim();
        if (item) avoid.push(item);
      }
    } else keep.push(sentence);
  }
  return { positive: keep.join(' ').trim() || clean(description), avoid };
}

/** Negative prompt for the editor: what the description says to avoid. */
export function buildEditNegative(description: string, avoid = ''): string {
  const items = [...splitAvoid(avoid), ...splitNegations(description).avoid];
  return [...new Set(items.map((x) => x.toLowerCase()))].join(', ');
}

/** The Avoid box: comma/line separated things the image should not have ("no " prefixes are dropped). */
export function splitAvoid(avoid: string): string[] {
  return avoid
    .split(/[,;\n]+/)
    .map((x) => clean(x).replace(/^(no|without|avoid)\s+/i, ''))
    .filter((x) => x.length > 1)
    .slice(0, 30);
}

const garmentWords = (t: string) =>
  new Set(
    [UPPER_RE, LOWER_RE, WHOLE_RE, SWIMWEAR_RE].flatMap((re) =>
      [...t.toLowerCase().matchAll(new RegExp(re.source, 'gi'))].map((m) => m[0].replace(/s$/, '').replace(/\s/g, '')),
    ),
  );
/**
 * The source's outfit text, if it is safe to name for removal. It is what was *asked for* when the image was made,
 * not necessarily what is in it; when it names the same kind of garment as the new description (live case: a micro
 * bikini asked for, a full-cup bikini generated), "remove the micro bikini, she now wears a micro bikini" told Qwen to
 * keep what is there. Long texts are skipped too.
 */
export function namedOriginal(originalOutfit: string, description: string): string {
  const o = clean(originalOutfit);
  if (!o || o.length > 160) return '';
  const now = garmentWords(description);
  if ([...garmentWords(o)].some((w) => now.has(w))) return '';
  return o;
}

/**
 * The instruction sent to Qwen-Image-Edit. The 'full' wording is the one validated in the second GPU
 * test (old outfit named for removal, piece-by-piece match, nothing added).
 */
export function buildEditPrompt({ scope, description, originalOutfit, footwear, protect, redraw }: EditPromptInput): string {
  const desc = splitNegations(description).positive;
  const named = namedOriginal(originalOutfit, desc);
  const swim = SWIMWEAR_RE.test(desc);
  const ignoreRefShoes = footwear === 'reference' ? '' : ' Ignore any shoes or sandals shown in image 2.';
  // Live case: a white micro bikini photo + "black micro bikini" text came out as her old full-cup bikini recoloured.
  const textWins = ' Where this description differs from image 2 (for example the colour), follow the description.';

  if (scope === 'full') {
    const what = named ? `clothing${footwear === 'keep' ? '' : ' and footwear'} (${named})` : `clothing${footwear === 'keep' ? '' : ' and footwear'}`;
    const removeWhat = footwear === 'keep' ? `${what}, but not her footwear` : what;
    const feet = footwear === 'barefoot' ? (swim ? ', with bare legs' : ', and she is barefoot') : footwear === 'reference' ? ', with the footwear shown in image 2' : '';
    // GPU comparison: one barefoot swim edit in 16 kept her sneakers, so say it outright
    const keepShoes =
      footwear === 'keep'
        ? ' Keep her footwear from image 1 exactly as it is, if it is in the picture.'
        : footwear === 'barefoot'
          ? ' If her feet are in the picture, they are bare: no shoes or socks.'
          : '';
    return (
      `Replace the woman's entire outfit in image 1 with the outfit shown in image 2. Completely remove all of her original ${removeWhat}; ` +
      `none of it may remain. She now wears only ${desc}${feet}.${textWins} Copy the garment design in image 2 exactly: number of pieces, ` +
      'construction of the top and of the bottom, cup size and shape, strap width and placement, ties, neckline, cut, leg line, fit and how much skin is covered. ' +
      'Do not reuse or recolour the garment she wears in image 1: its shape, cup size, strap width and coverage must change to match image 2. ' +
      `Do not add any other clothing.${keepShoes}${ignoreRefShoes} ${redraw ? REDRAW_TEXT : ''}${protectText(protect)}${KEEP}`
    );
  }

  const piece = scope === 'top' ? 'top (her upper-body garment)' : 'bottom (her lower-body garment: trousers, skirt, shorts or bikini bottoms)';
  const other = scope === 'top' ? 'lower-body clothing' : 'top';
  const what = scope === 'top' ? 'top' : 'bottom';
  const feet =
    footwear === 'barefoot'
      ? ' If her feet are in the picture, she is barefoot.'
      : footwear === 'reference'
        ? ' If her feet are in the picture, she wears the footwear shown in image 2.'
        : ' Keep her footwear from image 1 exactly as it is, if it is in the picture.';
  return (
    `Replace only the ${piece} of the woman in image 1 with the ${what} shown in image 2: ${desc}.${textWins} ` +
    `Remove her original ${what} completely; none of it may remain.${named ? ` In image 1 she wears ${named}.` : ''} ` +
    `Keep her ${other} from image 1 exactly as it is.${feet} ` +
    `Copy the ${what} in image 2 exactly: construction, cup size and shape, strap width and placement, ties, neckline, cut, length, leg line, fit and how much skin is covered. ` +
    `Do not reuse or recolour her old ${what}. Ignore every other garment shown in image 2 and do not add any other clothing.${ignoreRefShoes} ${redraw ? REDRAW_TEXT : ''}${protectText(protect)}${KEEP}`
  );
}

/** The outfit text stored on the new record (used as "what she wears" for a later edit). */
export function resultOutfitText(scope: OutfitEditScope, description: string, originalOutfit: string): string {
  const d = clean(description);
  const o = clean(originalOutfit);
  if (scope === 'full' || !o) return d;
  return scope === 'top' ? `${d} (top), with the rest of the earlier outfit: ${o}` : `${d} (bottom), with the rest of the earlier outfit: ${o}`;
}

/**
 * Working size for the edit: about 1 megapixel with the SOURCE's exact aspect ratio (multiples of 16).
 * The first tests used ComfyUI's Kontext size list, which turned 832×1216 into 832×1248 — a 2.6 %
 * vertical stretch that adds to Qwen's tendency to lengthen legs. The result is scaled back to the
 * source size afterwards.
 */
export function editSize(width: number, height: number): { width: number; height: number } {
  const w0 = Math.max(64, width || 832);
  const h0 = Math.max(64, height || 1216);
  const mp = (w0 * h0) / 1e6;
  const k = mp >= 0.75 && mp <= 1.3 ? 1 : Math.sqrt(1.0 / mp);
  const r16 = (n: number) => Math.max(256, Math.round((n * k) / 16) * 16);
  return { width: r16(w0), height: r16(h0) };
}

/** Node ids in the edit graph that the server reads back. */
export const EDIT_NODES = { final: 'save_final', crop: 'save_crop', cropInfo: 'ref_crop', bodyCheck: 'body_check', redrawInfo: 'redraw_mask', redrawPreview: 'save_redraw' } as const;

export interface FaceRestoreSpec {
  denoise: number;
  checkpoint: string;
  lora: { name: string; strength: number; clipStrength: number } | null;
  positive: string;
  negative: string;
  /** Static FaceDetailer inputs copied from the production workflow (guide size, sampler, SAM…). */
  detailerInputs: Record<string, unknown>;
}

export interface EditGraphInput {
  sourceName: string;
  sourceSize: { width: number; height: number };
  referenceName: string;
  /** false when the clothing photo was already cropped by hand in the editor. */
  autoCrop: boolean;
  prompt: string;
  /** What to avoid (from "no …" sentences in the description); empty = the validated graph. */
  negativePrompt?: string;
  /** Garment-only redraw: only the clothing region of the source is sampled and pasted back. */
  redraw?: { scope: OutfitEditScope; grow: RedrawGrow; includeFeet: boolean };
  seed: number;
  faceRestore: FaceRestoreSpec | null;
  /** Experimental body protection (all off = the graph validated on the GPU). */
  protect?: BodyProtect;
  /** Uploaded names of Sienna's approved body references (used by bodyRef and bodyCheck). */
  bodyRefNames?: string[];
  /** Garment pieces the isolation step must find, e.g. ['upper', 'lower']. */
  expect?: ('upper' | 'lower')[];
  /** Footwear isn't taken from the photo: drop the photo's shoes in the isolation step. */
  dropFeet?: boolean;
  footwearChanged?: boolean;
  legsHidden?: boolean;
}

export function buildOutfitEditGraph(i: EditGraphInput): ComfyGraph {
  const work = editSize(i.sourceSize.width, i.sourceSize.height);
  const g: ComfyGraph = {
    src: { class_type: 'LoadImage', inputs: { image: i.sourceName }, _meta: { title: 'Source image' } },
    src_scale: {
      class_type: 'ImageScale',
      inputs: { image: ['src', 0], upscale_method: 'lanczos', width: work.width, height: work.height, crop: 'disabled' },
      _meta: { title: 'Working size (same aspect)' },
    },
    ref: { class_type: 'LoadImage', inputs: { image: i.referenceName }, _meta: { title: 'Clothing photo' } },
    q_unet: { class_type: 'UNETLoader', inputs: { unet_name: QWEN_EDIT_FILES.unet, weight_dtype: 'default' } },
    q_clip: { class_type: 'CLIPLoader', inputs: { clip_name: QWEN_EDIT_FILES.clip, type: 'qwen_image', device: 'default' } },
    q_vae: { class_type: 'VAELoader', inputs: { vae_name: QWEN_EDIT_FILES.vae } },
  };
  const pr = i.protect ?? NO_PROTECT;
  const refs = pr.bodyRef || pr.bodyCheck ? (i.bodyRefNames ?? []).slice(0, 4) : [];
  // Shared detectors (each only added when something uses it).
  const faceDet = (): [string, number] => {
    g.ref_face_det ??= { class_type: 'UltralyticsDetectorProvider', inputs: { model_name: FACE_DETECTOR_FILE } };
    return ['ref_face_det', 0];
  };
  const faceOf = (id: string, img: [string, number]): [string, number] => {
    g[`${id}_face`] ??= { class_type: 'BboxDetectorCombined_v2', inputs: { bbox_detector: faceDet(), image: img, threshold: 0.3, dilation: 0 } };
    return [`${id}_face`, 0];
  };
  const personOf = (id: string, img: [string, number]): [string, number] => {
    g.person_det ??= { class_type: 'UltralyticsDetectorProvider', inputs: { model_name: PERSON_SEGM_FILE } };
    g[`${id}_person`] ??= { class_type: 'SegmDetectorCombined_v2', inputs: { segm_detector: ['person_det', 1], image: img, threshold: 0.4, dilation: 0 } };
    return [`${id}_person`, 0];
  };
  const poseOf = (id: string, img: [string, number]): [string, number] => {
    g[`${id}_pose`] ??= {
      class_type: 'DWPreprocessor',
      inputs: { image: img, detect_hand: 'disable', detect_body: 'enable', detect_face: 'disable', resolution: 1024, ...DWPOSE_FILES, scale_stick_for_xinsr_cn: 'disable' },
    };
    return [`${id}_pose`, 1];
  };
  refs.forEach((name, k) => (g[`body_ref_${k + 1}`] = { class_type: 'LoadImage', inputs: { image: name }, _meta: { title: `Sienna body reference ${k + 1}` } }));

  let refOut: [string, number] = ['ref', 0];
  if (i.autoCrop) {
    g.ref_crop = pr.garmentOnly
      ? {
          class_type: 'SiennaGarmentOnly',
          inputs: {
            image: ['ref', 0],
            person_mask: personOf('ref', ['ref', 0]),
            expect: (i.expect ?? ['upper', 'lower']).join(','),
            drop_feet: !!i.dropFeet,
            face_mask: faceOf('ref', ['ref', 0]),
            pose_keypoint: poseOf('ref', ['ref', 0]),
          },
          _meta: { title: 'Clothing only (model’s body removed; falls back to the chin crop)' },
        }
      : {
          class_type: 'SiennaChinCrop',
          inputs: { image: ['ref', 0], face_mask: faceOf('ref', ['ref', 0]), margin: 0.08, min_keep: 0.35 },
          _meta: { title: 'Crop clothing photo below the chin' },
        };
    g.save_crop = { class_type: 'SaveImage', inputs: { images: ['ref_crop', 0], filename_prefix: 'sienna/outfit-ref' } };
    refOut = ['ref_crop', 0];
  }
  if (pr.bodyRef && refs.length) {
    // image 2 = [clothing | her body cut out ×3, on her own blurred scene]
    const sheetRefs = refs.slice(0, 3);
    g.body_sheet = {
      class_type: 'SiennaBodySheet',
      inputs: {
        height: 768,
        image1: refOut,
        ...Object.fromEntries(sheetRefs.map((_, k) => [`image${k + 2}`, [`body_ref_${k + 1}`, 0]])),
        ...Object.fromEntries(sheetRefs.map((_, k) => [`mask${k + 2}`, personOf(`bref${k + 1}`, [`body_ref_${k + 1}`, 0])])),
        // cut-outs on a blurred copy of her own scene: on flat grey the editor turned her room into a grey studio
        backdrop: ['src', 0],
        backdrop_mask: personOf('src', ['src', 0]),
      },
      _meta: { title: 'Clothing (left) + Sienna body references (right)' },
    };
    refOut = ['body_sheet', 0];
  }
  Object.assign(g, {
    q_pos: {
      class_type: 'TextEncodeQwenImageEditPlus',
      inputs: { clip: ['q_clip', 0], vae: ['q_vae', 0], image1: ['src_scale', 0], image2: refOut, prompt: i.prompt },
    },
    q_neg: {
      class_type: 'TextEncodeQwenImageEditPlus',
      inputs: { clip: ['q_clip', 0], vae: ['q_vae', 0], image1: ['src_scale', 0], image2: refOut, prompt: i.negativePrompt ?? '' },
    },
    q_shift: { class_type: 'ModelSamplingAuraFlow', inputs: { model: ['q_unet', 0], shift: QWEN_SAMPLING.shift } },
    q_cfgnorm: { class_type: 'CFGNorm', inputs: { model: ['q_shift', 0], strength: 1 } },
    q_latent: { class_type: 'VAEEncode', inputs: { pixels: ['src_scale', 0], vae: ['q_vae', 0] } },
    q_sample: {
      class_type: 'KSampler',
      inputs: {
        model: ['q_cfgnorm', 0],
        positive: ['q_pos', 0],
        negative: ['q_neg', 0],
        latent_image: ['q_latent', 0],
        seed: i.seed,
        steps: QWEN_SAMPLING.steps,
        cfg: QWEN_SAMPLING.cfg,
        sampler_name: QWEN_SAMPLING.sampler,
        scheduler: QWEN_SAMPLING.scheduler,
        denoise: 1,
      },
    },
    q_decode: { class_type: 'VAEDecode', inputs: { samples: ['q_sample', 0], vae: ['q_vae', 0] } },
    q_resize: {
      class_type: 'ImageScale',
      inputs: { image: ['q_decode', 0], upscale_method: 'lanczos', width: i.sourceSize.width, height: i.sourceSize.height, crop: 'disabled' },
      _meta: { title: 'Back to the source size' },
    },
  } satisfies ComfyGraph);
  if (i.redraw) {
    // Garment-only redraw: the editor sees the old garment greyed out, samples only the clothing region, and the
    // result is pasted back over the untouched source with a feathered edge.
    const s: [string, number] = ['src_scale', 0];
    g.redraw_mask = {
      class_type: 'SiennaGarmentRedrawMask',
      inputs: {
        image: s,
        scope: i.redraw.scope,
        grow: i.redraw.grow,
        include_feet: i.redraw.includeFeet,
        person_mask: personOf('srcw', s),
        face_mask: faceOf('srcw', s),
        pose_keypoint: poseOf('srcw', s),
      },
      _meta: { title: 'Clothing region to redraw (old garment greyed out)' },
    };
    g.q_pos.inputs.image1 = ['redraw_mask', 2];
    g.q_neg.inputs.image1 = ['redraw_mask', 2];
    g.q_masked = { class_type: 'SetLatentNoiseMask', inputs: { samples: ['q_latent', 0], mask: ['redraw_mask', 0] } };
    g.q_sample.inputs.latent_image = ['q_masked', 0];
    g.q_comp = {
      class_type: 'ImageCompositeMasked',
      inputs: { destination: s, source: ['q_decode', 0], x: 0, y: 0, resize_source: false, mask: ['redraw_mask', 1] },
      _meta: { title: 'Paste the redrawn clothing region onto the untouched source' },
    };
    g.q_resize.inputs.image = ['q_comp', 0];
    g.save_redraw = { class_type: 'SaveImage', inputs: { images: ['redraw_mask', 3], filename_prefix: 'sienna/outfit-redraw' } };
  }
  let finalOut: [string, number] = ['q_resize', 0];
  const fr = i.faceRestore;
  if (fr) {
    const modelSrc: [string, number] = fr.lora ? ['fr_lora', 0] : ['fr_ckpt', 0];
    const clipSrc: [string, number] = fr.lora ? ['fr_lora', 1] : ['fr_ckpt', 1];
    g.fr_ckpt = { class_type: 'CheckpointLoaderSimple', inputs: { ckpt_name: fr.checkpoint } };
    if (fr.lora) {
      g.fr_lora = {
        class_type: 'LoraLoader',
        inputs: { model: ['fr_ckpt', 0], clip: ['fr_ckpt', 1], lora_name: fr.lora.name, strength_model: fr.lora.strength, strength_clip: fr.lora.clipStrength },
      };
    }
    g.fr_pos = { class_type: 'CLIPTextEncode', inputs: { text: fr.positive, clip: clipSrc } };
    g.fr_neg = { class_type: 'CLIPTextEncode', inputs: { text: fr.negative, clip: clipSrc } };
    g.fr_det = { class_type: 'UltralyticsDetectorProvider', inputs: { model_name: FACE_DETECTOR_FILE } };
    g.fr_detail = {
      class_type: 'FaceDetailer',
      inputs: {
        ...fr.detailerInputs,
        image: ['q_resize', 0],
        model: modelSrc,
        clip: clipSrc,
        vae: ['fr_ckpt', 2],
        positive: ['fr_pos', 0],
        negative: ['fr_neg', 0],
        bbox_detector: ['fr_det', 0],
        seed: i.seed,
        denoise: fr.denoise,
      },
      _meta: { title: 'Sienna FaceDetailer' },
    };
    finalOut = ['fr_detail', 0];
  }
  g.save_final = { class_type: 'SaveImage', inputs: { images: finalOut, filename_prefix: 'sienna/outfit-edit' } };
  if (pr.bodyCheck) {
    const measure = (id: string, img: [string, number]): [string, number] => {
      g[`m_${id}`] = {
        class_type: 'SiennaBodyMeasure',
        inputs: { image: img, pose_keypoint: poseOf(id, img), person_mask: personOf(id, img), face_mask: faceOf(id, img) },
      };
      return [`m_${id}`, 0];
    };
    g.body_check = {
      class_type: 'SiennaBodyCheck',
      inputs: {
        source: measure('src', ['src', 0]),
        result: measure('res', finalOut),
        footwear_changed: !!i.footwearChanged,
        legs_hidden: !!i.legsHidden,
        source_image: ['src', 0],
        result_image: finalOut,
        ...Object.fromEntries(refs.map((_, k) => [`ref${k + 1}`, measure(`bref${k + 1}`, [`body_ref_${k + 1}`, 0])])),
      },
      _meta: { title: 'Body consistency check' },
    };
  }
  return g;
}

/** Parse the SiennaChinCrop info string ({"mode","cut"}). */
export function parseCropInfo(text: string | undefined): { mode: 'cropped' | 'no-face' | 'face-too-low'; cut: number } | null {
  if (!text) return null;
  try {
    const j = JSON.parse(text);
    if (['cropped', 'no-face', 'face-too-low'].includes(j.mode)) return { mode: j.mode, cut: Number(j.cut) || 0 };
  } catch {}
  return null;
}

export const CROP_NOTES: Record<string, string> = {
  'no-face': 'No face was found in the clothing photo, so it was used uncropped.',
  'face-too-low': 'The face in the clothing photo is too low for a below-the-chin crop, so it was used uncropped — crop it by hand if the result copies that person.',
};

// ── Body check report ────────────────────────────────────────────────────────

export interface BodyCheckItem {
  part: string;
  change: number;
  basis: string;
  tol: number;
  severity?: 'likely' | 'possible';
  range?: [number, number];
  value?: number;
}
export interface BodyCheckReport {
  status: 'ok' | 'warn' | 'insufficient';
  flags: BodyCheckItem[];
  checked: BodyCheckItem[];
  skipped: { part: string; why: string }[];
  scene?: { diff: number; changed: boolean };
}

export function parseBodyReport(text: string | undefined): BodyCheckReport | null {
  if (!text) return null;
  try {
    const j = JSON.parse(text);
    if (['ok', 'warn', 'insufficient'].includes(j.status) && Array.isArray(j.flags)) return j as BodyCheckReport;
  } catch {}
  return null;
}

const pct = (x: number) => `${x > 0 ? '+' : '−'}${Math.round(Math.abs(x) * 100)}%`;
/** Plain-language warnings for the result page (nothing for 'ok' / 'insufficient'). */
export function bodyCheckWarnings(r: BodyCheckReport | null): string[] {
  if (!r) return [];
  const out: string[] = [];
  if (r.scene?.changed) out.push('The editor replaced the whole scene (the background changed a lot) — this edit probably failed. Try 🎲 New seed.');
  if (r.flags.length) {
    const items = r.flags.map(
      (f) => `${f.severity === 'likely' ? 'likely' : 'possibly'} ${f.part} ${pct(f.change)} (${f.basis === 'source' ? 'vs the original' : `outside the range of her ${f.basis}`})`,
    );
    out.push(`Body check: Sienna’s proportions may have changed — ${items.join('; ')}.`);
  }
  return out;
}

export interface RedrawInfo {
  source: 'segmenter' | 'pose';
  grow: RedrawGrow;
  mask: number;
  oldGarment: number;
  uncovered: number;
  empty: boolean;
}
/** The redraw-mask report from the GPU (SiennaGarmentRedrawMask). */
export function parseRedrawInfo(text: string | undefined): RedrawInfo | null {
  if (!text) return null;
  try {
    const j = JSON.parse(text);
    return { source: j.source === 'pose' ? 'pose' : 'segmenter', grow: j.grow, mask: Number(j.mask) || 0, oldGarment: Number(j.old_garment) || 0, uncovered: Number(j.uncovered) || 0, empty: !!j.empty };
  } catch {
    return null;
  }
}

/** Plain-language notes about a garment-only redraw. */
export function redrawWarnings(r: RedrawInfo | null): string[] {
  if (!r) return [];
  const w: string[] = [];
  if (r.source === 'pose') w.push('Clothing detector not installed on the GPU — the redraw area was estimated from her pose; check the edges.');
  if (r.empty) w.push('No clothing was found in the image — the redraw used body zones; check the result.');
  else if (r.uncovered > 0.03) w.push(`About ${Math.round(r.uncovered * 100)}% of the old garment was outside the redraw area — look for leftover fabric.`);
  return w;
}
