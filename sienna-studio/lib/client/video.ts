'use client';

import { api, ApiError } from './api';
import { trackJob } from './jobs';
import type { CameraMove, VideoMode, VideoQuality, VideoResolution } from '../video';
import type { MovementKind } from '../video-framing';
import type { GenerationRecord, StoredImage, StoredVideo } from '../types';

export interface VideoAvailability {
  enabled: boolean;
  backend: 'comfyui' | 'mock';
  ffmpeg: boolean;
  modes: Record<VideoMode, { available: boolean; missing: string[] }>;
  faceCheck: boolean;
  adultAllowed: boolean;
  motionEngine: 'scail2' | 'animate2' | 'animate1';
  safeFraming: { available: boolean; missing: string[] };
  lockCamera: { available: boolean; missing: string[] };
  experiments: boolean;
  gpu?: {
    mode: 'on-demand' | 'settings-url';
    status: 'off' | 'starting' | 'ready' | 'stopping' | 'stopped' | 'failed';
    gpu?: string;
    rate?: number;
    since?: string;
    phase?: string;
    error?: string;
    sessionUsd?: number;
    monthUsd: number;
    budgetUsd: number;
    idleMin?: number;
    missing?: string[];
  };
  storage?: { totalBytes: number; freeBytes: number; videoBytes: number; videoCount: number };
}

export function stopVideoGpu() {
  return api<VideoAvailability['gpu']>('/api/video-gpu/stop', { method: 'POST' });
}

export interface DrivingVideo {
  video: StoredVideo;
  poster: StoredImage;
}

export interface VideoBody {
  mode: VideoMode;
  sourceId: string;
  imageIndex?: number;
  seed: number;
  quality: VideoQuality;
  resolution: VideoResolution;
  motion?: string;
  camera?: CameraMove;
  seconds?: number;
  drive?: DrivingVideo;
  start?: number;
  scene?: string;
  framing?: MovementKind | null;
  facing?: 'camera' | 'away';
  background?: 'photo' | 'clip';
  lockCamera?: boolean;
}

export async function startVideo(body: VideoBody): Promise<GenerationRecord> {
  const rec = await api<GenerationRecord>('/api/video', { method: 'POST', json: body });
  trackJob(rec.id);
  return rec;
}

/** Make the same video again (same seed) or a variation (new seed). */
export function rerunVideo(rec: GenerationRecord, newSeed: boolean): Promise<GenerationRecord> {
  const v = rec.video!;
  return startVideo({
    mode: v.mode,
    sourceId: v.sourceId,
    imageIndex: v.imageIndex ?? 0,
    seed: newSeed ? -1 : rec.seed,
    quality: v.quality,
    resolution: v.resolution,
    ...(v.mode === 'animate' ? { motion: v.motion ?? '', camera: v.camera, seconds: v.seconds } : {}),
    ...(v.mode === 'motion' && v.drive ? { drive: { video: v.drive.video, poster: v.drive.poster }, start: v.drive.start, seconds: v.drive.seconds, scene: v.scene ?? '' } : {}),
    framing: v.safeFraming?.movement ?? null,
    ...(v.facing ? { facing: v.facing } : {}),
    ...(v.background ? { background: v.background } : {}),
    lockCamera: !!v.lockCamera,
  });
}

/**
 * Upload a driving video with progress (fetch can't report upload progress). The file goes as the raw body, so the
 * server streams it to disk instead of holding it in memory.
 */
export function uploadDrivingVideo(file: File, onProgress: (fraction: number) => void): Promise<DrivingVideo> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('POST', '/api/video/upload');
    xhr.setRequestHeader('Content-Type', file.type || 'application/octet-stream');
    xhr.upload.onprogress = (e) => e.lengthComputable && onProgress(e.loaded / e.total);
    xhr.onload = () => {
      let data: any = null;
      try {
        data = JSON.parse(xhr.responseText);
      } catch {}
      if (xhr.status === 401) window.location.href = `/login?next=${encodeURIComponent(window.location.pathname)}`;
      if (xhr.status >= 200 && xhr.status < 300 && data?.video) resolve(data);
      else reject(new ApiError(data?.error || `Upload failed (${xhr.status})`, xhr.status));
    };
    xhr.onerror = () => reject(new ApiError('Upload failed — check your connection and try again.', 0));
    xhr.send(file);
  });
}

/** Save/share a video: the iPhone share sheet offers "Save Video" → Photos. */
export async function shareVideo(url: string, filename: string): Promise<'shared' | 'downloaded' | 'cancelled'> {
  try {
    const res = await fetch(url);
    const blob = await res.blob();
    const file = new File([blob], filename, { type: 'video/mp4' });
    const nav = navigator as Navigator & { canShare?: (d: ShareData) => boolean };
    if (nav.share && nav.canShare?.({ files: [file] })) {
      await nav.share({ files: [file] });
      return 'shared';
    }
  } catch (e: any) {
    if (e?.name === 'AbortError') return 'cancelled';
  }
  const a = document.createElement('a');
  a.href = `${url}?download=${encodeURIComponent(filename)}`;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  return 'downloaded';
}
