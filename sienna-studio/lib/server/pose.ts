import 'server-only';
import { createBackend } from '../comfy/client';
import { posePadding } from '../comfy/quality';
import { FramingLevel, skeletonExtent } from '../framing';
import { buildPoseCheckGraph, firstBody, POSE_DETECT_NODE, POSE_RETARGET_NODE, POSE_RETARGET_PREVIEW, POSE_SKELETON_PREVIEW } from '../pose-check';
import { poseProportions } from '../pose-proportions';
import type { StoredImage } from '../types';
import { queueImageJob } from './jobs';
import { experimentsEnabled, getComfyUrl, mimeFromBytes, storeImage } from './store';

export type PoseCheckState =
  | { state: 'pending' | 'running'; position?: number }
  | { state: 'error'; error: string }
  | {
      state: 'done';
      skeleton: StoredImage | null;
      retargeted: StoredImage | null;
      /** Normalized OpenPose-18 body keypoints of the first person (after padding), or null. */
      keypoints: number[] | null;
      extent: FramingLevel | null;
      /** Retarget factor per bone group (1 = unchanged). */
      factors: Record<string, number> | null;
      proportionsSource: 'sienna' | 'generic';
      people: number;
    };

export async function startPoseCheck(
  image: StoredImage,
  opts: { width: number; height: number; fit: 'crop' | 'pad'; retarget: number },
): Promise<{ promptId: string }> {
  const pad = opts.fit === 'pad' ? posePadding(image.width, image.height, opts.width, opts.height) : null;
  if (!experimentsEnabled()) opts = { ...opts, retarget: 0 };
  const props = poseProportions().values;
  return queueImageJob(image, (name) => buildPoseCheckGraph(name, { pad, retarget: opts.retarget, proportions: props }), 'Pose check', 'pose-');
}

export async function poseCheckStatus(promptId: string): Promise<PoseCheckState> {
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
      const save = async (node: string, label: string) => {
        const ref = s.images.find((i) => i.nodeId === node);
        if (!ref) return null;
        const { bytes, mime } = await backend.fetchImage(ref);
        return storeImage(bytes, mimeFromBytes(bytes) ?? mime, 'up', label);
      };
      const raw = s.poses?.[POSE_DETECT_NODE]?.[0];
      const body = firstBody(raw);
      let people = 0;
      try {
        const parsed = raw ? JSON.parse(raw) : null;
        people = (Array.isArray(parsed) ? parsed[0] : parsed)?.people?.length ?? 0;
      } catch {
        /* keep 0 */
      }
      let factors: Record<string, number> | null = null;
      try {
        const t = s.texts?.[POSE_RETARGET_NODE]?.[0];
        if (t) factors = JSON.parse(t)[0] ?? null;
      } catch {
        /* none */
      }
      return {
        state: 'done',
        skeleton: await save(POSE_SKELETON_PREVIEW, 'Pose skeleton'),
        retargeted: await save(POSE_RETARGET_PREVIEW, 'Retargeted pose skeleton'),
        keypoints: body?.flat ?? null,
        extent: skeletonExtent(body?.flat),
        factors,
        proportionsSource: poseProportions().source,
        people,
      };
    }
  }
}
