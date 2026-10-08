/**
 * Outfit analysis job: upload the outfit photo, isolate the garment, caption
 * it with Florence-2. Two short requests (start + poll) like generations, so
 * nothing depends on long-lived connections through the Render/Runpod proxies.
 */

import 'server-only';
import { ComfyError, createBackend } from '../comfy/client';
import { missingModelFile } from '../comfy/model-files';
import { analyzeCaption, buildOutfitAnalysisGraph, OutfitAnalysis } from '../outfit';
import type { StoredImage } from '../types';
import { describeMissing, GenerationError } from './generate';
import { getComfyUrl, mimeFromBytes, newId, readImage, storeImage } from './store';

export type OutfitAnalysisState =
  | { state: 'pending' | 'running'; position?: number }
  | { state: 'error'; error: string }
  | ({ state: 'done'; preview: StoredImage | null } & OutfitAnalysis);

export async function startOutfitAnalysis(image: StoredImage): Promise<{ promptId: string }> {
  const backend = createBackend(await getComfyUrl());
  const { bytes, mime } = await readImage(image.file);
  const probe = buildOutfitAnalysisGraph('probe.png');
  // Check node classes and model files first so the user gets a clear reason, not a ComfyUI stack trace.
  const classes = [...new Set(Object.values(probe).map((n) => n.class_type))];
  const missing: string[] = [];
  await Promise.all(
    classes.map(async (c) => {
      try {
        if (!(await backend.nodeInfo(c))) missing.push(c);
      } catch {
        /* unreachable → /prompt reports it */
      }
    }),
  );
  if (missing.length) throw new GenerationError(`Outfit analysis can't run — server is missing ${describeMissing(missing.sort())}.`);
  const fileProblem = await missingModelFile(backend, probe, Object.keys(probe));
  if (fileProblem) throw new GenerationError(`Outfit analysis can't run — ${fileProblem}.`);
  try {
    const name = await backend.uploadImage(bytes, image.file, mime);
    return backend.queuePrompt(buildOutfitAnalysisGraph(name), newId('outfit-'));
  } catch (e) {
    if (e instanceof ComfyError) throw new GenerationError(`Outfit analysis failed: ${e.message}`, e.status, e.details);
    throw e;
  }
}

export async function outfitAnalysisStatus(promptId: string): Promise<OutfitAnalysisState> {
  const backend = createBackend(promptId.startsWith('mock-') ? 'mock' : await getComfyUrl());
  const s = await backend.jobState(promptId, []);
  switch (s.state) {
    case 'pending':
      return { state: 'pending', position: s.position };
    case 'running':
      return { state: 'running' };
    case 'unknown':
      return { state: 'pending' };
    case 'error':
      return { state: 'error', error: s.message };
    case 'done': {
      const caption = (s.texts ?? []).join(' ').trim();
      let preview: StoredImage | null = null;
      if (s.images[0]) {
        const { bytes, mime } = await backend.fetchImage(s.images[0]);
        preview = await storeImage(bytes, mimeFromBytes(bytes) ?? mime, 'up', 'Outfit garment preview');
      }
      return { state: 'done', preview, ...analyzeCaption(caption) };
    }
  }
}
