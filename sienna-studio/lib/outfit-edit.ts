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

export const SWIMWEAR_RE = /\b(bikini|swimsuit|swim ?suit|swimwear|one-piece|monokini|bathing suit|tankini)\b/i;

export const MAX_DESCRIPTION = 600;

export interface EditPromptInput {
  scope: OutfitEditScope;
  /** What she should wear (for top/bottom: only that piece). Must match the clothing photo. */
  description: string;
  /** What she wears in the source image (the record's outfit text), so it can be named for removal. */
  originalOutfit: string;
  footwear: OutfitEditFootwear;
}

const KEEP =
  'Keep her face, hair, skin, body shape and proportions (same leg length and limb thickness), pose, expression, ' +
  'background, framing and lighting from image 1 unchanged.';

const clean = (s: string) => s.replace(/\s+/g, ' ').trim().replace(/[.;,\s]+$/, '');

/** Footwear default: barefoot for a whole-outfit swim edit, otherwise keep what she has on. */
export function defaultFootwear(scope: OutfitEditScope, description: string): OutfitEditFootwear {
  return scope === 'full' && SWIMWEAR_RE.test(description) ? 'barefoot' : 'keep';
}

/**
 * The instruction sent to Qwen-Image-Edit. The 'full' wording is the one validated in the second GPU
 * test (old outfit named for removal, piece-by-piece match, nothing added).
 */
export function buildEditPrompt({ scope, description, originalOutfit, footwear }: EditPromptInput): string {
  const desc = clean(description);
  const orig = clean(originalOutfit) || 'her current clothes';
  const swim = SWIMWEAR_RE.test(desc);
  const ignoreRefShoes = footwear === 'reference' ? '' : ' Ignore any shoes or sandals shown in image 2.';

  if (scope === 'full') {
    const removeWhat = footwear === 'keep' ? `clothing (${orig}), but not her footwear` : `clothing and footwear (${orig})`;
    const feet =
      footwear === 'barefoot'
        ? swim
          ? ', with bare legs and bare feet'
          : ', and she is barefoot'
        : footwear === 'reference'
          ? ', with the footwear shown in image 2'
          : '';
    const keepShoes = footwear === 'keep' ? ' Keep her footwear from image 1 exactly as it is.' : '';
    return (
      `Replace the woman's entire outfit in image 1 with the outfit shown in image 2. Completely remove all of her original ${removeWhat}; ` +
      `none of it may remain. She now wears only ${desc}${feet}. Match the garments in image 2 exactly: number of pieces, ` +
      'construction of the top and of the bottom, straps and ties, neckline, cut, leg line, fit, colour and how much skin is covered. ' +
      `Do not add any other clothing.${keepShoes}${ignoreRefShoes} ${KEEP}`
    );
  }

  const piece = scope === 'top' ? 'top (her upper-body garment)' : 'bottom (her lower-body garment: trousers, skirt, shorts or bikini bottoms)';
  const other = scope === 'top' ? 'lower-body clothing' : 'top';
  const what = scope === 'top' ? 'top' : 'bottom';
  const feet =
    footwear === 'barefoot'
      ? ' She is barefoot.'
      : footwear === 'reference'
        ? ' She wears the footwear shown in image 2.'
        : ' Keep her footwear from image 1 exactly as it is.';
  return (
    `Replace only the ${piece} of the woman in image 1 with the ${what} shown in image 2: ${desc}. ` +
    `Remove her original ${what} completely; none of it may remain. In image 1 she wears ${orig}. ` +
    `Keep her ${other} from image 1 exactly as it is.${feet} ` +
    `Match the ${what} in image 2 exactly: construction, straps and ties, neckline, cut, length, leg line, fit, colour and how much skin is covered. ` +
    `Ignore every other garment shown in image 2 and do not add any other clothing.${ignoreRefShoes} ${KEEP}`
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
export const EDIT_NODES = { final: 'save_final', crop: 'save_crop', cropInfo: 'ref_crop' } as const;

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
  seed: number;
  faceRestore: FaceRestoreSpec | null;
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
  let refOut: [string, number] = ['ref', 0];
  if (i.autoCrop) {
    g.ref_face_det = { class_type: 'UltralyticsDetectorProvider', inputs: { model_name: FACE_DETECTOR_FILE } };
    g.ref_face = {
      class_type: 'BboxDetectorCombined_v2',
      inputs: { bbox_detector: ['ref_face_det', 0], image: ['ref', 0], threshold: 0.3, dilation: 0 },
    };
    g.ref_crop = {
      class_type: 'SiennaChinCrop',
      inputs: { image: ['ref', 0], face_mask: ['ref_face', 0], margin: 0.08, min_keep: 0.35 },
      _meta: { title: 'Crop clothing photo below the chin' },
    };
    g.save_crop = { class_type: 'SaveImage', inputs: { images: ['ref_crop', 0], filename_prefix: 'sienna/outfit-ref' } };
    refOut = ['ref_crop', 0];
  }
  Object.assign(g, {
    q_pos: {
      class_type: 'TextEncodeQwenImageEditPlus',
      inputs: { clip: ['q_clip', 0], vae: ['q_vae', 0], image1: ['src_scale', 0], image2: refOut, prompt: i.prompt },
    },
    q_neg: {
      class_type: 'TextEncodeQwenImageEditPlus',
      inputs: { clip: ['q_clip', 0], vae: ['q_vae', 0], image1: ['src_scale', 0], image2: refOut, prompt: '' },
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
