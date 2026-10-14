import { describe, expect, it } from 'vitest';
import { galleryState, identityLabel, identityNotice, isLegacyPhoto, needsIdentityReview } from './identity-notice';
import { FACE_THRESHOLD, FACE_TURNED_FLOOR, faceVerdict, missingIdentity, parseFace, rearRequest, singlePhotoIdentity } from './identity';

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

describe('face check could not run (production)', () => {
  const params = (faceCheck?: boolean) => ({ faceCheck }) as never;
  const done = { status: 'done' as const, images: [{ id: 'i', file: 'gen_i.png', width: 1, height: 1, createdAt: '' }], review: {} };

  it('never reads "could not run" as verified: every cause becomes unavailable', () => {
    const cases = [
      missingIdentity({ siennaLock: true, params: params(), exposureGuard: undefined }),
      missingIdentity({ siennaLock: true, params: params(), exposureGuard: { status: 'unavailable', reason: 'server is missing SiennaFaceCheck', maxAttempts: 1, attempts: [] } }),
      missingIdentity({ siennaLock: true, params: params(false), exposureGuard: undefined }),
      missingIdentity({ siennaLock: true, params: params(), exposureGuard: undefined }, 'the face check could not run (models not installed)'),
      missingIdentity({ siennaLock: true, params: params(), exposureGuard: undefined }, 'the face check returned no result'),
    ];
    for (const c of cases) {
      expect(c.status).toBe('unavailable');
      expect(galleryState({ ...done, identityCheck: c })).toBe('needs_review');
    }
    expect(cases[1].reason).toBe('the face check could not run (server is missing SiennaFaceCheck)');
    expect(cases[2].reason).toBe('the face check was turned off for this photo');
    expect(cases[3].reason).toBe('the face check could not run (models not installed)');
  });

  it('Sienna Lock off is the only case identity does not apply (not meant to be her)', () => {
    const c = missingIdentity({ siennaLock: false, params: params(), exposureGuard: undefined });
    expect(c.status).toBe('not_applicable');
    expect(galleryState({ ...done, identityCheck: c })).toBe('approved');
  });

  it('fails closed: a photo from this release with no face-check outcome goes to Needs Review', () => {
    const fresh = { ...done, identityPolicy: 1 as const, identityCheck: undefined };
    expect(galleryState(fresh)).toBe('needs_review');
    expect(identityNotice(fresh)!.detail).toContain('Face check unavailable: no face-check result was recorded');
    // failed or unfinished jobs have no photo to approve and stay as they are
    expect(galleryState({ status: 'error', images: [], review: {}, identityCheck: undefined })).toBe('approved');
  });

  it('labels "face not detected" and "face check unavailable" differently', () => {
    expect(identityLabel({ status: 'unchecked', similarity: null })).toBe('Face not detected');
    expect(identityLabel({ status: 'unavailable', similarity: null })).toBe('Face check unavailable');
    expect(identityLabel(undefined)).toBe('No face-check result');
    const n = identityNotice({ ...done, identityCheck: { status: 'unavailable', similarity: null, reason: 'the face check returned no result' } })!;
    expect(n.title).toBe('Face not verified — manual review required');
    expect(n.detail).toMatch(/^Face check unavailable: the face check returned no result\. Verification did not happen/);
    expect(identityNotice({ ...done, identityCheck: { status: 'unchecked', similarity: null, reason: 'no face was found' } })!.detail).toMatch(/^Face not detected/);
  });

  it('manual approval keeps the unavailable status; nothing is deleted or rejected automatically', () => {
    const c = { status: 'unavailable' as const, similarity: null, reason: 'the face check returned no result' };
    expect(galleryState({ ...done, identityCheck: c, review: { face_drift: 'ok' } })).toBe('approved_by_you');
    expect(identityNotice({ ...done, identityCheck: c, review: { face_drift: 'ok' } })!.title).toBe('Face not verified — manual review required');
    expect(galleryState({ ...done, identityCheck: c, review: { face_drift: 'issue' } })).toBe('rejected');
  });

  it('only "verified" or Sienna Lock off is ever approved automatically', () => {
    const statuses = ['verified', 'inconclusive', 'unconfirmed', 'unchecked', 'unavailable', 'not_applicable'] as const;
    const auto = statuses.filter((status) => galleryState({ ...done, identityCheck: { status, similarity: null } }) === 'approved');
    expect(auto).toEqual(['verified', 'not_applicable']);
  });
});

describe('legacy photos (made before face verification)', () => {
  const legacy = { status: 'done' as const, images: [{ id: 'i', file: 'gen_i.png', width: 1, height: 1, createdAt: '' }], review: {} };
  it('stay in the gallery, labelled legacy — not moved, not verified', () => {
    expect(isLegacyPhoto(legacy)).toBe(true);
    expect(galleryState(legacy)).toBe('legacy');
    expect(needsIdentityReview(legacy)).toBe(false);
    expect(identityNotice(legacy)).toBeNull();
  });
  it('even an old record whose old check passed is not treated as verified', () => {
    const old = { ...legacy, exposureGuard: { status: 'on' as const, maxAttempts: 4, attempts: [{ seed: 1, exposed: false, score: 0, faceOk: true, similarity: 0.8, images: [] }] } };
    expect(galleryState(old)).toBe('legacy');
  });
  it("the user's own call still applies to legacy photos", () => {
    expect(galleryState({ ...legacy, review: { face_drift: 'ok' as const } })).toBe('approved_by_you');
    expect(galleryState({ ...legacy, review: { face_drift: 'issue' as const } })).toBe('rejected');
  });
  it('a new photo (marked with identityPolicy) is never mistaken for legacy', () => {
    expect(isLegacyPhoto({ ...legacy, identityPolicy: 1 })).toBe(false);
    expect(galleryState({ ...legacy, identityPolicy: 1 })).toBe('needs_review');
  });
  it('unfinished or failed jobs are neither legacy nor approved content', () => {
    expect(isLegacyPhoto({ status: 'error', images: [], review: {} })).toBe(false);
  });
});

describe('Edit Outfit results (single photo, no retries)', () => {
  const rec = { siennaLock: true, params: {} as never, exposureGuard: undefined };
  const report = (similarity: number | null, more = {}) => ({ available: true, ok: true, similarity, size: 150, found: similarity !== null, ...more });
  it('uses the same 0.74 rule', () => {
    expect(singlePhotoIdentity(rec, report(0.8)).status).toBe('verified');
    expect(singlePhotoIdentity(rec, report(0.7))).toEqual({ status: 'unconfirmed', similarity: 0.7, reason: "didn't look enough like Sienna" });
    expect(singlePhotoIdentity(rec, report(null)).status).toBe('unchecked');
  });
  it('face check missing, failed or empty → unavailable (Needs Review), never verified', () => {
    expect(singlePhotoIdentity(rec, null)).toEqual({ status: 'unavailable', similarity: null, reason: 'the face check returned no result' });
    expect(singlePhotoIdentity(rec, { available: false, ok: true, similarity: null, error: 'models failed' }).reason).toBe('the face check could not run (models failed)');
    expect(singlePhotoIdentity(rec, null, 'the face check could not run (server is missing SiennaFaceCheck)').status).toBe('unavailable');
  });
});
