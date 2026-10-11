import { describe, expect, it } from 'vitest';
import { FACE_THRESHOLD, FACE_TURNED_FLOOR, faceVerdict, parseFace, rearRequest } from './identity';

const face = (similarity: number | null, more: Partial<Parameters<typeof faceVerdict>[0]> = {}) => ({
  available: true, ok: true, similarity, size: 150, found: similarity !== null, ...more,
});

describe('faceVerdict', () => {
  it('verifies a close face whatever the pose', () => {
    expect(faceVerdict(face(0.8), false).status).toBe('verified');
    expect(faceVerdict(face(FACE_THRESHOLD), true).status).toBe('verified');
  });

  it('a facing-the-camera face below the threshold is a mismatch (redone as before)', () => {
    expect(faceVerdict(face(0.7, { yaw: 0.05, eyeRatio: 0.47 }), false)).toEqual({ status: 'mismatch', reason: "didn't look enough like Sienna" });
  });

  it('a turned face in the unreliable band is inconclusive, not a match', () => {
    expect(faceVerdict(face(0.6), true)).toEqual({ status: 'inconclusive', reason: 'her face is turned away' });
    expect(faceVerdict(face(0.6, { yaw: 0.5 }), false).status).toBe('inconclusive');
    expect(faceVerdict(face(0.6, { eyeRatio: 0.3 }), false).status).toBe('inconclusive');
  });

  it('a turned face that is clearly someone else is still a mismatch', () => {
    expect(faceVerdict(face(FACE_TURNED_FLOOR - 0.01), true).status).toBe('mismatch');
    expect(faceVerdict(face(0.3, { yaw: 0.9 }), true).status).toBe('mismatch');
  });

  it('no face, or one too small to read, is inconclusive', () => {
    expect(faceVerdict(face(null), false)).toEqual({ status: 'inconclusive', reason: 'no face was found' });
    expect(faceVerdict(face(0.2, { size: 40 }), false).status).toBe('inconclusive');
  });
});

describe('rearRequest', () => {
  it('spots from-behind requests', () => {
    expect(rearRequest('kneeling, seen from behind, looking back over her shoulder', null, false)).toBe(true);
    expect(rearRequest('standing', 'looking_back', false)).toBe(true);
    expect(rearRequest('sitting on the sink', null, true)).toBe(true);
    expect(rearRequest('standing, facing the camera', 'arms_crossed', false)).toBe(false);
  });
});

describe('parseFace', () => {
  it('reads head turn when the node reports it, and copes with older reports', () => {
    const r = parseFace([JSON.stringify({ available: true, ok: false, similarity: 0.6, images: [{ found: true, similarity: 0.6, size: 150, yaw: 0.42, eye_ratio: 0.36 }] })])!;
    expect([r.yaw, r.eyeRatio, r.found, r.size]).toEqual([0.42, 0.36, true, 150]);
    const old = parseFace([JSON.stringify({ available: true, ok: true, similarity: 0.8, images: [{ found: true, similarity: 0.8, size: 150 }] })])!;
    expect([old.yaw, old.eyeRatio]).toEqual([null, null]);
  });
});
