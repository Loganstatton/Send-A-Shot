/**
 * Targeted figure pass (test requests only). A figure LoRA on the whole photo gave the fuller shape but also changed
 * the leggings' colour, her skin, the background and her hip width (23 Oct). Here the photo is made as usual; then
 * only her hip/butt region (SiennaFigureMask, from DWPose and the person outline) is resampled with the figure LoRA
 * and the figure wording, its skin and clothes colours are matched back to the original, and it is pasted in with a
 * feathered edge (SiennaFigureComposite) — face, outfit elsewhere and background stay pixel-identical. Runs after the
 * face and hand passes, before the photo checks, so the exposure, face and AI checks see the final image.
 */
import type { ComfyGraph } from '../types';

export const FIGURE_NODES = {
  pose: 'sienna_fig_pose',
  segm: 'sienna_fig_segm',
  person: 'sienna_fig_person',
  mask: 'sienna_fig_mask',
  lora: 'sienna_fig_lora',
  positive: 'sienna_fig_positive',
  negative: 'sienna_fig_negative',
  encode: 'sienna_fig_encode',
  noiseMask: 'sienna_fig_noise_mask',
  sampler: 'sienna_fig_sampler',
  decode: 'sienna_fig_decode',
  composite: 'sienna_fig_composite',
} as const;

export const FIGURE_PASS_CLASSES = ['DWPreprocessor', 'UltralyticsDetectorProvider', 'SegmDetectorCombined_v2', 'SiennaFigureMask', 'SiennaFigureComposite'];
export const FIGURE_SEGM_MODEL = 'segm/person_yolov8m-seg.pt';
/** Added to the redraw's prompt only (the main photo keeps her usual wording). The gluteal fold — the crease where
 * the fuller cheeks rest over the backs of her thighs — is what makes the shape read as real (23 Oct, asked for). */
export const FIGURE_WORDS = '(full round butt, round lifted glutes:1.15), (defined gluteal fold, natural crease where her buttocks meet the backs of her thighs:1.1)';
/** Added to the redraw's negative only: the figure LoRA's fitness-wear look drew gathered "scrunch" seams on shorts,
 * leggings and a bodycon dress (Stage B, 23 Oct). */
export const FIGURE_NEGATIVE_WORDS = '(scrunch butt, ruched fabric, gathered fabric, seam down the middle of the butt:1.2)';
/** Test style "fuller" (23 Oct, from the owner's reference photo): a round bubble butt, fullest at the lower cheeks
 * (a "heart" shape), with strong projection; the lower cheeks rest over the backs of the thighs with a deep curved
 * crease under each — firm, not sagging. */
export const FIGURE_STYLES = {
  fuller: {
    words: '(very full round bubble butt, heart-shaped, fullest at the lower cheeks, strong projection:1.25), (lower buttocks resting over the backs of her thighs, deep curved underbutt crease under each cheek:1.2), smooth firm skin',
    negative: '(cellulite, saggy buttocks, lumpy fat rolls, dimpled skin:1.2)',
    grow: 0.12,
  },
} as const;
export type FigureStyle = keyof typeof FIGURE_STYLES;

export interface FigurePassOptions {
  file: string;
  strength: number;
  denoise: number;
  /** the LoRA chain node to branch from (Sienna's LoRA plus any clothing packs), so the outfit draws the same */
  baseLoraId: string;
  /** the face pass's node: its sampler settings, VAE and negative conditioning are reused */
  faceRefineId: string;
  /** how far past her outline (x torso) the region reaches sideways, so a fuller curve can change the outline */
  grow?: number;
  /** test style: stronger wording and more room past her outline */
  style?: FigureStyle;
  /** reshape her butt bigger before the redraw (SiennaFigureMask "enlarge"; 0.20 = "medium", 23 Oct): the redraw
   * alone kept her outline (hip width +0%) and the change didn't show at normal size */
  enlarge?: number;
}

/** How far past her outline the region reaches when the photo is reshaped: the reshaping moves pixels up to ~0.2 x
 * torso beyond her old outline (the curve and the background next to it), and all of that is redrawn. */
export const ENLARGE_GROW = 0.2;

