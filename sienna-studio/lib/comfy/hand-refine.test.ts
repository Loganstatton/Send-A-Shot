import { describe, expect, it } from 'vitest';
import { addHandRefine, HAND_DETECTOR_ID, HAND_REFINE_DENOISE, HAND_REFINE_ID } from './hand-refine';
import type { ComfyGraph } from '../types';

const graph: ComfyGraph = {
  '41': { class_type: 'VAEDecode', inputs: {} },
  '51': { class_type: 'FaceDetailer', inputs: { image: ['41', 0], model: ['2', 0], seed: 9, steps: 12, denoise: 0.3, wildcard: '', bbox_detector: ['50', 0] } },
  '42': { class_type: 'SaveImage', inputs: { images: ['51', 0], filename_prefix: 'sienna' } },
};

describe('addHandRefine', () => {
  it('chains a hand pass after the face pass, copying its wiring', () => {
    const g = addHandRefine(graph, '51')!;
    expect(g['42'].inputs.images).toEqual([HAND_REFINE_ID, 0]);
    expect(g[HAND_REFINE_ID].inputs).toMatchObject({ image: ['51', 0], model: ['2', 0], seed: 9, bbox_detector: [HAND_DETECTOR_ID, 0], denoise: HAND_REFINE_DENOISE });
    expect(String(g[HAND_REFINE_ID].inputs.wildcard)).toContain('five fingers');
    expect(g[HAND_DETECTOR_ID].inputs.model_name).toBe('bbox/hand_yolov8s.pt');
    expect(graph['42'].inputs.images).toEqual(['51', 0]); // input untouched
  });

  it('does nothing without a face pass', () => {
    expect(addHandRefine(graph, 'nope')).toBeNull();
  });
});
