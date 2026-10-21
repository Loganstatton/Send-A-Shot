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

/** The graph with the hand pass added, or null if there is no face-refinement node or SaveImage to hook into. */
export function addHandRefine(graph: ComfyGraph, faceRefineId: string, opts: { denoise?: number } = {}): ComfyGraph | null {
  const face = graph[faceRefineId];
  const saveId = Object.keys(graph).find((id) => graph[id].class_type === 'SaveImage');
  if (!face || face.class_type !== 'FaceDetailer' || !saveId) return null;
  const image = graph[saveId].inputs.images;
  if (!Array.isArray(image)) return null;
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
        wildcard: HAND_PROMPT,
        cycle: 1,
      },
      _meta: { title: 'Hand Refinement' },
    },
    [saveId]: { ...graph[saveId], inputs: { ...graph[saveId].inputs, images: [HAND_REFINE_ID, 0] } },
  };
}