/** The graph with the pass spliced in front of the SaveImage node, or null when there is nothing to copy from. */
export function addFigurePass(graph: ComfyGraph, o: FigurePassOptions): ComfyGraph | null {
  const saveId = Object.keys(graph).find((id) => graph[id].class_type === 'SaveImage');
  const face = graph[o.faceRefineId];
  const base = graph[o.baseLoraId];
  if (!saveId || !face || !base) return null;
  const image = graph[saveId].inputs.images;
  const posRef = face.inputs.positive;
  if (!Array.isArray(image) || !Array.isArray(posRef)) return null;
  const posText = graph[posRef[0] as string]?.inputs?.text;
  const negRef = face.inputs.negative;
  const negText = Array.isArray(negRef) ? graph[negRef[0] as string]?.inputs?.text : undefined;
  if (typeof posText !== 'string') return null;
  const n = FIGURE_NODES;
  const enlarge = o.enlarge && o.enlarge > 0 ? o.enlarge : 0;
  // reshaped photo (output 3 of the region node) when enlarging: it is what gets redrawn and pasted into
  const pixels = enlarge ? [n.mask, 3] : image;
  return {
    ...graph,
    [n.pose]: {
      class_type: 'DWPreprocessor',
      inputs: { image, detect_hand: 'disable', detect_body: 'enable', detect_face: 'disable', resolution: 512, bbox_detector: 'yolox_l.onnx', pose_estimator: 'dw-ll_ucoco_384.onnx', scale_stick_for_xinsr_cn: 'disable' },
      _meta: { title: 'Figure pass: pose' },
    },
    [n.segm]: { class_type: 'UltralyticsDetectorProvider', inputs: { model_name: FIGURE_SEGM_MODEL }, _meta: { title: 'Figure pass: person model' } },
    [n.person]: { class_type: 'SegmDetectorCombined_v2', inputs: { segm_detector: [n.segm, 1], image, threshold: 0.4, dilation: 0 }, _meta: { title: 'Figure pass: person' } },
    [n.mask]: {
      class_type: 'SiennaFigureMask',
      inputs: {
        image,
        pose_keypoint: [n.pose, 1],
        grow: o.grow ?? (enlarge ? ENLARGE_GROW : o.style ? FIGURE_STYLES[o.style].grow : 0.08),
        person_mask: [n.person, 0],
        ...(enlarge ? { enlarge } : {}),
      },
      _meta: { title: 'Figure pass: hip region' },
    },
    [n.lora]: {
      class_type: 'LoraLoader',
      inputs: { model: [o.baseLoraId, 0], clip: [o.baseLoraId, 1], lora_name: o.file, strength_model: o.strength, strength_clip: o.strength },
      _meta: { title: `Figure pass: ${o.file}` },
    },
    [n.positive]: { class_type: 'CLIPTextEncode', inputs: { clip: [n.lora, 1], text: `${posText}, ${o.style ? FIGURE_STYLES[o.style].words : FIGURE_WORDS}` }, _meta: { title: 'Figure pass: prompt' } },
    ...(typeof negText === 'string'
      ? { [n.negative]: { class_type: 'CLIPTextEncode', inputs: { clip: [n.lora, 1], text: `${negText}, ${FIGURE_NEGATIVE_WORDS}${o.style ? `, ${FIGURE_STYLES[o.style].negative}` : ''}` }, _meta: { title: 'Figure pass: negative' } } }
      : {}),
    [n.encode]: { class_type: 'VAEEncode', inputs: { pixels, vae: face.inputs.vae }, _meta: { title: 'Figure pass: encode' } },
    [n.noiseMask]: { class_type: 'SetLatentNoiseMask', inputs: { samples: [n.encode, 0], mask: [n.mask, 0] }, _meta: { title: 'Figure pass: region only' } },
    [n.sampler]: {
      class_type: 'KSampler',
      inputs: {
        model: [n.lora, 0],
        positive: [n.positive, 0],
        negative: typeof negText === 'string' ? [n.negative, 0] : face.inputs.negative,
        latent_image: [n.noiseMask, 0],
        seed: face.inputs.seed,
        steps: Math.max(20, Number(face.inputs.steps) || 20),
        cfg: face.inputs.cfg,
        sampler_name: face.inputs.sampler_name,
        scheduler: face.inputs.scheduler,
        denoise: o.denoise,
      },
      _meta: { title: 'Figure pass: redraw' },
    },
    [n.decode]: { class_type: 'VAEDecode', inputs: { samples: [n.sampler, 0], vae: face.inputs.vae }, _meta: { title: 'Figure pass: decode' } },
    [n.composite]: {
      class_type: 'SiennaFigureComposite',
      inputs: { original: pixels, redrawn: [n.decode, 0], mask: [n.mask, 0], soft_mask: [n.mask, 1], color_match: 1 },
      _meta: { title: 'Figure pass: colours matched, pasted in' },
    },
    [saveId]: { ...graph[saveId], inputs: { ...graph[saveId].inputs, images: [n.composite, 0] } },
  };
}

export interface FigurePassReport {
  /** false when the region or the paste-back didn't finish (stalled, failed or empty): the photo is left as made */
  completed?: boolean;
  fallback?: string;
  mask?: number;
  skipped?: string;
  colorShift?: Record<string, number[]>;
  hipWidthChange?: number | null;
  /** the reshaping before the redraw: how much wider her outline got at the cheeks, or why it was skipped */
  enlarge?: { amount?: number; hipWidthChange?: number | null; skipped?: string };
}

export function parseFigurePass(texts: Record<string, string[]> | undefined): FigurePassReport | undefined {
  const read = (id: string) => {
    try {
      return JSON.parse(texts?.[id]?.[0] ?? 'null');
    } catch {
      return null;
    }
  };
  const m = read(FIGURE_NODES.mask);
  const c = read(FIGURE_NODES.composite);
  if (!m && !c) return undefined;
  const fallback = c?.fallback ?? m?.fallback;
  return {
    ...(c && typeof c.completed === 'boolean' ? { completed: c.completed } : {}),
    ...(fallback ? { fallback } : {}),
    ...(typeof m?.mask === 'number' ? { mask: m.mask } : {}),
    ...(m?.skipped || c?.skipped ? { skipped: m?.skipped ?? c?.skipped } : {}),
    ...(c?.color_shift ? { colorShift: c.color_shift } : {}),
    ...(c && 'hip_width_change' in c ? { hipWidthChange: c.hip_width_change } : {}),
    ...(m?.enlarge
      ? { enlarge: { amount: m.enlarge.amount, ...('hip_width_change' in m.enlarge ? { hipWidthChange: m.enlarge.hip_width_change } : {}), ...(m.enlarge.skipped ? { skipped: m.enlarge.skipped } : {}) } }
      : {}),
  };
}
