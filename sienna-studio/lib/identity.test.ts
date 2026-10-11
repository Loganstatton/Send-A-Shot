import { describe, expect, it } from 'vitest';
import { galleryState, identityNotice, needsIdentityReview } from './identity-notice';
import { colourCheck, FACE_THRESHOLD, FACE_TURNED_FLOOR, faceVerdict, parseFace, rearRequest } from './identity';

const face = (similarity: number | null, more: Partial<Parameters<typeof faceVerdict>[0]> = {}) => ({
  available: true, ok: true, similarity, size: 150, found: similarity !== null, ...more,
});

describe('faceVerdict', () => {
  it('verifies a close face whatever the pose', () => {
    expect(faceVerdict(face(0.8), false).status).toBe('verified');
    expect(faceVerdict(face(FACE_THRESHOLD), true).status).toBe('verified');
  });

  it('a facing-the-camera face below the threshold is a mismatch (redone as before)', () => {
    expect(faceVerdict(face(0.7, { yaw: 0.05, eyeRatio: 0.47 }), false)).toMatchObject({ status: 'mismatch', reason: "didn't look enough like Sienna" });
  });

  it('a turned face in the unreliable band is inconclusive, not a match', () => {
    expect(faceVerdict(face(0.7), true)).toMatchObject({ status: 'inconclusive', reason: 'her face is turned away' });
    expect(faceVerdict(face(0.7, { yaw: 0.5 }), false).status).toBe('inconclusive');
    expect(faceVerdict(face(0.7, { eyeRatio: 0.3 }), false).status).toBe('inconclusive');
  });

  it('the floor sits at 0.68: drifted lookalikes reach 0.74, unrelated women 0.63', () => {
    expect(FACE_TURNED_FLOOR).toBe(0.68);
    expect(faceVerdict(face(0.67), true).status).toBe('mismatch');
    expect(faceVerdict(face(0.6, { yaw: 0.9 }), false).status).toBe('mismatch');
  });

  it('hair or skin colour that clearly differs stops a turned face from skipping its retry', () => {
    const v = faceVerdict(face(0.7, { hairRel: 1.3, skinHue: 47 }), true);
    expect(v.status).toBe('mismatch');
    expect(v.reason).toBe("her face is turned away and her hair looks much lighter than Sienna's dark brown");
    expect(faceVerdict(face(0.7, { hairRel: 0.3, skinHue: 15 }), true).status).toBe('mismatch');
    expect(faceVerdict(face(0.7, { hairRel: 0.3, skinHue: 47 }), true).status).toBe('inconclusive');
  });

  it('colour never verifies a face, and never fails a verified one', () => {
    expect(faceVerdict(face(0.6, { hairRel: 0.3, skinHue: 47 }), false).status).toBe('mismatch');
    expect(faceVerdict(face(0.8, { hairRel: 1.5 }), false).status).toBe('verified');
  });

  it('colour is lighting-tolerant: Sienna from shade to golden hour stays consistent; black-and-white is not judged', () => {
    for (const [hairRel, skinHue] of [[0.14, 40], [0.65, 56], [0.94, 52]]) expect(colourCheck(face(0.7, { hairRel, skinHue })).status).toBe('consistent');
    expect(colourCheck(face(0.7, { hairRel: 1.4, skinHue: 0, mono: true })).status).toBe('unknown');
  });

  it('a turned face that is clearly someone else is still a mismatch', () => {
    expect(faceVerdict(face(FACE_TURNED_FLOOR - 0.01), true).status).toBe('mismatch');
    expect(faceVerdict(face(0.3, { yaw: 0.9 }), true).status).toBe('mismatch');
    expect(FACE_THRESHOLD).toBe(0.74);
  });

  it('no face, or one too small to read, is inconclusive', () => {
    expect(faceVerdict(face(null), false)).toMatchObject({ status: 'inconclusive', reason: 'no face was found' });
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
    const r = parseFace([JSON.stringify({ available: true, ok: false, similarity: 0.6, images: [{ found: true, similarity: 0.6, size: 150, yaw: 0.42, eye_ratio: 0.36, hair_rel: 0.31, skin_hue: 47.2, mono: false }] })])!;
    expect([r.yaw, r.eyeRatio, r.found, r.size, r.hairRel, r.skinHue, r.mono]).toEqual([0.42, 0.36, true, 150, 0.31, 47.2, false]);
    const old = parseFace([JSON.stringify({ available: true, ok: true, similarity: 0.8, images: [{ found: true, similarity: 0.8, size: 150 }] })])!;
    expect([old.yaw, old.eyeRatio]).toEqual([null, null]);
  });
});

describe('identityNotice (gallery)', () => {
  const base = { review: {} };
  it('says nothing for a verified face', () => {
    expect(identityNotice({ ...base, identityCheck: { status: 'verified', similarity: 0.82 } })).toBeNull();
    expect(identityNotice(base)).toBeNull();
  });
  it('flags an inconclusive face and never calls it a match', () => {
    const n = identityNotice({ ...base, identityCheck: { status: 'inconclusive', similarity: 0.7, reason: 'her face is turned away' } })!;
    expect(n.title).toBe('Face not verified');
    expect(n.detail).toContain("couldn't confirm this is Sienna: her face is turned away (similarity 0.70");
    expect(n.detail).toContain('not been counted as a match');
    expect(needsIdentityReview({ ...base, identityCheck: { status: 'inconclusive', similarity: 0.7 } })).toBe(true);
  });
  it("flags the closest-of-four photo when nothing matched", () => {
    expect(identityNotice({ ...base, identityCheck: { status: 'unconfirmed', similarity: 0.6 } })!.title).toBe("Face didn't match");
  });
  it("keeps the user's own call separate from verification", () => {
    const rec = { identityCheck: { status: 'inconclusive' as const, similarity: 0.7 }, review: { face_drift: 'ok' as const } };
    expect(identityNotice(rec)!.userCall).toBe('looks_like_her');
    expect(needsIdentityReview(rec)).toBe(false);
    expect(needsIdentityReview({ ...rec, review: { face_drift: 'issue' as const } })).toBe(true);
  });
});

describe('galleryState (Needs Review)', () => {
  const rec = (status: 'verified' | 'inconclusive' | 'unconfirmed' | null, face_drift?: 'ok' | 'issue') => ({
    identityCheck: status ? { status, similarity: 0.7 } : undefined,
    review: face_drift ? { face_drift } : {},
  });
  it('only a verified face (or no face check) is approved automatically', () => {
    expect(galleryState(rec('verified'))).toBe('approved');
    expect(galleryState(rec(null))).toBe('approved');
  });
  it('unverified photos, including the closest-of-four fallback, wait in Needs Review', () => {
    expect(galleryState(rec('inconclusive'))).toBe('needs_review');
    expect(galleryState(rec('unconfirmed'))).toBe('needs_review');
  });
  it("the user's approval moves it to the gallery as theirs, never as a verified face", () => {
    expect(galleryState(rec('inconclusive', 'ok'))).toBe('approved_by_you');
    expect(identityNotice(rec('inconclusive', 'ok'))!.title).toBe('Face not verified');
    expect(galleryState(rec('unconfirmed', 'issue'))).toBe('rejected');
    expect(needsIdentityReview(rec('unconfirmed', 'issue'))).toBe(true);
  });
  it("a verified photo's review mark doesn't change where it is filed", () => {
    expect(galleryState(rec('verified', 'issue'))).toBe('approved');
  });
});
