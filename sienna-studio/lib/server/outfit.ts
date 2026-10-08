/**
 * Outfit analysis jobs. Two short requests (start + poll) like generations, so nothing
 * depends on long-lived connections through the Render/Runpod proxies.
 *
 *   isolation 'person' (default): person minus face box on grey → Florence-2 caption.
 *   isolation 'garment' (experimental): Florence-2 segments the named garment pieces →
 *     garment-only crop with a flat silhouette for fit context → caption of the crop.
 *     The crop is returned as `preview` and is what generation uses in garment mode.
 */

import 'server-only';
import { createBackend } from '../comfy/client';
import {
  analyzeCaption,
  buildGarmentIsolationGraph,
  buildOutfitAnalysisGraph,
  GARMENT_ISOLATE_NODE,
  OUTFIT_CAPTION_NODE,
  OUTFIT_PREVIEW_NODE,
  OutfitAnalysis,
} from '../outfit';
import type { StoredImage } from '../types';
import { queueImageJob } from './jobs';
import { getComfyUrl, mimeFromBytes, storeImage } from './store';

export type OutfitIsolationResult = 'person' | 'garment' | 'fallback-person';

export type OutfitAnalysisState =
  | { state: 'pending' | 'running'; position?: number }
  | { state: 'error'; error: string }
  | ({ state: 'done'; preview: StoredImage | null; isolation: OutfitIsolationResult } & OutfitAnalysis);

export async function startOutfitAnalysis(
  image: StoredImage,
  opts: { isolation?: 'person' | 'garment'; phrases?: string[] } = {},
): Promise<{ promptId: string }> {
  if (opts.isolation === 'garment') {
    const phrases = (opts.phrases ?? []).map((p) => p.trim().slice(0, 60)).filter(Boolean);
    return queueImageJob(image, (name) => buildGarmentIsolationGraph(name, phrases), 'Garment isolation', 'garment-');
  }
  return queueImageJob(image, buildOutfitAnalysisGraph, 'Outfit analysis', 'outfit-');
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
      const caption = (s.texts?.[OUTFIT_CAPTION_NODE] ?? []).join(' ').trim();
      const mode = s.texts?.[GARMENT_ISOLATE_NODE]?.[0];
      const isolation: OutfitIsolationResult = mode === 'garment' ? 'garment' : mode === 'fallback-person' ? 'fallback-person' : 'person';
      let preview: StoredImage | null = null;
      const ref = s.images.find((i) => i.nodeId === OUTFIT_PREVIEW_NODE) ?? s.images[0];
      if (ref) {
        const { bytes, mime } = await backend.fetchImage(ref);
        preview = await storeImage(bytes, mimeFromBytes(bytes) ?? mime, 'up', isolation === 'garment' ? 'Outfit garment-only crop' : 'Outfit garment preview');
      }
      const analysis = analyzeCaption(caption);
      if (isolation === 'fallback-person') {
        analysis.notes.unshift('Garment segmentation found nothing — this used the whole-person crop instead (garment mode will not be applied).');
      }
      return { state: 'done', preview, isolation, ...analysis };
    }
  }
}
