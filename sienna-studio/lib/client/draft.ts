'use client';

import { useCallback, useEffect, useState } from 'react';
import { DEFAULT_PARAMS, EMPTY_FIELDS } from '../defaults';
import type { ContentMode, GenerationImages, GenerationParams, PromptFields } from '../types';

/** The in-progress Create-screen state. Persisted on-device so switching tabs never loses work. */
export interface Draft {
  presetId: string | null;
  workflowId: string | null;
  siennaLock: boolean;
  contentMode: ContentMode;
  fields: PromptFields;
  params: GenerationParams;
  images: GenerationImages;
  parentId?: string;
}

const KEY = 'sienna.draft.v1';

export const emptyDraft = (): Draft => ({
  presetId: 'iphone-selfie',
  workflowId: null,
  siennaLock: true,
  contentMode: 'sfw',
  fields: { ...EMPTY_FIELDS },
  params: { ...DEFAULT_PARAMS },
  images: { initImage: null, poseImage: null, faceReferenceId: null, outfitImage: null },
});

function read(): Draft | null {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return null;
    const d = JSON.parse(raw) as Draft;
    const base = emptyDraft();
    return { ...base, ...d, fields: { ...base.fields, ...d.fields }, params: { ...base.params, ...d.params }, images: { ...base.images, ...d.images } };
  } catch {
    return null;
  }
}

export function writeDraft(d: Draft) {
  try {
    localStorage.setItem(KEY, JSON.stringify(d));
  } catch {}
}

const PHOTO_SLOTS = ['initImage', 'poseImage', 'outfitImage', 'outfitGarmentImage'] as const;

/** Photos saved in the draft that the server no longer has (its storage can reset on restart). */
async function missingPhotos(d: Draft): Promise<(typeof PHOTO_SLOTS)[number][]> {
  const slots = PHOTO_SLOTS.filter((k) => d.images[k]?.file);
  const gone = await Promise.all(
    slots.map((k) =>
      fetch(`/api/files/${d.images[k]!.file}`, { method: 'HEAD', cache: 'no-store' })
        .then((r) => r.status === 404 || r.status === 410)
        .catch(() => false),
    ),
  );
  return slots.filter((_, i) => gone[i]);
}

export function useDraft() {
  const [draft, setDraftState] = useState<Draft | null>(null);
  const [isNew, setIsNew] = useState(false);
  const [droppedPhotos, setDroppedPhotos] = useState(0);

  useEffect(() => {
    const d = read();
    setIsNew(!d);
    setDraftState(d ?? emptyDraft());
    if (!d) return;
    missingPhotos(d).then((gone) => {
      if (!gone.length) return;
      setDroppedPhotos(gone.length);
      setDraftState((prev) => {
        const next = { ...(prev ?? d), images: { ...(prev ?? d).images } };
        for (const k of gone) next.images[k] = null;
        writeDraft(next);
        return next;
      });
    });
  }, []);

  const setDraft = useCallback((update: Draft | ((d: Draft) => Draft)) => {
    setDraftState((prev) => {
      const next = typeof update === 'function' ? update(prev ?? emptyDraft()) : update;
      writeDraft(next);
      return next;
    });
  }, []);

  return { draft, setDraft, isNew, droppedPhotos };
}
