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
  encode: 'sienna_fig_encode',
  noiseMask: 'sienna_fig_noise_mask',
  sampler: 'sienna_fig_sampler',
  decode: 'sienna_fig_decode',
  composite: 'sienna_fig_composite',
} as const;

export const FIGURE_PASS_CLASSES = ['DWPreprocessor', 'UltralyticsDetectorProvider', 'SegmDetectorCombined_v2', 'SiennaFigureMask', 'SiennaFigureComposite'];
export const FIGURE_SEGM_MODEL = 'segm/person_yolov8m-seg.pt';
/** Added to the redraw's prompt only (the main photo keeps her usual wording). */
export const FIGURE_WORDS = '(full round butt, round lifted glutes:1.15)';

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
}

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
  if (typeof posText !== 'string') return null;
  const n = FIGURE_NODES;
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
      inputs: { image, pose_keypoint: [n.pose, 1], grow: o.grow ?? 0.08, person_mask: [n.person, 0] },
      _meta: { title: 'Figure pass: hip region' },
    },
    [n.lora]: {
      class_type: 'LoraLoader',
      inputs: { model: [o.baseLoraId, 0], clip: [o.baseLoraId, 1], lora_name: o.file, strength_model: o.strength, strength_clip: o.strength },
      _meta: { title: `Figure pass: ${o.file}` },
    },
    [n.positive]: { class_type: 'CLIPTextEncode', inputs: { clip: [n.lora, 1], text: `${posText}, ${FIGURE_WORDS}` }, _meta: { title: 'Figure pass: prompt' } },
    [n.encode]: { class_type: 'VAEEncode', inputs: { pixels: image, vae: face.inputs.vae }, _meta: { title: 'Figure pass: encode' } },
    [n.noiseMask]: { class_type: 'SetLatentNoiseMask', inputs: { samples: [n.encode, 0], mask: [n.mask, 0] }, _meta: { title: 'Figure pass: region only' } },
    [n.sampler]: {
      class_type: 'KSampler',
      inputs: {
        model: [n.lora, 0],
        positive: [n.positive, 0],
        negative: face.inputs.negative,
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
      inputs: { original: image, redrawn: [n.decode, 0], mask: [n.mask, 0], soft_mask: [n.mask, 1], color_match: 1 },
      _meta: { title: 'Figure pass: colours matched, pasted in' },
    },
    [saveId]: { ...graph[saveId], inputs: { ...graph[saveId].inputs, images: [n.composite, 0] } },
  };
}

export interface FigurePassReport {
  mask?: number;
  skipped?: string;
  colorShift?: Record<string, number[]>;
  hipWidthChange?: number | null;
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
  return {
    ...(typeof m?.mask === 'number' ? { mask: m.mask } : {}),
    ...(m?.skipped || c?.skipped ? { skipped: m?.skipped ?? c?.skipped } : {}),
    ...(c?.color_shift ? { colorShift: c.color_shift } : {}),
    ...(c && 'hip_width_change' in c ? { hipWidthChange: c.hip_width_change } : {}),
  };
}
