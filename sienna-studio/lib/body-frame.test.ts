import { describe, expect, it } from 'vitest';
import { BODY_FRAME_NODE_ID, bodyFrameNodes, bodyFramingOk, parseBodyFrame } from './body-frame';
import { matchPosePreset } from './pose-presets';

const joints = (present: number[]) => Array.from({ length: 14 }, (_, i) => (present.includes(i) ? [100 + i, 200 + i] : null));
const report = (present: number[], valid = true) => [JSON.stringify({ valid, joints: joints(present) })];

describe('full-body framing from her joints', () => {
  it('needs her head and an ankle in the picture', () => {
    expect(bodyFramingOk(true, parseBodyFrame(report([0, 1, 2, 5, 8, 9, 10, 11, 12, 13])))).toBe(true);
    expect(bodyFramingOk(true, parseBodyFrame(report([0, 1, 2, 5, 8, 11, 13])))).toBe(true); // one ankle hidden
    // cut off at the thighs (the position-test failures)
    expect(bodyFramingOk(true, parseBodyFrame(report([0, 1, 2, 5, 8, 11])))).toBe(false);
    expect(bodyFramingOk(true, parseBodyFrame(report([1, 2, 5, 8, 9, 10, 11, 12, 13])))).toBe(true); // face turned away: neck counts
  });
  it('gives no verdict when the body could not be judged, or framing was not full body', () => {
    expect(bodyFramingOk(true, parseBodyFrame(report([], false)))).toBeUndefined();
    expect(bodyFramingOk(true, parseBodyFrame(['not json']))).toBeUndefined();
    expect(bodyFramingOk(true, parseBodyFrame(undefined))).toBeUndefined();
    expect(bodyFramingOk(false, parseBodyFrame(report([0, 1])))).toBeUndefined();
  });
  it('measures the image that gets saved and publishes the result', () => {
    const g = { '9': { class_type: 'SaveImage', inputs: { images: ['8', 0] } } };
    const n = bodyFrameNodes(g, '9')!;
    expect(n.sienna_body_pose.inputs.image).toEqual(['8', 0]);
    expect(n.sienna_body_measure.inputs.pose_keypoint).toEqual(['sienna_body_pose', 1]);
    expect(n[BODY_FRAME_NODE_ID].class_type).toBe('SiennaTextOutput');
    expect(bodyFrameNodes({}, '9')).toBeNull();
  });
});

describe('pose preset from the Pose text', () => {
  const id = (t: string, full = false) => matchPosePreset(t, full)?.id;
  it('picks the position the text describes', () => {
    expect(id('lying on her back on the bed, legs together')).toBe('lying_on_back');
    expect(id('lying on her side, propped up on one elbow')).toBe('lying_on_side');
    expect(id('lying on her stomach, feet up')).toBe('lying_on_stomach');
    expect(id('kneeling upright on the bed, knees together')).toBe('kneeling_upright');
    expect(id('sitting cross-legged on the floor')).toBe('sitting_crosslegged');
    expect(id('standing with her arms crossed')).toBe('arms_crossed');
    expect(id('mirror selfie in the bathroom')).toBe('mirror_selfie');
    expect(id('standing beside the bed, arms relaxed', true)).toBe('standing_full_body');
  });
  it('leaves other poses alone', () => {
    expect(id('standing beside the bed, arms relaxed', false)).toBeUndefined(); // not a full-body request
    expect(id('walking along the beach, standing tall', true)).toBeUndefined();
    expect(id('kneeling on all fours')).toBeUndefined();
    expect(id('sitting on the edge of the bed')).toBeUndefined();
    expect(id('')).toBeUndefined();
    expect(id('looking back over her shoulder')).toBeUndefined();
  });
});
