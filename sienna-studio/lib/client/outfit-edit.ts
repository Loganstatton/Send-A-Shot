'use client';

import { api, fileUrl, uploadImage } from './api';
import { trackJob } from './jobs';
import type { BodyProtect, OutfitEditFace, OutfitEditFootwear, OutfitEditScope } from '../outfit-edit';
import type { GenerationRecord, StoredImage } from '../types';

export interface OutfitEditAvailability {
  enabled: boolean;
  available: boolean;
  backend: 'comfyui' | 'mock';
  missing: string[];
  experiments: boolean;
  protectMissing: Record<keyof BodyProtect, string[]>;
  bodyRefCount: number;
  redrawMissing: string[];
}

export interface OutfitEditBody {
  sourceId: string;
  imageIndex?: number;
  reference: StoredImage;
  manualCrop: boolean;
  description: string;
  scope: OutfitEditScope;
  footwear: OutfitEditFootwear;
  face: OutfitEditFace;
  seed: number;
  protect?: Partial<BodyProtect>;
  redraw?: boolean;
  avoid?: string;
}

export async function startOutfitEdit(body: OutfitEditBody): Promise<GenerationRecord> {
  const rec = await api<GenerationRecord>('/api/outfit-edit', { method: 'POST', json: body });
  trackJob(rec.id);
  return rec;
}

/** Run an existing edit again on the same source image (same seed, or a new one). */
export function rerunOutfitEdit(rec: GenerationRecord, newSeed: boolean): Promise<GenerationRecord> {
  const e = rec.outfitEdit!;
  return startOutfitEdit({
    sourceId: e.sourceId,
    reference: e.reference,
    manualCrop: e.manualCrop,
    description: e.description,
    scope: e.scope,
    footwear: e.footwear,
    face: e.face,
    seed: newSeed ? -1 : rec.seed,
    ...(e.protect ? { protect: e.protect } : {}),
    ...(e.redraw ? { redraw: true } : {}),
    ...(e.avoid ? { avoid: e.avoid } : {}),
  });
}

/** Cut the top `cut` fraction off an uploaded image in the browser and upload the result. */
export async function cropTopAndUpload(img: StoredImage, cut: number): Promise<StoredImage> {
  const el = new Image();
  el.src = fileUrl(img.file);
  await el.decode();
  const top = Math.round(el.naturalHeight * Math.min(0.9, Math.max(0, cut)));
  const canvas = document.createElement('canvas');
  canvas.width = el.naturalWidth;
  canvas.height = el.naturalHeight - top;
  canvas.getContext('2d')!.drawImage(el, 0, top, canvas.width, canvas.height, 0, 0, canvas.width, canvas.height);
  const blob = await new Promise<Blob>((res, rej) => canvas.toBlob((b) => (b ? res(b) : rej(new Error('Could not crop the photo'))), 'image/png'));
  return uploadImage(new File([blob], 'clothing-crop.png', { type: 'image/png' }), 'up', 'Edit Outfit clothing crop (manual)');
}
