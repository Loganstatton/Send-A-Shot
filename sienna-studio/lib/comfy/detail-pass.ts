/**
 * Close-up detail pass for nude photos (24 Oct, owner's request; personal use — the Real Pussy LoRAs' licences don't
 * allow commercial image use). On a full-body photo the area is ~60-90 px across and the LoRAs changed nothing visible
 * (fig20), so: SiennaDetailRegion finds the exposed genital area (NudeNet) and cuts an enlarged close-up, which is
 * redrawn with the LoRA at SDXL size, then SiennaDetailPaste scales it back and blends it in (soft oval, colours
 * matched). Nothing exposed found → the photo is unchanged. The app adds it to nude / bottomless requests in adult mode
 * only. Runs last, after the figure pass, before the photo checks.
 */
import type { ComfyGraph } from '../types';

export const DETAIL_NODES = {
  region: 'sienna_detail_region',
  lora: 'sienna_detail_lora',
  positive: 'sienna_detail_positive',
  negative: 'sienna_detail_negative',
  encode: 'sienna_detail_encode',
  noiseMask: 'sienna_detail_noise_mask',
  sampler: 'sienna_detail_sampler',
  decode: 'sienna_detail_decode',
  paste: 'sienna_detail_paste',
} as const;

export const DETAIL_PASS_CLASSES = ['SiennaDetailRegion', 'SiennaDetailPaste'];

/** The Real Pussy series (Civitai 99174, 90740, 89005), SDXL versions. Peach has separate front and rear versions;
 * Lotte's maker recommends 0.4-0.6. */
export const DETAIL_STYLES = {
  peach: { label: 'Peach', front: 'pack_99174_front.safetensors', rear: 'pack_99174.safetensors', strength: 0.7, words: '' },
  butterfly: { label: 'Butterfly', front: 'pack_90740.safetensors', rear: 'pack_90740.safetensors', strength: 0.7, words: 'butterfly pussy' },
  lotte: { label: 'Lotte', front: 'pack_89005.safetensors', rear: 'pack_89005.safetensors', strength: 0.5, words: '' },
} as const;
export type DetailStyle = keyof typeof DETAIL_STYLES;

/** pussy_scale3 is the packs' own close-up tag (scale 1 = full body, 3 = close-up for inpainting). */
export const DETAIL_WORDS = 'close-up photo, pussy_scale3, realistic natural vulva, natural labia, detailed natural skin texture, soft natural light';
export const DETAIL_REAR_WORDS = 'from behind, between her thighs';
export const DETAIL_NEGATIVE_WORDS = '(blurry, smooth plastic skin, deformed, malformed anatomy, cartoon, painting:1.2)';
/** GPU check (fig23, 24 Oct, seeds 101 and 303): from the front 0.62 gave clear, natural detail on both and 0.5 a lumpy
 * shape on one; from behind 0.5 looked right on both (0.62 untested there). */
export const DETAIL_DENOISE = { front: 0.62, rear: 0.5 } as const;
export const detailDenoise = (rear: boolean) => (rear ? DETAIL_DENOISE.rear : DETAIL_DENOISE.front);

export function detailPassFromEnv(v: string | undefined): { style: DetailStyle; strength?: number; denoise?: number } | undefined {
  return v && v in DETAIL_STYLES ? { style: v as DetailStyle } : undefined;
}

const NO_BOTTOMS_WORDS_RE = /\b(bottomless|no (bottoms|panties|underwear|thong))\b/gi;
const BOTTOM_GARMENT_RE = /\b(thong|g-string|panties|knickers|briefs|underwear|bottoms?|shorts|skirt|pants|trousers|jeans|leggings|tights|pantyhose|bodysuit|leotard|swimsuit|monokini|one-piece|dress|gown|towel|sheet|blanket)\b/i;

/** Nothing on below the waist: fully nude (nudeOnlyAllowed, passed in), or "bottomless" / "no panties" with no other
 * garment that would cover her there ("nude thong" or "nude-colour shorts" are not bare). */
export function bareBelow(outfit: string, nudeOk: boolean): boolean {
  if (nudeOk) return true;
  if (!new RegExp(NO_BOTTOMS_WORDS_RE.source, 'i').test(outfit)) return false;
  return !BOTTOM_GARMENT_RE.test(outfit.replace(NO_BOTTOMS_WORDS_RE, ''));
}

export interface DetailPassOptions {
  style: DetailStyle;
  /** seen from behind: the rear version of the LoRA (Peach) and rear wording */
  rear: boolean;
  strength?: number;
  denoise?: number;
  /** the LoRA chain node to branch from (Sienna's LoRA plus any packs), so the skin draws the same */
  baseLoraId: string;
  /** the face pass's node: its sampler settings, VAE and negative prompt are reused */
  faceRefineId: string;
}

