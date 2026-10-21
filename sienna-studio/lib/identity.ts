/**
 * Face check: after each Sienna photo, SiennaFaceCheck (OpenCV SFace, Apache-2.0) compares the main face with
 * Sienna's reference embedding — the mean of four approved photos, which score 0.88–0.93 against it. A photo
 * below FACE_THRESHOLD is redone with a new seed (shares the retry budget with the top check) — unless her face is
 * turned away, see faceVerdict. Faces smaller than FACE_MIN_SIZE px can't be judged: their embedding is too noisy.
 */
import reference from './sienna-face-reference.json';
import type { ComfyGraph, GenerationRecord } from './types';

export const FACE_NODE_ID = 'sienna_face';
export const FACE_NODE_CLASS = 'SiennaFaceCheck';
export const FACE_THRESHOLD = 0.74;
/**
 * 0.70–0.74 = 'likely': blind review of the studio's own photos (21 Oct, 63 faces scoring 0.60–0.78, labelled without
 * scores) found 9 of the 11 rejected ones were clearly her, while the clear misses were blonde faces copied from
 * uploaded photos that scored 0.748 and passed. In that band the score barely separates her from lookalikes, so a
 * likely face is accepted without a redo unless a stronger tell says otherwise (hair much lighter than hers, or a
 * reference photo shaped the picture — where the drift happened).
 */
export const FACE_LIKELY = 0.7;
/** Hair/skin brightness above this = hair much lighter than hers (Sienna 0.14–0.65 in 99 % of photos). */
export const HAIR_LIGHTER = 1.0;
export const FACE_MIN_SIZE = 64;
export const SIENNA_FACE_EMBEDDING: number[] = reference;

/** In a full-body request, a face taller than this share of the image height means the shot came out too close. */
export const FULL_BODY_MAX_FACE = 0.1;

export interface FaceReport {
  available: boolean;
  ok: boolean;
  similarity: number | null;
  /** Shorter side of the main face box, px. */
  size?: number | null;
  /** Whether a face was found at all (missing from older reports). */
  found?: boolean;
  /** Head turn from the face landmarks (missing from older nodes): see sienna_face.head_turn. */
  yaw?: number | null;
  eyeRatio?: number | null;
  /** Hair/skin colour measured by newer nodes (sienna_face.appearance). Informational only — never used to decide. */
  hairRel?: number | null;
  skinHue?: number | null;
  mono?: boolean;
  error?: string;
}

/**
 * Face verdicts. Only 'verified' counts as Sienna.
 *
 * Production ('strict', the deployed rule, chosen after the blind-labelled GPU A/B in
 * docs/FACE_CHECK_CALIBRATION.md): similarity >= FACE_THRESHOLD is verified; anything below is a mismatch and is
 * redone with a new seed, up to four photos; if none verifies, the closest is kept and filed in Needs Review, never
 * the gallery. A face that can't be compared (none found, or too small — often hidden or turned away on purpose) is
 * 'unchecked': not retried (another seed wouldn't help), never a match, filed in Needs Review. When the request itself
 * turns her away (a from-behind pose, see rearRequest), a below-threshold face is 'inconclusive' instead of a mismatch:
 * retrying chased a face that scored better, which always meant one turned to the camera — against the request.
 *
 * Experimental ('pose-aware', only with SIENNA_EXPERIMENTAL=true): a turned face scoring between FACE_TURNED_FLOOR
 * and FACE_THRESHOLD is 'inconclusive' — not retried, filed in Needs Review. Faster on from-behind shots but it
 * verified fewer photos in the A/B, so it is not used in production.
 *
 * Hair colour only ever blocks a 'likely' (0.70–0.74) face: in the A/B it misflagged 15 of 171 blind-confirmed Sienna
 * photos under backlight, which costs a redo there, never a rejected verified face.
 */
export type IdentityStatus = 'verified' | 'likely' | 'mismatch' | 'inconclusive' | 'unchecked';
export type FacePolicy = 'strict' | 'pose-aware';
export const FACE_TURNED_FLOOR = 0.68;
/** Landmark head turn beyond which the face counts as turned (Sienna facing the camera stays under ~0.3). */
export const TURNED_YAW = 0.35;
export const TURNED_EYE_RATIO = 0.38;
const REAR_POSE_RE = new RegExp(
  '\\b(' +
    [
      'from behind', '(camera|photographer|viewer) (is )?(directly )?behind her', '(back|rear)[\\s-]+view', 'seen from (the )?back', 'from the back',
      '(her )?back (is )?(fully |turned |facing )*(to|toward|towards) the (camera|viewer)',
      '(fac(e|es|ing)|turn(s|ed|ing)?|look(s|ing)?|walk(s|ing)?) away', 'away from the (camera|viewer)',
      'looking back', 'over (her|the|his) shoulder', 'profile view', 'side profile',
    ].join('|') +
    ')\\b',
  'i',
);

/** The request itself turns her face away: a from-behind pose, the looking-back preset, or a rear pose pack. Reads
 * the pose, framing and extra fields (a "rear-view photograph" usually sits in Framing). */
export function rearRequest(poseText: string, posePresetId: string | null | undefined, rearPack: boolean): boolean {
  return rearPack || posePresetId === 'looking_back' || posePresetId === 'bent_over_rear' || REAR_POSE_RE.test(poseText);
}

