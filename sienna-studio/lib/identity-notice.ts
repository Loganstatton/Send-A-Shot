/**
 * What the gallery says about a photo whose face wasn't verified as Sienna's (client-safe: no embedding import).
 * Such photos are kept out of the gallery, in Needs Review, until the user decides.
 * Only a 'verified' face check counts as Sienna; anything else is flagged so the user decides whether to keep it.
 * The user's own call is stored as the existing 'face_drift' review mark ('ok' = looks like her, 'issue' = not her)
 * and is shown as theirs — it never turns the photo into a verified match.
 */
import type { GenerationRecord } from './types';

export interface IdentityNotice {
  title: string;
  detail: string;
  /** The user's own decision, if they made one. */
  userCall?: 'looks_like_her' | 'not_her';
}

type NoticeRec = Pick<GenerationRecord, 'identityCheck' | 'review'> & Partial<Pick<GenerationRecord, 'status' | 'images'>>;

/** Short label for the photo details: what the face check found, or why it couldn't. */
export function identityLabel(c: GenerationRecord['identityCheck'] | undefined): string {
  if (!c) return 'Face check unavailable — no result recorded';
  switch (c.status) {
    case 'verified': return 'Verified as Sienna';
    case 'unconfirmed': return "Didn't match Sienna";
    case 'unchecked': return 'Face not detected';
    case 'unavailable': return 'Face check unavailable';
    case 'inconclusive': return 'Not verified (turned away)';
    case 'not_applicable': return 'Not checked — Sienna Lock off';
  }
}

export function identityNotice(rec: NoticeRec): IdentityNotice | null {
  const mark = rec.review?.face_drift;
  const userCall = mark === 'ok' ? 'looks_like_her' : mark === 'issue' ? 'not_her' : undefined;
  // Fail closed: a finished photo with no face-check outcome at all is treated as "check unavailable".
  const c = rec.identityCheck ?? (rec.status === 'done' && rec.images?.length ? { status: 'unavailable' as const, similarity: null, reason: 'no face-check result was recorded' } : undefined);
  if (!c || c.status === 'verified' || c.status === 'not_applicable') return null;
  const sim = typeof c.similarity === 'number' ? ` (similarity ${c.similarity.toFixed(2)}; 0.74 or more confirms her face)` : '';
  if (c.status === 'unchecked') {
    // her face couldn't be found or was too small to compare (often hidden or turned away on purpose): not retried,
    // not rejected — the user decides
    return {
      title: 'Face not verified — manual review required',
      detail: `Face not detected: ${c.reason ?? 'no face was found'}, so it couldn't be compared with Sienna. It was not retried and has not been counted as a match; it is waiting in Needs Review for you to approve or reject.`,
      userCall,
    };
  }
  if (c.status === 'unavailable') {
    return {
      title: 'Face not verified — manual review required',
      detail: `Face check unavailable: ${c.reason ?? 'the face check could not run'}. Verification did not happen, so this photo has not been counted as Sienna; it is waiting in Needs Review for you to approve or reject.`,
      userCall,
    };
  }
  if (c.status === 'inconclusive') {
    return {
      title: 'Face not verified',
      detail: `The face check couldn't confirm this is Sienna: ${c.reason ?? 'her face could not be judged'}${sim}. It has not been counted as a match and is waiting in Needs Review, not the gallery.`,
      userCall,
    };
  }
  return {
    title: "Face didn't match",
    detail: `None of the attempts matched Sienna's face closely, so this is the closest one${sim}. It is not confirmed as her and is waiting in Needs Review, not the gallery.`,
    userCall,
  };
}

/**
 * Where a photo is filed. Only a verified face is approved automatically (and photos made with Sienna Lock off,
 * which aren't meant to be her). Everything else — no match, face not detected, face check unavailable, or no
 * result recorded at all — waits in Needs Review. The user's "Looks like Sienna" moves it into the gallery marked
 * as their approval (still not a verified face); "Not her" leaves it in Needs Review as rejected.
 */
export type GalleryState = 'approved' | 'needs_review' | 'approved_by_you' | 'rejected';

export function galleryState(rec: NoticeRec): GalleryState {
  const n = identityNotice(rec);
  if (!n) return 'approved';
  return n.userCall === 'looks_like_her' ? 'approved_by_you' : n.userCall === 'not_her' ? 'rejected' : 'needs_review';
}

export function needsIdentityReview(rec: NoticeRec): boolean {
  const s = galleryState(rec);
  return s === 'needs_review' || s === 'rejected';
}