/** The LoRA file the pass uses for a style and view. */
export function detailFile(style: DetailStyle, rear: boolean): string {
  return rear ? DETAIL_STYLES[style].rear : DETAIL_STYLES[style].front;
}

/** The graph with the pass spliced in front of the SaveImage node, or null when there is nothing to copy from. */
export function addDetailPass(graph: ComfyGraph, o: DetailPassOptions): ComfyGraph | null {
  const saveId = Object.keys(graph).find((id) => graph[id].class_type === 'SaveImage');
  const face = graph[o.faceRefineId];
  if (!saveId || !face || !graph[o.baseLoraId]) return null;
  const image = graph[saveId].inputs.images;
  if (!Array.isArray(image)) return null;
  const negRef = face.inputs.negative;
  const negText = Array.isArray(negRef) ? graph[negRef[0] as string]?.inputs?.text : undefined;
  const s = DETAIL_STYLES[o.style];
  const file = detailFile(o.style, o.rear);
  const strength = o.strength ?? s.strength;
  const n = DETAIL_NODES;
  const words = [o.rear ? DETAIL_REAR_WORDS : '', DETAIL_WORDS, s.words].filter(Boolean).join(', ');
  return {
    ...graph,
    [n.region]: { class_type: 'SiennaDetailRegion', inputs: { image, threshold: 0.3, size: 1024 }, _meta: { title: 'Detail pass: close-up region' } },
    [n.lora]: {
      class_type: 'LoraLoader',
      inputs: { model: [o.baseLoraId, 0], clip: [o.baseLoraId, 1], lora_name: file, strength_model: strength, strength_clip: strength },
      _meta: { title: `Detail pass: ${file}` },
    },
    [n.positive]: { class_type: 'CLIPTextEncode', inputs: { clip: [n.lora, 1], text: words }, _meta: { title: 'Detail pass: prompt' } },
    [n.negative]: {
      class_type: 'CLIPTextEncode',
      inputs: { clip: [n.lora, 1], text: typeof negText === 'string' ? `${negText}, ${DETAIL_NEGATIVE_WORDS}` : DETAIL_NEGATIVE_WORDS },
      _meta: { title: 'Detail pass: negative' },
    },
    [n.encode]: { class_type: 'VAEEncode', inputs: { pixels: [n.region, 0], vae: face.inputs.vae }, _meta: { title: 'Detail pass: encode' } },
    [n.noiseMask]: { class_type: 'SetLatentNoiseMask', inputs: { samples: [n.encode, 0], mask: [n.region, 1] }, _meta: { title: 'Detail pass: area only' } },
    [n.sampler]: {
      class_type: 'KSampler',
      inputs: {
        model: [n.lora, 0],
        positive: [n.positive, 0],
        negative: [n.negative, 0],
        latent_image: [n.noiseMask, 0],
        seed: face.inputs.seed,
        steps: Math.max(24, Number(face.inputs.steps) || 24),
        cfg: face.inputs.cfg,
        sampler_name: face.inputs.sampler_name,
        scheduler: face.inputs.scheduler,
        denoise: o.denoise ?? detailDenoise(o.rear),
      },
      _meta: { title: 'Detail pass: redraw' },
    },
    [n.decode]: { class_type: 'VAEDecode', inputs: { samples: [n.sampler, 0], vae: face.inputs.vae }, _meta: { title: 'Detail pass: decode' } },
    [n.paste]: { class_type: 'SiennaDetailPaste', inputs: { original: image, redrawn: [n.decode, 0], info: [n.region, 2] }, _meta: { title: 'Detail pass: pasted back' } },
    [saveId]: { ...graph[saveId], inputs: { ...graph[saveId].inputs, images: [n.paste, 0] } },
  };
}

export interface DetailPassReport {
  pasted?: boolean;
  skipped?: string;
  score?: number;
  side?: number;
}

/** The paste node's report: pasted (with the detector's score and the close-up's size in the photo) or skipped. */
export function parseDetailPass(texts: Record<string, string[]> | undefined): DetailPassReport | undefined {
  try {
    const r = JSON.parse(texts?.[DETAIL_NODES.paste]?.[0] ?? 'null');
    if (!r) return undefined;
    return r.pasted ? { pasted: true, score: r.score, side: r.side } : { skipped: String(r.skipped ?? 'not pasted') };
  } catch {
    return undefined;
  }
}