export function faceVerdict(
  face: FaceReport,
  rear: boolean,
  policy: FacePolicy = 'strict',
  opts: { referencePhoto?: boolean } = {},
): { status: IdentityStatus; reason: string } {
  const sim = face.similarity;
  if (face.found === false || sim === null) {
    return policy === 'strict' ? { status: 'unchecked', reason: 'no face was found' } : { status: 'inconclusive', reason: 'no face was found' };
  }
  if (typeof face.size === 'number' && face.size < FACE_MIN_SIZE) {
    const reason = 'her face is too small to judge';
    return policy === 'strict' ? { status: 'unchecked', reason } : { status: 'inconclusive', reason };
  }
  if (sim >= FACE_THRESHOLD) return { status: 'verified', reason: '' };
  if (policy === 'strict' && rear) return { status: 'inconclusive', reason: 'her face is turned away (a rear view was asked for)' };
  if (policy === 'strict' && !rear && sim >= FACE_LIKELY) {
    if (typeof face.hairRel === 'number' && face.hairRel > HAIR_LIGHTER) return { status: 'mismatch', reason: 'her hair came out much lighter than hers' };
    if (opts.referencePhoto) return { status: 'mismatch', reason: "didn't look enough like Sienna (a reference photo shaped this one, so only a confirmed match counts)" };
    return { status: 'likely', reason: '' };
  }
  if (policy === 'pose-aware') {
    const turned = rear || (face.yaw ?? 0) > TURNED_YAW || (face.eyeRatio ?? 1) < TURNED_EYE_RATIO;
    if (turned && sim >= FACE_TURNED_FLOOR) return { status: 'inconclusive', reason: 'her face is turned away' };
  }
  return { status: 'mismatch', reason: "didn't look enough like Sienna" };
}

/** False when a full-body request came back as a closer shot (the face check favours bigger faces on retries). */
export function framingOk(fullBody: boolean, faceSize: number | null | undefined, imageHeight: number): boolean {
  return !fullBody || !faceSize || faceSize <= FULL_BODY_MAX_FACE * imageHeight;
}

/** The check node, reading the image that goes into `saveNodeId`. */
export function faceNode(graph: ComfyGraph, saveNodeId: string): ComfyGraph[string] | null {
  const images = graph[saveNodeId]?.inputs?.images;
  if (!Array.isArray(images)) return null;
  return {
    class_type: FACE_NODE_CLASS,
    inputs: { images, reference: JSON.stringify(SIENNA_FACE_EMBEDDING), threshold: FACE_THRESHOLD, min_face: FACE_MIN_SIZE },
    _meta: { title: 'Face check (identity)' },
  };
}

export function parseFace(texts: string[] | undefined): FaceReport | null {
  try {
    const r = JSON.parse(texts?.[0] ?? '');
    if (!r || typeof r !== 'object') return null;
    const first = Array.isArray(r.images) ? r.images[0] : undefined;
    const num = (v: unknown) => (typeof v === 'number' ? v : null);
    return {
      available: r.available !== false,
      ok: r.ok !== false,
      similarity: num(r.similarity),
      size: num(first?.size),
      found: typeof first?.found === 'boolean' ? first.found : undefined,
      yaw: num(first?.yaw),
      eyeRatio: num(first?.eye_ratio),
      hairRel: num(first?.hair_rel),
      skinHue: num(first?.skin_hue),
      mono: first?.mono === true,
      error: r.error ?? undefined,
    };
  } catch {
    return null;
  }
}

/**
 * The face-check outcome when no verdict came back. With Sienna Lock off the photo isn't meant to be Sienna, so
 * identity doesn't apply. Otherwise verification was expected and could not happen — turned off, not installed on
 * the GPU, failed to load, or no result — and the photo is filed in Needs Review as "Face check unavailable".
 */
export function missingIdentity(
  rec: Pick<GenerationRecord, 'siennaLock' | 'params' | 'exposureGuard'>,
  faceProblem?: string,
): NonNullable<GenerationRecord['identityCheck']> {
  if (!rec.siennaLock) return { status: 'not_applicable', similarity: null, reason: 'Sienna Lock was off' };
  const guard = rec.exposureGuard;
  const reason =
    faceProblem ??
    (rec.params.faceCheck === false
      ? 'the face check was turned off for this photo'
      : guard?.status === 'unavailable' && guard.reason
        ? `the face check could not run (${guard.reason})`
        : 'the face check is not available on the GPU');
  return { status: 'unavailable', similarity: null, reason };
}

/**
 * Outcome for a single photo with no retries (Edit Outfit results): the strict rule on its face-check report, and
 * "unavailable" when the check didn't run or returned nothing. Never verified without a passing score.
 */
export function singlePhotoIdentity(
  rec: Pick<GenerationRecord, 'siennaLock' | 'params' | 'exposureGuard'>,
  face: FaceReport | null,
  notRunReason?: string,
): NonNullable<GenerationRecord['identityCheck']> {
  if (!face) return missingIdentity(rec, notRunReason ?? 'the face check returned no result');
  if (!face.available) return missingIdentity(rec, `the face check could not run (${face.error ?? 'models not installed'})`);
  const v = faceVerdict(face, false, 'strict');
  if (v.status === 'verified') return { status: 'verified', similarity: face.similarity };
  if (v.status === 'likely') return { status: 'likely', similarity: face.similarity };
  if (v.status === 'unchecked') return { status: 'unchecked', similarity: face.similarity, reason: v.reason };
  return { status: 'unconfirmed', similarity: face.similarity, reason: v.reason };
}
