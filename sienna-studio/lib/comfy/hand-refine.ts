/**
 * Hand touch-up: a second FaceDetailer pass that finds hands (Bingsu/adetailer hand_yolov8s, Apache-2.0) and
 * redraws each at higher resolution with Sienna's model, a short hand prompt and a light denoise. It copies the
 * face-refinement node's model/VAE/sampler wiring, so it only runs when that pass is in the graph. Inserted
 * between the last image and SaveImage.
 */
import type { ComfyGraph } from '../types';

export const HAND_DETECTOR_MODEL = 'bbox/hand_yolov8s.pt';
export const HAND_DETECTOR_ID = 'hand_detector';
export const HAND_REFINE_ID = 'hand_refine';
export const HAND_PROMPT = 'a realistic hand with five fingers, natural relaxed fingers, detailed fingernails, natural skin';
export const HAND_REFINE_DENOISE = 0.5; // 0.35 left stubby, merged fingers; 0.6 broke a good hand (A/B, 21 Oct)

/** Source-locked copies: each hand redrawn following the photo's own hand skeleton (DWPose), cropped to that hand. The
 * plain pass redrew fingers freely: a hand draped over a tub's rim came back flat on top of it (owner, 2 Nov). */
export const HAND_POSE_CLASSES = ['BboxDetectorSEGS', 'ImpactControlNetApplySEGS', 'DetailerForEach'] as const;
export const HAND_POSE_STRENGTH = 0.8;
type Ref = [string, number];
/** The pose ControlNet of a graph (its loader and the DWPose image it reads), for the hand pass to reuse. */
export function poseControl(graph: ComfyGraph): { controlNet: Ref; image: Ref } | null {
  for (const n of Object.values(graph)) {
    if (n.class_type !== 'ControlNetApplyAdvanced') continue;
    const img = n.inputs.image as Ref | undefined;
    const cn = n.inputs.control_net as Ref | undefined;
    if (Array.isArray(img) && Array.isArray(cn) && graph[img[0]]?.class_type === 'DWPreprocessor' && graph[cn[0]]?.class_type === 'ControlNetLoader') return { controlNet: cn, image: img };
  }
  return null;
}

/** The graph with the hand pass added, or null if there is no face-refinement node or SaveImage to hook into. */
export function addHandRefine(graph: ComfyGraph, faceRefineId: string, opts: { denoise?: number; prompt?: string; pose?: { controlNet: Ref; image: Ref; strength?: number } } = {}): ComfyGraph | null {
  const face = graph[faceRefineId];
  const saveId = Object.keys(graph).find((id) => graph[id].class_type === 'SaveImage');
  if (!face || face.class_type !== 'FaceDetailer' || !saveId) return null;
  const image = graph[saveId].inputs.images;
  if (!Array.isArray(image)) return null;
  if (opts.pose) {
    const f = face.inputs;
    return {
      ...graph,
      [HAND_DETECTOR_ID]: { class_type: 'UltralyticsDetectorProvider', inputs: { model_name: HAND_DETECTOR_MODEL }, _meta: { title: 'Hand Detector' } },
      hand_segs: { class_type: 'BboxDetectorSEGS', inputs: { bbox_detector: [HAND_DETECTOR_ID, 0], image, threshold: 0.4, dilation: 12, crop_factor: 2.5, drop_size: 24, labels: 'all' }, _meta: { title: 'Hands found' } },
      hand_pose: {
        class_type: 'ImpactControlNetApplySEGS',
        inputs: { segs: ['hand_segs', 0], control_net: opts.pose.controlNet, strength: opts.pose.strength ?? HAND_POSE_STRENGTH, control_image: opts.pose.image },
        _meta: { title: 'Each hand follows the photo’s hand' },
      },
      [HAND_REFINE_ID]: {
        class_type: 'DetailerForEach',
        inputs: {
          image, segs: ['hand_pose', 0], model: f.model, clip: f.clip, vae: f.vae, guide_size: 512, guide_size_for: true, max_size: 1024,
          seed: f.seed, steps: 12, cfg: f.cfg, sampler_name: f.sampler_name, scheduler: f.scheduler, positive: f.positive, negative: f.negative,
          denoise: opts.denoise ?? HAND_REFINE_DENOISE, feather: 8, noise_mask: true, force_inpaint: true, wildcard: opts.prompt ?? HAND_PROMPT, cycle: 1,
        },
        _meta: { title: 'Hand Refinement (photo’s hand pose)' },
      },
      [saveId]: { ...graph[saveId], inputs: { ...graph[saveId].inputs, images: [HAND_REFINE_ID, 0] } },
    };
  }
  return {
    ...graph,
    [HAND_DETECTOR_ID]: { class_type: 'UltralyticsDetectorProvider', inputs: { model_name: HAND_DETECTOR_MODEL }, _meta: { title: 'Hand Detector' } },
    [HAND_REFINE_ID]: {
      class_type: 'FaceDetailer',
      inputs: {
        ...face.inputs,
        image,
        bbox_detector: [HAND_DETECTOR_ID, 0],
        guide_size: 512,
        guide_size_for: true,
        max_size: 1024,
        force_inpaint: true,
        steps: 12,
        denoise: opts.denoise ?? HAND_REFINE_DENOISE,
        feather: 8,
        bbox_threshold: 0.4,
        bbox_dilation: 12,
        bbox_crop_factor: 2.5,
        sam_detection_hint: 'none',
        drop_size: 24,
        wildcard: opts.prompt ?? HAND_PROMPT,
        cycle: 1,
      },
      _meta: { title: 'Hand Refinement' },
    },
    [saveId]: { ...graph[saveId], inputs: { ...graph[saveId].inputs, images: [HAND_REFINE_ID, 0] } },
  };
}

/** Copy Photo: hands holding a thin string or strap pinch it between thumb and fingers; the relaxed-fingers prompt
 * turned them into clumsy fists round the bikini strings (boat copy, 1 Nov). */
const HOLDS_STRING_RE = /\b(hold\w*|pull\w*|tug\w*|pinch\w*|lift\w*|hook\w*)\b[^,]*\b(strings?|straps?|ties?|bottoms?|waistband)\b/i;
export const HAND_PINCH_PROMPT = 'a realistic hand with five fingers, thumb and index finger delicately pinching a thin string, other fingers relaxed and slightly curled, detailed fingernails, natural skin';
export function copyHandPrompt(pose: string): string | undefined {
  return HOLDS_STRING_RE.test(pose) ? HAND_PINCH_PROMPT : undefined;
}
