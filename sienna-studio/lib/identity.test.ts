import { describe, expect, it } from 'vitest';
import { galleryState, identityNotice, needsIdentityReview } from './identity-notice';
import { FACE_THRESHOLD, FACE_TURNED_FLOOR, faceVerdict, parseFace, rearRequest } from './identity';

const face = (similarity: number | null, more: Partial<Parameters<typeof faceVerdict>[0]> = {}) => ({
  available: true, ok: true, similarity, size: 150, found: similarity !== null, ...more,
});

describe('faceVerdict — production (strict 0.74)', () => {
  it('verifies 0.74 or more, in any pose', () => {
    expect(FACE_THRESHOLD).toBe(0.74);
    expect(faceVerdict(face(0.8), false).status).toBe('verified');
    expect(faceVerdict(face(0.74), true).status).toBe('verified');
  });

  it('anything below 0.74 is a mismatch and is redone — including turned faces', () => {
    expect(faceVerdict(face(0.73), false)).toEqual({ status: 'mismatch', reason: "didn't look enough like Sienna" });
    expect(faceVerdict(face(0.72), true).status).toBe('mismatch');
    expect(faceVerdict(face(0.7, { yaw: 0.9, eyeRatio: 0.2 }), true, 'strict').status).toBe('mismatch');
  });

  it('a face that cannot be compared is unchecked: not a match, and not a retry', () => {
    expect(faceVerdict(face(null), false)).toEqual({ status: 'unchecked', reason: 'no face was found' });
    expect(faceVerdict(face(0.2, { size: 40 }), false).status).toBe('unchecked');
  });

  it('hair and skin colour never change a decision', () => {
    expect(faceVerdict(face(0.8, { hairRel: 2.5, skinHue: 10 }), true).status).toBe('verified');
    expect(faceVerdict(face(0.6, { hairRel: 0.3, skinHue: 47 }), true).status).toBe('mismatch');
    expect(faceVerdict(face(0.7, { hairRel: 2.5 }), true, 'pose-aware').status).toBe('inconclusive');
  });
});

describe('faceVerdict — experimental pose-aware 0.68 (dev only)', () => {
  it('a turned face between 0.68 and 0.74 is inconclusive, never a match', () => {
    expect(FACE_TURNED_FLOOR).toBe(0.68);
    expect(faceVerdict(face(0.7), true, 'pose-aware')).toEqual({ status: 'inconclusive', reason: 'her face is turned away' });
    expect(faceVerdict(face(0.7, { yaw: 0.5 }), false, 'pose-aware').status).toBe('inconclusive');
    expect(faceVerdict(face(0.67), true, 'pose-aware').status).toBe('mismatch');
    expect(faceVerdict(face(0.7, { yaw: 0.05, eyeRatio: 0.47 }), false, 'pose-aware').status).toBe('mismatch');
    expect(faceVerdict(face(null), false, 'pose-aware').status).toBe('inconclusive');
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
  const rec = (status: 'verified' | 'inconclusive' | 'unconfirmed' | 'unchecked' | null, face_drift?: 'ok' | 'issue') => ({
    identityCheck: status ? { status, similarity: 0.7 } : undefined,
    review: face_drift ? { face_drift } : {},
  });
  it('only a verified face (or a photo the face check never ran on) is approved automatically', () => {
    expect(galleryState(rec('verified'))).toBe('approved');
    expect(galleryState(rec(null))).toBe('approved');
  });

  it('no face to compare goes to Needs Review, labelled for manual review — not rejected', () => {
    expect(galleryState(rec('unchecked'))).toBe('needs_review');
    const n = identityNotice({ identityCheck: { status: 'unchecked', similarity: null, reason: 'no face was found' }, review: {} })!;
    expect(n.title).toBe('Face not verified — manual review required');
    expect(n.detail).toContain('no face was found');
    expect(n.detail).toContain('not retried');
    expect(n.detail).toContain('approve or reject');
  });

  it('a no-face photo can be approved or rejected manually; approval never becomes verification', () => {
    expect(galleryState(rec('unchecked', 'ok'))).toBe('approved_by_you');
    expect(identityNotice(rec('unchecked', 'ok'))!.title).toBe('Face not verified — manual review required');
    expect(galleryState(rec('unchecked', 'issue'))).toBe('rejected');
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
