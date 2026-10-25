/**
 * Small one-off ComfyUI jobs (outfit analysis, pose check): check the server has every node
 * class and model file the graph needs (clear message instead of a ComfyUI stack trace),
 * upload the image, queue the graph.
 */

import 'server-only';
import { ComfyBackend, ComfyError, createBackend } from '../comfy/client';
import { missingModelFile } from '../comfy/model-files';
import type { ComfyGraph, StoredImage } from '../types';
import { describeMissing, GenerationError } from './generate';
import { getComfyUrl, readImage } from './store';

export async function preflight(backend: ComfyBackend, graph: ComfyGraph, what: string) {
  const classes = [...new Set(Object.values(graph).map((n) => n.class_type))];
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
  if (missing.length) throw new GenerationError(`${what} can't run — server is missing ${describeMissing(missing.sort())}.`);
  const fileProblem = await missingModelFile(backend, graph, Object.keys(graph));
  if (fileProblem) throw new GenerationError(`${what} can't run — ${fileProblem}.`);
}

/** Upload `image`, build the graph with its ComfyUI name, check it, queue it. */
export async function queueImageJob(image: StoredImage, build: (uploadedName: string) => ComfyGraph, what: string, idPrefix: string) {
  const backend = createBackend(await getComfyUrl());
  await preflight(backend, build('probe.png'), what);
  try {
    const { bytes, mime } = await readImage(image.file);
    const name = await backend.uploadImage(bytes, image.file, mime);
    return await backend.queuePrompt(build(name), `${idPrefix}${Date.now().toString(36)}`);
  } catch (e) {
    if (e instanceof ComfyError) throw new GenerationError(`${what} failed: ${e.message}`, e.status, e.details);
    throw e;
  }
}

// ── Status of one-off analysis jobs (pose check, outfit analysis) ──

/** A finished job's result, kept so repeated polls don't download and store its images again. */
const doneCache = new Map<string, unknown>();
export function cachedResult<T>(promptId: string): T | undefined {
  return doneCache.get(promptId) as T | undefined;
}
export function cacheResult<T>(promptId: string, value: T): T {
  doneCache.set(promptId, value);
  if (doneCache.size > 200) doneCache.delete(doneCache.keys().next().value as string);
  return value;
}

/** ComfyUI's state for a job, asked a second time when it reads unknown (history is read before the queue, so a job
 * finishing in between looks unknown once). Still unknown = the GPU no longer has it (restarted or stopped). */
export async function settledJobState(backend: import('../comfy/client').ComfyBackend, promptId: string) {
  const s = await backend.jobState(promptId, []);
  return s.state === 'unknown' ? backend.jobState(promptId, []) : s;
}
