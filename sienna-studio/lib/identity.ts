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
  /** Secondary colour signals (missing from older nodes): see sienna_face.appearance. */
  hairRel?: number | null;
  skinHue?: number | null;
  mono?: boolean;
  error?: string;
}

/**
 * Pose-aware verdict, three outcomes:
 *  - verified: similarity >= FACE_THRESHOLD, in any pose. The only outcome that counts as Sienna.
 *  - inconclusive: her face is turned away (a from-behind request or a measured head turn) and scores between
 *    FACE_TURNED_FLOOR and FACE_THRESHOLD, with hair and skin colour consistent with hers; or no face could be read.
 *    Not retried, never counted as a match, flagged in the gallery for the user to decide.
 *  - mismatch: anything else below the threshold. Redone with a new seed, as before.
 *
 * Calibration (offline, 2,000 photos; see docs/FACE_CHECK_CALIBRATION.md): unrelated women score at most 0.63, but
 * SDXL's own drifted lookalikes (brunette, same styling, different face) reach 0.74, so the floor sits where
 * replaying today's recorded retries delivers no more wrong-looking faces than the old rule: 0.68.
 */
export type IdentityStatus = 'verified' | 'mismatch' | 'inconclusive';
export const FACE_TURNED_FLOOR = 0.68;
/** Landmark head turn beyond which the face counts as turned (Sienna facing the camera stays under ~0.3). */
export const TURNED_YAW = 0.35;
export const TURNED_EYE_RATIO = 0.38;
/**
 * Secondary colour signals (never proof of identity; they can only stop an inconclusive photo from skipping its
 * retry). Hair over skin brightness is measured within the same photo, so the light cancels out: Sienna's dark-brown
 * hair stays at or below 0.65 in 99% of her photos, from shade to golden hour; above HAIR_REL_MAX means clearly
 * lighter (blonde/grey) hair. Her cheek skin hue stays 40-56 degrees; outside SKIN_HUE_RANGE is a different skin
 * tone (or strongly coloured light). Black-and-white photos are not judged.
 */
export const HAIR_REL_MAX = 1.0;
export const SKIN_HUE_RANGE: [number, number] = [30, 65];
const REAR_POSE_RE =
  /\b(from behind|behind her|back view|rear view|seen from (the )?back|back to the camera|facing away|turned away|looking back|over (her|the|his) shoulder|profile view|side profile)\b/i;

/** The request itself turns her face away: a from-behind pose, the looking-back preset, or a rear pose pack. */
export function rearRequest(poseText: string, posePresetId: string | null | undefined, rearPack: boolean): boolean {
  return rearPack || posePresetId === 'looking_back' || REAR_POSE_RE.test(poseText);
}

export type ColourCheck = { status: 'consistent' | 'differs' | 'unknown'; notes: string[] };

/** Hair and skin colour against Sienna's (secondary signal only). */
export function colourCheck(face: FaceReport): ColourCheck {
  if (face.mono) return { status: 'unknown', notes: ['black-and-white photo'] };
  const notes: string[] = [];
  const known = typeof face.hairRel === 'number' || typeof face.skinHue === 'number';
  if (typeof face.hairRel === 'number' && face.hairRel > HAIR_REL_MAX) notes.push('her hair looks much lighter than Sienna\'s dark brown');
  if (typeof face.skinHue === 'number' && (face.skinHue < SKIN_HUE_RANGE[0] || face.skinHue > SKIN_HUE_RANGE[1])) notes.push('her skin tone looks different from Sienna\'s');
  return { status: notes.length ? 'differs' : known ? 'consistent' : 'unknown', notes };
}

export function faceVerdict(face: FaceReport, rear: boolean): { status: IdentityStatus; reason: string; colour: ColourCheck } {
  const colour = colourCheck(face);
  const sim = face.similarity;
  if (face.found === false || sim === null) return { status: 'inconclusive', reason: 'no face was found', colour };
  if (typeof face.size === 'number' && face.size < FACE_MIN_SIZE) return { status: 'inconclusive', reason: 'her face is too small to judge', colour };
  if (sim >= FACE_THRESHOLD) return { status: 'verified', reason: '', colour };
  const turned = rear || (face.yaw ?? 0) > TURNED_YAW || (face.eyeRatio ?? 1) < TURNED_EYE_RATIO;
  if (turned && sim >= FACE_TURNED_FLOOR) {
    if (colour.status === 'differs') return { status: 'mismatch', reason: `her face is turned away and ${colour.notes.join(' and ')}`, colour };
    return { status: 'inconclusive', reason: 'her face is turned away', colour };
  }
  return { status: 'mismatch', reason: "didn't look enough like Sienna", colour };
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
