/**
 * Face check: after each Sienna photo, SiennaFaceCheck (OpenCV SFace, Apache-2.0) compares the main face with
 * Sienna's reference embedding — the mean of four approved photos, which score 0.88–0.93 against it. A photo
 * below FACE_THRESHOLD is redone with a new seed (shares the retry budget with the top check). Faces smaller
 * than FACE_MIN_SIZE px always pass: their embedding is too noisy to judge.
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
  error?: string;
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
    const size = Array.isArray(r.images) && typeof r.images[0]?.size === 'number' ? r.images[0].size : null;
    return { available: r.available !== false, ok: r.ok !== false, similarity: typeof r.similarity === 'number' ? r.similarity : null, size, error: r.error ?? undefined };
  } catch {
    return null;
  }
}
