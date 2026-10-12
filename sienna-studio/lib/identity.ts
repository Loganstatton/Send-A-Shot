/**
 * Face check: after each Sienna photo, SiennaFaceCheck (OpenCV SFace, Apache-2.0) compares the main face with
 * Sienna's reference embedding — the mean of four approved photos, which score 0.88–0.93 against it. A photo
 * below FACE_THRESHOLD is redone with a new seed (shares the retry budget with the top check) — unless her face is
 * turned away, see faceVerdict. Faces smaller than FACE_MIN_SIZE px can't be judged: their embedding is too noisy.
 */
import reference from './sienna-face-reference.json';
import type { ComfyGraph } from './types';

export const FACE_NODE_ID = 'sienna_face';
export const FACE_NODE_CLASS = 'SiennaFaceCheck';
export const FACE_THRESHOLD = 0.74;
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
 * 'unchecked': not retried (another seed wouldn't help), never a match, filed in Needs Review.
 *
 * Experimental ('pose-aware', only with SIENNA_EXPERIMENTAL=true): a turned face scoring between FACE_TURNED_FLOOR
 * and FACE_THRESHOLD is 'inconclusive' — not retried, filed in Needs Review. Faster on from-behind shots but it
 * verified fewer photos in the A/B, so it is not used in production.
 *
 * Hair and skin colour are measured by the GPU node but play no part in any decision: in the A/B they misflagged
 * 15 of 171 blind-confirmed Sienna photos under backlight.
 */
export type IdentityStatus = 'verified' | 'mismatch' | 'inconclusive' | 'unchecked';
export type FacePolicy = 'strict' | 'pose-aware';
export const FACE_TURNED_FLOOR = 0.68;
/** Landmark head turn beyond which the face counts as turned (Sienna facing the camera stays under ~0.3). */
export const TURNED_YAW = 0.35;
export const TURNED_EYE_RATIO = 0.38;
const REAR_POSE_RE =
  /\b(from behind|behind her|back view|rear view|seen from (the )?back|back to the camera|facing away|turned away|looking back|over (her|the|his) shoulder|profile view|side profile)\b/i;

/** The request itself turns her face away: a from-behind pose, the looking-back preset, or a rear pose pack. */
export function rearRequest(poseText: string, posePresetId: string | null | undefined, rearPack: boolean): boolean {
  return rearPack || posePresetId === 'looking_back' || REAR_POSE_RE.test(poseText);
}

export function faceVerdict(face: FaceReport, rear: boolean, policy: FacePolicy = 'strict'): { status: IdentityStatus; reason: string } {
  const sim = face.similarity;
  if (face.found === false || sim === null) {
    return policy === 'strict' ? { status: 'unchecked', reason: 'no face was found' } : { status: 'inconclusive', reason: 'no face was found' };
  }
  if (typeof face.size === 'number' && face.size < FACE_MIN_SIZE) {
    const reason = 'her face is too small to judge';
    return policy === 'strict' ? { status: 'unchecked', reason } : { status: 'inconclusive', reason };
  }
  if (sim >= FACE_THRESHOLD) return { status: 'verified', reason: '' };
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
