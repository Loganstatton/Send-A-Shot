/**
 * What the gallery says about a photo whose face wasn't verified as Sienna's (client-safe: no embedding import).
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

export function identityNotice(rec: Pick<GenerationRecord, 'identityCheck' | 'review'>): IdentityNotice | null {
  const c = rec.identityCheck;
  if (!c || c.status === 'verified') return null;
  const sim = typeof c.similarity === 'number' ? ` (similarity ${c.similarity.toFixed(2)}; 0.74 or more confirms her face)` : '';
  const mark = rec.review?.face_drift;
  const userCall = mark === 'ok' ? 'looks_like_her' : mark === 'issue' ? 'not_her' : undefined;
  if (c.status === 'inconclusive') {
    return {
      title: 'Face not verified',
      detail: `The face check couldn't confirm this is Sienna: ${c.reason ?? 'her face could not be judged'}${sim}. It has not been counted as a match. Keep it only if she looks right to you.`,
      userCall,
    };
  }
  return {
    title: "Face didn't match",
    detail: `None of the attempts matched Sienna's face closely, so this is the closest one${sim}. It is not confirmed as her.`,
    userCall,
  };
}

/** Flagged in the gallery grid until the user says it looks like her. */
export function needsIdentityReview(rec: Pick<GenerationRecord, 'identityCheck' | 'review'>): boolean {
  const n = identityNotice(rec);
  return !!n && n.userCall !== 'looks_like_her';
}
