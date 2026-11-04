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

describe('hand pass following the photo’s hand (source lock)', () => {
  it('detects hands as SEGS, gives each the photo’s cropped hand skeleton, and redraws them', async () => {
    const { addHandRefine, poseControl, HAND_REFINE_ID } = await import('./hand-refine');
    const g = {
      ...graph,
      '21': { class_type: 'ControlNetLoader', inputs: { control_net_name: 'sdxl_openpose.safetensors' } },
      '23': { class_type: 'DWPreprocessor', inputs: { image: ['30', 0] } },
      '22': { class_type: 'ControlNetApplyAdvanced', inputs: { control_net: ['21', 0], image: ['23', 0], positive: ['3', 0], negative: ['4', 0], strength: 0.85 } },
    } as ComfyGraph;
    const pose = poseControl(g)!;
    expect(pose).toEqual({ controlNet: ['21', 0], image: ['23', 0], keypoints: ['23', 1] });
    const out = addHandRefine(g, '51', { denoise: 0.55, pose: { controlNet: pose.controlNet, image: pose.image } })!;
    expect(out.hand_segs).toMatchObject({ class_type: 'BboxDetectorSEGS', inputs: { bbox_detector: ['hand_detector', 0] } });
    expect(out.hand_pose).toMatchObject({ class_type: 'ImpactControlNetApplySEGS', inputs: { segs: ['hand_segs', 0], control_net: ['21', 0], control_image: ['23', 0] } });
    expect(out[HAND_REFINE_ID]).toMatchObject({ class_type: 'DetailerForEach', inputs: { segs: ['hand_pose', 0], denoise: 0.55, model: g['51'].inputs.model } });
    const save = Object.values(out).find((n) => n.class_type === 'SaveImage')!;
    expect(save.inputs.images).toEqual([HAND_REFINE_ID, 0]);
    expect(poseControl(graph)).toBeNull();
  });
});

describe('hand pass following the photo’s hand only where they line up', () => {
  it('splits the found hands: matched ones guided by the photo’s skeleton, the rest the plain pass', async () => {
    const { addHandRefine, poseControl, HAND_REFINE_ID, HAND_MATCH_CLASS, HAND_GUIDED_DENOISE } = await import('./hand-refine');
    const g = {
      ...graph,
      '21': { class_type: 'ControlNetLoader', inputs: { control_net_name: 'sdxl_openpose.safetensors' } },
      '23': { class_type: 'DWPreprocessor', inputs: { image: ['30', 0] } },
      '22': { class_type: 'ControlNetApplyAdvanced', inputs: { control_net: ['21', 0], image: ['23', 0], positive: ['3', 0], negative: ['4', 0], strength: 0.85 } },
    } as ComfyGraph;
    const out = addHandRefine(g, '51', { denoise: 0.55, pose: poseControl(g)! })!;
    expect(out.hand_match).toMatchObject({ class_type: HAND_MATCH_CLASS, inputs: { segs: ['hand_segs', 0], pose_keypoint: ['23', 1], image: ['51', 0] } });
    expect(out.hand_pose.inputs).toMatchObject({ segs: ['hand_match', 0], control_image: ['hand_match', 2] });
    expect(out.hand_plain).toMatchObject({ class_type: 'DetailerForEach', inputs: { image: ['51', 0], segs: ['hand_match', 1], denoise: 0.55 } });
    expect(out[HAND_REFINE_ID]).toMatchObject({ class_type: 'DetailerForEach', inputs: { image: ['hand_plain', 0], segs: ['hand_pose', 0], denoise: HAND_GUIDED_DENOISE } });
    expect(Object.values(out).find((n) => n.class_type === 'SaveImage')!.inputs.images).toEqual([HAND_REFINE_ID, 0]);
  });
});
