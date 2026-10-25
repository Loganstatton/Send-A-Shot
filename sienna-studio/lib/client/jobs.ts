'use client';

import { api } from './api';
import type { GenerateRequest, GenerationRecord } from '../types';

export const JOBS_KEY = 'sienna.activeJobs';

/** Remember a job so the Create screen shows and polls it. */
export function trackJob(id: string) {
  try {
    const ids: string[] = JSON.parse(sessionStorage.getItem(JOBS_KEY) || '[]');
    sessionStorage.setItem(JOBS_KEY, JSON.stringify([id, ...ids.filter((x) => x !== id)].slice(0, 6)));
  } catch {}
}

/** Re-run a history record. `newSeed` = variation; otherwise exact same seed. */
/** The request that re-makes a photo (Regenerate, and Edit & regenerate's starting point). */
export function requestFromRecord(rec: GenerationRecord, seed: number): GenerateRequest {
  return {
    presetId: rec.presetId,
    workflowId: rec.workflowId,
    siennaLock: rec.siennaLock,
    contentMode: rec.contentMode,
    fields: rec.fields,
    // the garment-only crop isn't kept on the record: re-run with the whole-person crop rather than fail
    params: { ...rec.params, seed, ...(rec.params.outfitIsolation === 'garment' ? { outfitIsolation: 'person' as const } : {}) },
    // the outfit photo too: without it the rerun dropped the clothing reference and drew a different outfit
    images: { initImage: rec.initImage, poseImage: rec.poseImage, faceReferenceId: rec.faceReference?.id ?? null, outfitImage: rec.outfitReference?.image ?? null },
    parentId: rec.id,
  };
}

export async function regenerate(rec: GenerationRecord, newSeed: boolean): Promise<GenerationRecord> {
  const body = requestFromRecord(rec, newSeed ? -1 : rec.seed);
  const next = await api<GenerationRecord>('/api/generate', { method: 'POST', json: body });
  trackJob(next.id);
  return next;
}
