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
export async function regenerate(rec: GenerationRecord, newSeed: boolean): Promise<GenerationRecord> {
  const body: GenerateRequest = {
    presetId: rec.presetId,
    workflowId: rec.workflowId,
    siennaLock: rec.siennaLock,
    contentMode: rec.contentMode,
    fields: rec.fields,
    params: { ...rec.params, seed: newSeed ? -1 : rec.seed },
    images: { initImage: rec.initImage, poseImage: rec.poseImage, faceReferenceId: rec.faceReference?.id ?? null },
    parentId: rec.id,
  };
  const next = await api<GenerationRecord>('/api/generate', { method: 'POST', json: body });
  trackJob(next.id);
  return next;
}
