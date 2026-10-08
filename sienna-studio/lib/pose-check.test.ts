import { describe, expect, it } from 'vitest';
import { skeletonExtent } from './framing';
import { firstBody } from './pose-check';

// Real DWPreprocessor output shape from the Phase 1 GPU session: pixel coordinates on the canvas.
const pixelPose = (ys: number[], w = 832, h = 1216) =>
  JSON.stringify([{ people: [{ pose_keypoints_2d: ys.flatMap((y) => [400, y, 1]) }], canvas_width: w, canvas_height: h }]);

describe('firstBody', () => {
  it('normalizes pixel keypoints using the canvas size', () => {
    const ys = [130, 230, 235, 400, 540, 235, 400, 540, 640, 870, 1100, 640, 870, 1100, 115, 115, 120, 120];
    const b = firstBody(pixelPose(ys))!;
    expect(b.flat[0]).toBeCloseTo(400 / 832, 6);
    expect(b.flat[1]).toBeCloseTo(130 / 1216, 6);
    expect(Math.max(...b.flat.filter((_, i) => i % 3 !== 2))).toBeLessThanOrEqual(1);
    expect(skeletonExtent(b.flat)).toBe('full body'); // was null before the fix
  });
  it('leaves already-normalized keypoints alone', () => {
    const flat = Array.from({ length: 18 }, (_, i) => [0.5, 0.05 * (i + 1), 1]).flat();
    const b = firstBody(JSON.stringify({ people: [{ pose_keypoints_2d: flat }], canvas_width: 832, canvas_height: 1216 }))!;
    expect(b.flat).toEqual(flat);
  });
  it('handles empty / malformed input', () => {
    expect(firstBody(undefined)).toBeNull();
    expect(firstBody('not json')).toBeNull();
    expect(firstBody(JSON.stringify([{ people: [], canvas_width: 10, canvas_height: 10 }]))).toBeNull();
  });
});
