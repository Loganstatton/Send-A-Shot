/**
 * Video Studio server side (see lib/video.ts for the pipelines and the reasons behind them).
 *
 * Optional and off by default: the tab and API only exist when SIENNA_VIDEO=true. The GPU needs the Wan2.2 files
 * (`comfyui-bootstrap.sh --with-wan-video`, ~60 GB) and, for Copy Motion, comfyui_controlnet_aux (DWPose).
 *
 * Results are new history records (parentId = the photo's record): `images` holds the poster frame and
 * `video.result` the MP4. The source record and its files are never modified. Polling reuses
 * GET /api/history/:id/status, which routes video records here.
 */

import 'server-only';
import { createWriteStream, promises as fs } from 'node:fs';
import path from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { ComfyBackend, ComfyError, createBackend } from '../comfy/client';
import { builtinWorkflows, PRIMARY_WORKFLOW_ID } from '../comfy/builtin-workflows';
import { ADULT_ONLY_NEGATIVE, MIN_CHARACTER_AGE, SFW_NEGATIVE } from '../defaults';
import { applyIdentityLock, findHardBlocks } from '../guard';
import { FACE_MIN_SIZE, FACE_THRESHOLD, SIENNA_FACE_EMBEDDING } from '../identity';
import type { ContentMode, GenerationRecord, SafeFrameReport, StoredImage, StoredVideo, VideoInfo } from '../types';
import {
  animateLength,
  animatePrompt,
  buildAnimateGraph,
  buildMotion2Graph,
  buildMotionGraph,
  CameraMove,
  MOTION2_FILES,
  MOTION2_NODE_CLASSES,
  motion2Chunks,
  motion2Prompt,
  motion2RearPrompt,
  MOTION2_REAR_TEXT,
  Facing,
  MotionEngine,
  estimateMinutes,
  FaceCheckSpec,
  LOCK_CAMERA_NODE_CLASSES,
  LockCameraReport,
  lockCameraAllowed,
  MAX_MOTION_SECONDS,
  motionChunks,
  motionPrompt,
  parseFrameFaces,
  parseLockCamera,
  SAFE_FRAME_NODE_CLASSES,
  SAFE_FRAME_NODES,
  SafeFrameSpec,
  slowMotionWords,
  VIDEO_FILES,
  VIDEO_FPS,
  VIDEO_MODE_LABELS,
  VIDEO_NODE_CLASSES,
  VIDEO_NODES,
  VideoMode,
  VideoQuality,
  VideoResolution,
  videoIdentity,
  videoNegativeExtras,
  videoSize,
  WAN_NEGATIVE,
} from '../video';
import { MOVEMENT_MARGINS, MovementKind } from '../video-framing';
import { FfmpegError, faststart, ffmpegPath, normaliseDrivingVideo, posterFrame, probeVideo, withTempDir } from './ffmpeg';
import {
  currentSession,
  ensureVideoGpu,
  estimateVideoUsd,
  GpuError,
  GpuView,
  startVideoGpuTimer,
  tickVideoGpu,
  touchVideoGpu,
  VideoGpuConfig,
  videoGpuConfig,
  videoGpuView,
} from './video-gpu';
import { describeMissing, GenerationError } from './generate';
import { preflight } from './jobs';
import {
  adultContentAllowed,
  experimentsEnabled,
  getCharacter,
  DATA_DIR,
  getComfyUrl,
  getRecord,
  IMAGES_DIR,
  listHistory,
  getSettings,
  mimeFromBytes,
  newId,
  patchRecord,
  readImage,
  readVideo,
  saveRecord,
  SAFE_VIDEO_RE,
  storeImage,
  storedFilePath,
  storeVideoFile,
} from './store';

export function videoEnabled(): boolean {
  return process.env.SIENNA_VIDEO === 'true';
}

/** Copy Motion model: Wan2.2-Animate-2 by default; SIENNA_MOTION_ENGINE=animate1 selects Wan2.2 Animate v1 (DWPose). */
export function motionEngine(): MotionEngine {
  return process.env.SIENNA_MOTION_ENGINE === 'animate1' ? 'animate1' : 'animate2';
}

const MOTION2_TEXT = 'a woman performing the movement from the reference video naturally, background stationary';

export const VIDEO_WORKFLOWS: Record<VideoMode, { id: string; name: string; model: VideoInfo['model'] }> = {
  animate: { id: 'video-wan22-i2v', name: 'Animate Image · Wan2.2 I2V 14B', model: 'wan2.2-i2v-14b' },
  motion: { id: 'video-wan22-animate', name: 'Copy Motion · Wan2.2 Animate 14B', model: 'wan2.2-animate-14b' },
};
const MOTION2_WORKFLOW = { id: 'video-wan22-animate2', name: 'Copy Motion · Wan2.2-Animate-2 14B', model: 'wan2.2-animate-2-14b' as const };

export interface VideoAvailability {
  enabled: boolean;
  backend: 'comfyui' | 'mock';
  /** The app server can process videos (driving-video upload, fast-start remux, mock videos). */
  ffmpeg: boolean;
  modes: Record<VideoMode, { available: boolean; missing: string[] }>;
  /** The frame face check is installed on the GPU (without it every video goes to Needs Review). */
  faceCheck: boolean;
  adultAllowed: boolean;
  motionEngine: MotionEngine;
  /** Safe framing (room around her for big movements): SiennaSafeFrame + the photo checkpoint to fill the room. */
  safeFraming: { available: boolean; missing: string[] };
  /** Lock Camera (stabilized copy of the video): SiennaLockCamera on the GPU server. */
  lockCamera: { available: boolean; missing: string[] };
  /** Testing-only options (hybrid sampler) are offered. */
  experiments: boolean;
  /** On-demand video GPU (VIDEO_GPU=runpod): its state, this month's spend and budget. */
  gpu?: GpuView;
  /** Free space on the app's disk (videos are refused when it runs low). */
  storage?: StorageInfo;
}

/** The SDXL checkpoint the photo generator uses (safe framing fills the added room with it; nothing is changed). */
function productionCheckpoint(): string {
  const wf = builtinWorkflows().find((w) => w.id === PRIMARY_WORKFLOW_ID);
  const node = wf ? Object.values(wf.graph).find((x) => x.class_type === 'CheckpointLoaderSimple') : undefined;
  return String(node?.inputs.ckpt_name ?? '');
}

async function photoCheckpoint(sourceCheckpoint?: string): Promise<string> {
  const settings = await getSettings();
  return sourceCheckpoint || settings.defaultParams.checkpoint || productionCheckpoint();
}

/** What the GPU server lacks for each mode (node classes and model files). */
export async function videoAvailability(comfyUrl?: string): Promise<VideoAvailability> {
  const enabled = videoEnabled();
  const gpu = videoGpuConfig();
  if (enabled && gpu && !comfyUrl) return onDemandAvailability(gpu.copyMotion);
  const backend = createBackend(comfyUrl ?? (await getComfyUrl()));
  const ffmpeg = !!(await ffmpegPath());
  const none = { available: false, missing: [] as string[] };
  const base = { enabled, backend: backend.kind, ffmpeg, adultAllowed: adultContentAllowed(), motionEngine: motionEngine(), experiments: experimentsEnabled() };
  if (!enabled) return { ...base, modes: { animate: none, motion: none }, faceCheck: false, safeFraming: none, lockCamera: none };
  const noFfmpeg = 'ffmpeg on the app server (npm install, or set FFMPEG_PATH)';
  if (backend.kind === 'mock') {
    const m = { available: ffmpeg, missing: ffmpeg ? [] : [noFfmpeg] };
    return { ...base, modes: { animate: m, motion: m }, faceCheck: false, safeFraming: m, lockCamera: m };
  }
  const check = async (mode: VideoMode) => {
    const missing: string[] = [];
    try {
      const absent: string[] = [];
      const v2 = mode === 'motion' && motionEngine() === 'animate2';
      await Promise.all(
        (v2 ? MOTION2_NODE_CLASSES : VIDEO_NODE_CLASSES[mode]).map(async (c) => {
          if (!(await backend.nodeInfo(c))) absent.push(c);
        }),
      );
      if (absent.length) missing.push(`${describeMissing(absent.sort())} — update ComfyUI / run comfyui-bootstrap.sh --with-wan-video`);
      for (const [cls, input, file] of v2 ? MOTION2_FILES : VIDEO_FILES[mode]) {
        const choices = await backend.inputChoices(cls, input);
        if (!choices.includes(file)) missing.push(`model file ${file}`);
      }
    } catch (e: any) {
      missing.push(`GPU server not reachable (${e.message})`);
    }
    if (mode === 'motion' && !ffmpeg) missing.push(noFfmpeg);
    return { available: missing.length === 0, missing };
  };
  const checkFraming = async () => {
    const missing: string[] = [];
    try {
      const absent: string[] = [];
      await Promise.all(
        SAFE_FRAME_NODE_CLASSES.map(async (c) => {
          if (!(await backend.nodeInfo(c))) absent.push(c);
        }),
      );
      if (absent.length) missing.push(`${describeMissing(absent.sort())} — run comfyui-bootstrap.sh (sienna_nodes)`);
      const ckpt = await photoCheckpoint();
      if (!ckpt) missing.push('a photo checkpoint (set one in Settings)');
      else if (!(await backend.inputChoices('CheckpointLoaderSimple', 'ckpt_name')).includes(ckpt)) missing.push(`model file ${ckpt}`);
    } catch (e: any) {
      missing.push(`GPU server not reachable (${e.message})`);
    }
    return { available: missing.length === 0, missing };
  };
  const checkLock = async () => {
    const missing: string[] = [];
    try {
      const absent: string[] = [];
      for (const c of LOCK_CAMERA_NODE_CLASSES) if (!(await backend.nodeInfo(c))) absent.push(c);
      if (absent.length) missing.push(`${describeMissing(absent)} — run comfyui-bootstrap.sh (sienna_nodes)`);
    } catch (e: any) {
      missing.push(`GPU server not reachable (${e.message})`);
    }
    return { available: missing.length === 0, missing };
  };
  const [animate, motion, safeFraming, lockCamera] = await Promise.all([check('animate'), check('motion'), checkFraming(), checkLock()]);
  let faceCheck = false;
  try {
    faceCheck = !!(await backend.nodeInfo('SiennaFaceCheck'));
  } catch {}
  return { ...base, modes: { animate, motion }, faceCheck, safeFraming, lockCamera, gpu: await videoGpuView(), storage: await storageInfo() };
}

// ── Driving video intake (Copy Motion) ───────────────────────────────────────

export const MAX_DRIVE_UPLOAD = 200 * 1024 * 1024;

export interface DrivingVideo {
  video: StoredVideo;
  poster: StoredImage;
}

/**
 * Store an uploaded driving video: streamed to a scratch file (never held in memory), normalised with ffmpeg to
 * 16 fps / ≤ 832 px / first 20 s, plus a poster frame. The original upload is discarded.
 */
export async function ingestDrivingVideo(body: ReadableStream<Uint8Array> | null, declaredBytes: number): Promise<DrivingVideo> {
  if (!videoEnabled()) throw new GenerationError('Video Studio is turned off on this server (SIENNA_VIDEO is not "true").', 403);
  if (!body) throw new GenerationError('No video was sent.');
  if (declaredBytes > MAX_DRIVE_UPLOAD) throw new GenerationError(`That video is too large (max ${MAX_DRIVE_UPLOAD / 1024 / 1024} MB). Trim it on your phone first.`, 413);
  if (!(await ffmpegPath())) throw new GenerationError('This server cannot process videos (ffmpeg is missing).', 500);
  return withTempDir(async (dir) => {
    const raw = path.join(dir, 'upload');
    let seen = 0;
    const limit = new TransformStream<Uint8Array, Uint8Array>({
      transform(chunk, ctrl) {
        seen += chunk.byteLength;
        if (seen > MAX_DRIVE_UPLOAD) ctrl.error(new GenerationError(`That video is too large (max ${MAX_DRIVE_UPLOAD / 1024 / 1024} MB).`, 413));
        else ctrl.enqueue(chunk);
      },
    });
    await pipeline(Readable.fromWeb(body.pipeThrough(limit) as any), createWriteStream(raw));
    const out = path.join(dir, 'drive.mp4');
    let probe;
    try {
      probe = await normaliseDrivingVideo(raw, out, VIDEO_FPS);
    } catch (e) {
      if (e instanceof FfmpegError) throw new GenerationError(`That file couldn't be used as a video: ${e.message}. Try an MP4 or MOV from your camera.`, 415);
      throw e;
    }
    if (probe.frames < VIDEO_FPS) throw new GenerationError('That video is too short — use at least 1 second of movement.', 422);
    const posterFile = path.join(dir, 'poster.jpg');
    await posterFrame(out, posterFile, 0);
    const poster = await storeImage(await fs.readFile(posterFile), 'image/jpeg', 'up', 'Copy Motion video');
    const video = await storeVideoFile(out, 'mot', { width: probe.width, height: probe.height, fps: VIDEO_FPS, frames: probe.frames, seconds: Math.round((probe.frames / VIDEO_FPS) * 100) / 100 });
    return { video, poster };
  });
}

// ── Start ───────────────────────────────────────────────────────────────────

export interface VideoRequest {
  mode: VideoMode;
  sourceId: string;
  imageIndex: number;
  seed: number;
  quality: VideoQuality;
  resolution: VideoResolution;
  /** Animate Image */
  motion?: string;
  camera?: CameraMove;
  seconds?: number;
  /** Safe framing: the movement she makes, so room for it is added around her (null / 'still' = off). */
  framing?: MovementKind | null;
  /** Copy Motion */
  drive?: DrivingVideo;
  start?: number;
  scene?: string;
  /** Copy Motion: 'away' = she is filmed from behind and must keep her back to the camera (rear-view prompt). */
  facing?: Facing;
  /** Lock Camera: also make a stabilized copy (background held still). Off by default; the natural video is always kept. */
  lockCamera?: boolean;
}

const faceSpec: FaceCheckSpec = { reference: JSON.stringify(SIENNA_FACE_EMBEDDING), threshold: FACE_THRESHOLD, minFace: FACE_MIN_SIZE };

interface VideoPlan {
  req: VideoRequest;
  source: GenerationRecord;
  sourceImage: StoredImage;
  info: VideoInfo;
  positive: string;
  negative: string;
  warnings: string[];
  contentMode: ContentMode;
  wf: { id: string; name: string };
  seed: number;
  width: number;
  height: number;
  movement: MovementKind | null;
  lockCamera: boolean;
  build: (imageName: string, videoName: string, face: FaceCheckSpec | null) => ReturnType<typeof buildAnimateGraph>;
}

export async function startVideo(req: VideoRequest): Promise<GenerationRecord> {
  if (!videoEnabled()) throw new GenerationError('Video Studio is turned off on this server (SIENNA_VIDEO is not "true").', 403);
  const plan = await planVideo(req);
  const gpu = videoGpuConfig();
  if (gpu) return queueForVideoGpu(plan, gpu);
  const backend = createBackend(await getComfyUrl());
  if (backend.kind !== 'mock') await checkGpuCanRun(plan, await videoAvailability());
  return submitPlan(plan, backend, null);
}

/** Everything about a video that doesn't need the GPU: checks, prompts, size, graph builder. */
async function planVideo(req: VideoRequest): Promise<VideoPlan> {
  const source = await getRecord(req.sourceId);
  if (!source) throw new GenerationError('The photo was not found.', 404);
  const sourceImage = source.images[req.imageIndex] ?? null;
  if (source.status !== 'done' || !sourceImage || source.video) throw new GenerationError('Choose a finished photo (not a video) to animate.');

  const character = await getCharacter();
  if ((character.age ?? 0) < MIN_CHARACTER_AGE) throw new GenerationError(`The character profile age must be at least ${MIN_CHARACTER_AGE}.`);
  const warnings: string[] = [];

  let contentMode: ContentMode = source.contentMode === 'adult' ? 'adult' : 'sfw';
  if (contentMode === 'adult' && !adultContentAllowed()) {
    contentMode = 'sfw';
    warnings.push('Adult mode is disabled on this server; made as SFW.');
  }

  // Free text goes through the same hard blocks and Sienna Lock as everything else.
  const raw = (req.mode === 'animate' ? req.motion : req.scene) ?? '';
  const blocked = findHardBlocks(raw);
  if (blocked.length) throw new GenerationError(`Blocked: ${blocked.map((b) => `“${b.term}” — ${b.reason}`).join(' ')}`, 422, blocked);
  const lock = applyIdentityLock(raw, character.extraLockedTerms);
  for (const r of lock.removed) warnings.push(`Sienna Lock removed “${r.term}” (${r.category} is locked).`);

  if (req.quality === 'hybrid' && !experimentsEnabled()) throw new GenerationError('Hybrid is a testing option — turn on experiments (SIENNA_EXPERIMENTAL=true) to use it.', 422);
  if (req.mode === 'animate') {
    const slow = slowMotionWords(lock.text);
    if (slow.length)
      warnings.push(
        `“${slow.join('”, “')}” asks for slow movement. Wan already tends to move slowly, so this usually looks like slow motion — describe the speed instead (e.g. “at a normal walking pace”).`,
      );
  }

  const { width, height } = videoSize(sourceImage.width ?? source.params.width, sourceImage.height ?? source.params.height, req.resolution);
  const movement = req.framing && req.framing !== 'still' && MOVEMENT_MARGINS[req.framing] ? req.framing : null;
  if (movement && req.mode === 'motion' && motionEngine() !== 'animate2') throw new GenerationError('Safe framing needs Copy Motion’s Wan Animate 2 engine.', 422);
  const negative = [
    WAN_NEGATIVE,
    ADULT_ONLY_NEGATIVE,
    contentMode === 'sfw' ? SFW_NEGATIVE : '',
    ...videoNegativeExtras(req.mode === 'animate' ? lock.text : '', source.fields.outfit, contentMode === 'adult'),
  ]
    .filter(Boolean)
    .join(', ');
  const seed = req.seed >= 0 ? Math.floor(req.seed) : Math.floor(Math.random() * 2 ** 48);
  const frame: SafeFrameSpec | null = movement
    ? {
        movement,
        checkpoint: await photoCheckpoint(source.params.checkpoint),
        // the added room is background: setting and light only, never outfit or body words
        scene: [source.fields.setting, source.fields.lighting].map((t) => applyIdentityLock(t ?? '', character.extraLockedTerms).text.trim()).filter(Boolean).join(', '),
        area: req.resolution === '720p' ? 1280 * 720 : 832 * 480,
        seed: seed % 2 ** 32,
      }
    : null;
  const engine = motionEngine();
  const wf = req.mode === 'motion' && engine === 'animate2' ? MOTION2_WORKFLOW : VIDEO_WORKFLOWS[req.mode];
  let lockCamera = req.lockCamera === true;
  if (lockCamera && !lockCameraAllowed(req.mode, req.camera)) {
    lockCamera = false;
    warnings.push('Lock Camera only works with “Still camera” — the chosen camera move is deliberate, so it was kept as it is.');
  }

  let info: VideoInfo;
  let positive: string;
  let build: (imageName: string, videoName: string, face: FaceCheckSpec | null) => ReturnType<typeof buildAnimateGraph>;
  if (req.mode === 'animate') {
    const seconds = Math.min(5, Math.max(2, Math.round(req.seconds ?? 5)));
    const frames = animateLength(seconds);
    const camera = req.camera ?? 'still';
    positive = animatePrompt(lock.text, camera);
    build = (imageName, _v, face) => buildAnimateGraph({ imageName, width, height, frames, positive, negative, seed, quality: req.quality, face, frame, lockCamera });
    info = {
      mode: 'animate',
      model: wf.model,
      sourceId: source.id,
      sourceImage,
      imageIndex: req.imageIndex,
      quality: req.quality,
      resolution: req.resolution,
      width,
      height,
      frames,
      seconds,
      motion: lock.text,
      camera,
      estimateMinutes: estimateMinutes({ mode: 'animate', quality: req.quality, width, height, frames }),
      faceCheck: { status: 'on' },
      ...(movement ? { safeFraming: { movement, status: 'on' as const } } : {}),
      ...(lockCamera ? { lockCamera: { status: 'on' as const } } : {}),
    };
  } else {
    const sent = req.drive;
    if (!sent || !SAFE_VIDEO_RE.test(sent.video.file)) throw new GenerationError('Add the video whose movement Sienna should copy.');
    const drivePath = storedFilePath(sent.video.file);
    if (!drivePath || !(await fs.stat(drivePath).catch(() => null))) throw new GenerationError('That movement video is no longer on the server — add it again.', 410);
    // its length comes from the file, not from the request
    const probed = await probeVideo(drivePath).catch(() => null);
    if (!probed?.frames) throw new GenerationError('That movement video can no longer be read — add it again.', 410);
    const drive = { ...sent, video: { ...sent.video, frames: probed.frames, seconds: Math.round((probed.frames / VIDEO_FPS) * 100) / 100 } };
    const start = Math.min(Math.max(0, drive.video.seconds - 1), Math.max(0, req.start ?? 0));
    const startFrame = Math.round(start * VIDEO_FPS);
    const wantFrames = Math.round(Math.min(MAX_MOTION_SECONDS, Math.max(1, req.seconds ?? MAX_MOTION_SECONDS)) * VIDEO_FPS);
    const v2 = engine === 'animate2';
    const chunks = (v2 ? motion2Chunks : motionChunks)(Math.min(wantFrames, drive.video.frames - startFrame));
    const frames = chunks.frames;
    const seconds = Math.round((frames / VIDEO_FPS) * 10) / 10;
    if (req.quality !== 'fast') warnings.push(`Copy Motion has one speed setting (its 6-step model); “${req.quality}” only applies to Animate Image.`);
    if (req.resolution === '720p') warnings.push('Copy Motion is tuned for 480p; 720p takes about twice as long and may look softer, not sharper.');
    // Wan Animate 2: the main prompt describes looks only (her profile + the photo's outfit; Scene = background)
    const outfit = applyIdentityLock(source.fields.outfit ?? '', character.extraLockedTerms).text;
    // Rear view: front-only traits (face, eyes, freckles, chest) made Wan Animate 2 turn her round to show them, so the
    // text describes her from behind and asks for her back to stay toward the camera. Identity still comes from the photo.
    const away = req.facing === 'away';
    if (away && !v2) warnings.push('The rear-view option applies to Copy Motion with Wan Animate 2; this server uses Animate v1, so it has no effect.');
    positive = v2 ? (away ? motion2RearPrompt : motion2Prompt)(character.appearanceTraits, outfit, lock.text) : motionPrompt(lock.text);
    const motionText = away ? MOTION2_REAR_TEXT : MOTION2_TEXT;
    build = (imageName, videoName, face) =>
      v2
        ? buildMotion2Graph({ imageName, videoName, width, height, startFrame, frames, chunks: chunks.chunks, positive, motionText, negative, seed, face, frame, lockCamera })
        : buildMotionGraph({ imageName, videoName, width, height, startFrame, frames, chunks: chunks.chunks, positive, negative, seed, face, lockCamera });
    info = {
      mode: 'motion',
      model: wf.model,
      sourceId: source.id,
      sourceImage,
      imageIndex: req.imageIndex,
      quality: 'fast',
      resolution: req.resolution,
      width,
      height,
      frames,
      seconds,
      drive: { video: drive.video, poster: drive.poster, start, seconds },
      scene: lock.text,
      ...(req.facing === 'away' ? { facing: 'away' as const } : {}),
      chunks: chunks.chunks,
      estimateMinutes: estimateMinutes({ mode: 'motion', quality: 'fast', width, height, frames, chunks: chunks.chunks }),
      faceCheck: { status: 'on' },
      ...(movement ? { safeFraming: { movement, status: 'on' as const } } : {}),
      ...(lockCamera ? { lockCamera: { status: 'on' as const } } : {}),
    };
  }

  return { req: { ...req, seed }, source, sourceImage, info, positive, negative, warnings, contentMode, wf, seed, width, height, movement, lockCamera, build };
}

/** Does the GPU have what this video needs? (Throws a readable error; the face check is optional.) */
async function checkGpuCanRun(p: VideoPlan, avail: VideoAvailability) {
  const m = avail.modes[p.req.mode];
  if (!m.available) throw new GenerationError(`${VIDEO_MODE_LABELS[p.req.mode]} can't run — the GPU server is missing ${m.missing.join('; ')}.`);
  if (p.movement && !avail.safeFraming.available) throw new GenerationError(`Safe framing can't run — the GPU server is missing ${avail.safeFraming.missing.join('; ')}. Turn it off to use the photo as it is.`);
  if (p.lockCamera && !avail.lockCamera.available) throw new GenerationError(`Lock Camera can't run — the GPU server is missing ${avail.lockCamera.missing.join('; ')}. Choose Natural camera instead.`);
  if (!avail.faceCheck) {
    p.info.faceCheck = { status: 'unavailable', reason: 'the face check could not run (server is missing SiennaFaceCheck — run comfyui-bootstrap.sh)' };
  }
}

function recordFromPlan(p: VideoPlan, backend: GenerationRecord['backend'], graph: GenerationRecord['submittedGraph']): GenerationRecord {
  return {
    id: newId('g'),
    createdAt: new Date().toISOString(),
    status: 'queued',
    clientId: newId('sienna-video-'),
    backend,
    presetId: null,
    presetName: VIDEO_MODE_LABELS[p.req.mode],
    workflowId: p.wf.id,
    workflowName: p.wf.name,
    siennaLock: true,
    contentMode: p.contentMode,
    fields: p.source.fields,
    params: { ...p.source.params, seed: p.seed, batchSize: 1, width: p.width, height: p.height },
    seed: p.seed,
    positivePrompt: p.positive,
    negativePrompt: p.negative,
    lora: null,
    faceReference: null,
    initImage: p.sourceImage,
    poseImage: null,
    warnings: p.warnings,
    prunedModules: [],
    submittedGraph: graph,
    images: [],
    favorite: false,
    review: {},
    notes: '',
    identityPolicy: 1,
    parentId: p.source.id,
    video: p.info,
  };
}

/** Upload the photo (and movement video) and queue the graph. `existing` = a record that was waiting for the GPU. */
async function submitPlan(p: VideoPlan, backend: ComfyBackend, existing: GenerationRecord | null, gpuUrl?: string): Promise<GenerationRecord> {
  const face: FaceCheckSpec | null = p.info.faceCheck.status === 'unavailable' ? null : faceSpec;
  if (backend.kind !== 'mock') await preflight(backend, p.build('probe.png', 'probe.mp4', face), VIDEO_MODE_LABELS[p.req.mode]);
  let graph;
  try {
    const photo = await readImage(p.sourceImage.file);
    const imageName = await backend.uploadImage(photo.bytes, p.sourceImage.file, photo.mime);
    const videoName = p.info.drive ? await backend.uploadImage(await readVideo(p.info.drive.video.file), p.info.drive.video.file, 'video/mp4', '') : '';
    graph = p.build(imageName, videoName, face);
  } catch (e) {
    if (e instanceof ComfyError) throw new GenerationError(`Uploading to the GPU server failed: ${e.message}`, e.status, e.details);
    throw e;
  }
  const record: GenerationRecord = existing
    ? { ...existing, submittedGraph: graph, positivePrompt: p.positive, negativePrompt: p.negative, video: { ...existing.video!, ...p.info, gpu: existing.video!.gpu, request: existing.video!.request } }
    : recordFromPlan(p, backend.kind, graph);
  if (existing && gpuUrl) record.video = { ...record.video!, gpu: { ...record.video!.gpu!, phase: 'submitted', url: gpuUrl, submittedAt: new Date().toISOString() } };
  try {
    const { promptId } = await backend.queuePrompt(graph, record.clientId!);
    return saveRecord({ ...record, promptId });
  } catch (e) {
    if (!(e instanceof ComfyError)) throw e;
    return saveRecord({ ...record, status: 'error', error: e.message, errorDetails: e.details, completedAt: new Date().toISOString() });
  }
}

// ── On-demand video GPU ───────────────────────────────────────────────────────

/** Availability when videos run on the on-demand GPU: everything comes with its setup kit (Copy Motion only if enabled). */
async function onDemandAvailability(copyMotion: boolean): Promise<VideoAvailability> {
  startVideoGpuTimer(videoGpuHousekeeping);
  const ffmpeg = !!(await ffmpegPath());
  const ok = { available: true, missing: [] as string[] };
  const motion = copyMotion
    ? ok
    : { available: false, missing: ['Copy Motion on the video GPU (experimental; set VIDEO_GPU_COPY_MOTION=true — adds ≈ 24 GB and a longer start)'] };
  return {
    enabled: true,
    backend: 'comfyui',
    ffmpeg,
    modes: { animate: ffmpeg ? ok : { available: false, missing: ['ffmpeg on the app server'] }, motion },
    faceCheck: true,
    adultAllowed: adultContentAllowed(),
    motionEngine: motionEngine(),
    // safe framing needs the photo checkpoint, which the video GPU doesn't download
    safeFraming: { available: false, missing: ['the photo checkpoint on the video GPU (safe framing is off with the on-demand video GPU)'] },
    lockCamera: ok,
    experiments: experimentsEnabled(),
    gpu: await videoGpuView(),
    storage: await storageInfo(),
  };
}

/** Queue a video for the on-demand GPU: the record waits ("starting the video GPU") and is submitted when it is ready. */
async function queueForVideoGpu(p: VideoPlan, gpu: VideoGpuConfig): Promise<GenerationRecord> {
  const store = await storageInfo();
  if (store && store.freeBytes < MIN_FREE_BYTES)
    throw new GenerationError(`The app's disk is almost full (${Math.round(store.freeBytes / 1e6)} MB free). Delete old videos or enlarge the disk first.`, 507);
  const s = await currentSession();
  const running = !!s && (s.status === 'starting' || s.status === 'ready');
  const view = await videoGpuView();
  const est = estimateVideoUsd(gpu, !running, Math.max(2, p.info.estimateMinutes));
  if (view.monthUsd + est > gpu.monthlyBudgetUsd)
    throw new GenerationError(
      `This video would go over the video GPU budget ($${view.monthUsd.toFixed(2)} used of $${gpu.monthlyBudgetUsd.toFixed(2)} this month, ≈ $${est.toFixed(2)} needed). Raise VIDEO_GPU_MONTHLY_BUDGET_USD to continue.`,
      402,
    );
  await checkGpuCanRun(p, await onDemandAvailability(gpu.copyMotion));
  const rec = recordFromPlan(p, 'comfyui', {});
  rec.video = { ...rec.video!, gpu: { phase: 'starting', requestedAt: rec.createdAt }, request: p.req as unknown as Record<string, unknown> };
  if (!running) rec.warnings = [...rec.warnings, `Starting the video GPU (usually 8–12 min, ≈ $${est.toFixed(2)} for this video including the start).`];
  const saved = await saveRecord(rec);
  startVideoGpuTimer(videoGpuHousekeeping);
  try {
    await ensureVideoGpu();
  } catch (e: any) {
    return (await patchRecord(saved.id, { status: 'error', error: e.message, completedAt: new Date().toISOString(), video: { ...saved.video!, gpu: { ...saved.video!.gpu!, phase: 'failed' } } }))!;
  }
  return saved;
}

/** Ready = the video nodes (incl. Lock Camera and the face check) and the Animate Image model files are there. */
async function probeVideoGpu(url: string): Promise<{ ready: boolean; phase?: string }> {
  const backend = createBackend(url);
  try {
    // live check first (node and model lists are cached per address; a new pod can reuse an address)
    await backend.systemInfo();
  } catch {
    return { ready: false, phase: 'booting the GPU' };
  }
  try {
    for (const c of [...VIDEO_NODE_CLASSES.animate, ...LOCK_CAMERA_NODE_CLASSES, 'SiennaFaceCheck']) {
      if (!(await backend.nodeInfo(c))) return { ready: false, phase: 'downloading models and installing the video nodes' };
    }
    for (const [cls, input, file] of VIDEO_FILES.animate) {
      if (!(await backend.inputChoices(cls, input)).includes(file)) return { ready: false, phase: 'downloading models and installing the video nodes' };
    }
    return { ready: true };
  } catch {
    return { ready: false, phase: 'downloading models and installing the video nodes' };
  }
}

const gpuWaiting = (r: GenerationRecord) => !!r.video?.gpu && r.video.gpu.phase === 'starting' && r.status === 'queued' && !r.promptId;
const gpuBusy = (r: GenerationRecord) => !!r.video?.gpu && (r.status === 'queued' || r.status === 'running');
let submitting: Promise<void> | null = null;

/**
 * Runs every 30 s (and on every status poll): checks the GPU, submits waiting videos once it is ready, fails them with
 * a readable reason if it can't start, and lets the GPU stop when nothing needs it.
 */
export async function videoGpuHousekeeping(): Promise<void> {
  const gpu = videoGpuConfig();
  if (!gpu) return;
  // check unfinished videos here too: one nobody is watching would otherwise count as busy forever (no idle stop)
  for (const r of (await listHistory()).filter((r) => gpuBusy(r) && !gpuWaiting(r) && !!r.promptId)) await refreshVideo(r.id).catch((e: any) => console.error('[video-gpu] could not check', r.id, e?.message ?? e));
  const recs = await listHistory();
  const session = await tickVideoGpu(recs.filter(gpuBusy).length, probeVideoGpu);
  const waiting = recs.filter(gpuWaiting).sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  if (!waiting.length) return;
  if (!session || session.status === 'failed' || session.status === 'stopped') {
    const why = session?.error ?? session?.stopReason ?? 'the video GPU is not running';
    for (const r of waiting) {
      if (session?.endedAt && Date.parse(session.endedAt) < Date.parse(r.createdAt)) {
        // queued after the last session ended (e.g. the app restarted): start a new one
        await ensureVideoGpu().catch(async (e: any) => failWaiting(r, e.message));
        continue;
      }
      await failWaiting(r, `The video GPU couldn't run this video: ${why}. Nothing was retried automatically — use “Make again” to try once more.`);
    }
    return;
  }
  if (session.status !== 'ready') {
    for (const r of waiting) if (r.video!.gpu!.waitingFor !== session.phase) await patchRecord(r.id, { video: { ...r.video!, gpu: { ...r.video!.gpu!, waitingFor: session.phase } } });
    return;
  }
  if (submitting) return submitting;
  submitting = (async () => {
    for (const r of waiting) {
      const fresh = await getRecord(r.id);
      if (!fresh || !gpuWaiting(fresh)) continue;
      try {
        const plan = await planVideo(fresh.video!.request as unknown as VideoRequest);
        const backend = createBackend(session.url);
        await checkGpuCanRun(plan, await videoAvailability(session.url));
        await submitPlan(plan, backend, fresh, session.url);
        await touchVideoGpu(session.startupBilledTo ? {} : { startupBilledTo: fresh.id });
      } catch (e: any) {
        await failWaiting(fresh, `Sending the video to the GPU failed: ${e.message}`);
      }
    }
  })().finally(() => {
    submitting = null;
  });
  return submitting;
}

async function failWaiting(r: GenerationRecord, error: string) {
  await patchRecord(r.id, { status: 'error', error, completedAt: new Date().toISOString(), video: { ...r.video!, gpu: { ...r.video!.gpu!, phase: 'failed' } } });
}

/** GPU cost of one finished video: its own GPU time, plus the start-up minutes for the video that started the GPU. */
async function videoCost(rec: GenerationRecord): Promise<NonNullable<VideoInfo['gpu']>['cost'] | undefined> {
  const g = rec.video?.gpu;
  const s = await currentSession();
  if (!g?.submittedAt || !s) return undefined;
  const gpuSeconds = Math.max(0, (Date.now() - Date.parse(g.submittedAt)) / 1000);
  const startupUsd = s.startupBilledTo === rec.id && s.readyAt ? (s.rate * (Date.parse(s.readyAt) - Date.parse(s.createdAt))) / 3_600_000 : 0;
  const usd = (s.rate * gpuSeconds) / 3600 + startupUsd;
  return { usd: Math.round(usd * 1000) / 1000, gpuSeconds: Math.round(gpuSeconds), startupUsd: Math.round(startupUsd * 1000) / 1000, rate: s.rate, gpu: s.gpu };
}

// ── Storage ───────────────────────────────────────────────────────────────────

export interface StorageInfo {
  totalBytes: number;
  freeBytes: number;
  /** Bytes of stored videos (natural + locked + movement videos). */
  videoBytes: number;
  videoCount: number;
}
const MIN_FREE_BYTES = 150 * 1024 * 1024;

export async function storageInfo(): Promise<StorageInfo | undefined> {
  try {
    const st = await fs.statfs(DATA_DIR);
    let videoBytes = 0;
    let videoCount = 0;
    for (const f of await fs.readdir(IMAGES_DIR).catch(() => [] as string[])) {
      if (!/\.mp4$/i.test(f)) continue;
      const x = await fs.stat(path.join(IMAGES_DIR, f)).catch(() => null);
      if (x) {
        videoBytes += x.size;
        videoCount++;
      }
    }
    return { totalBytes: st.blocks * st.bsize, freeBytes: st.bavail * st.bsize, videoBytes, videoCount };
  } catch {
    return undefined;
  }
}

// ── Polling ──────────────────────────────────────────────────────────────────

const inflight = new Map<string, Promise<GenerationRecord | null>>();

export function refreshVideo(id: string): Promise<GenerationRecord | null> {
  const existing = inflight.get(id);
  if (existing) return existing;
  const p = doRefresh(id).finally(() => inflight.delete(id));
  inflight.set(id, p);
  return p;
}

async function doRefresh(id: string): Promise<GenerationRecord | null> {
  let rec = await getRecord(id);
  if (rec && gpuWaiting(rec)) {
    startVideoGpuTimer(videoGpuHousekeeping);
    await videoGpuHousekeeping().catch((e) => console.error('[video-gpu]', e?.message ?? e));
    rec = await getRecord(id);
  }
  if (!rec || !rec.video || rec.status === 'done' || rec.status === 'error' || !rec.promptId) return rec;
  const [settings, comfyUrl] = await Promise.all([getSettings(), getComfyUrl()]);
  const gpu = rec.video.gpu;
  const backend = createBackend(rec.backend === 'mock' ? 'mock' : gpu?.url ?? comfyUrl);
  if (gpu?.submittedAt) {
    const cfg = videoGpuConfig();
    const session = await currentSession();
    if (session && session.url === gpu.url && (session.status === 'stopped' || session.status === 'failed'))
      return finishGpuJob(rec, `The video GPU stopped before this video finished (${session.error ?? session.stopReason ?? 'unknown reason'}). Nothing was retried automatically.`);
  }
  let state;
  try {
    state = await backend.jobState(rec.promptId, []);
  } catch (e: any) {
    return { ...rec, warnings: [...rec.warnings.filter((w) => !w.startsWith('Status check:')), `Status check: ${e.message}`] };
  }
  // GPU job timeout: from when this video started running (one waiting behind another isn't late), with a generous
  // cap for one stuck in the queue; only this video's prompt is stopped (an interrupt would stop whichever is running)
  if (gpu?.submittedAt && (state.state === 'running' || state.state === 'pending')) {
    const cfg = videoGpuConfig();
    const limit = (cfg?.jobTimeoutMin ?? 0) * 60_000;
    const since = gpu.runningSince ?? (state.state === 'running' ? new Date().toISOString() : undefined);
    const late = limit > 0 && (since ? Date.now() - Date.parse(since) > limit : Date.now() - Date.parse(gpu.submittedAt) > 3 * limit);
    if (late) {
      await backend.cancel(rec.promptId).catch(() => {});
      return finishGpuJob(rec, `The video took longer than ${cfg!.jobTimeoutMin} min on the GPU and was stopped. Nothing was retried automatically.`);
    }
    if (since && !gpu.runningSince) await patchRecord(id, { video: { ...rec.video, gpu: { ...gpu, runningSince: since } } });
  }
  // a redo is queued long after the record was made; ComfyUI's history is read before its queue, so ask twice
  const ageSec = (Date.now() - Date.parse(rec.promptAt ?? gpu?.submittedAt ?? rec.createdAt)) / 1000;
  if (state.state === 'unknown' && ageSec > Math.max(120, settings.generationTimeoutSec)) {
    try {
      state = await backend.jobState(rec.promptId, []);
    } catch {
      return rec;
    }
  }
  switch (state.state) {
    case 'pending':
      return patchRecord(id, { status: 'queued', queuePosition: state.position });
    case 'running':
      return patchRecord(id, { status: 'running', queuePosition: 0 });
    case 'error':
      if (gpu) return finishGpuJob(rec, state.message, state.details);
      return patchRecord(id, { status: 'error', error: state.message, errorDetails: state.details, completedAt: new Date().toISOString() });
    case 'unknown':
      if (ageSec > Math.max(120, settings.generationTimeoutSec)) {
        return patchRecord(id, { status: 'error', error: 'ComfyUI no longer knows this job (server restarted or history cleared).', completedAt: new Date().toISOString() });
      }
      return rec;
    case 'done': {
      const videoRef = state.images.find((i) => i.nodeId === VIDEO_NODES.save);
      if (!videoRef) return patchRecord(id, { status: 'error', error: 'The video finished but ComfyUI returned no video file.', completedAt: new Date().toISOString() });
      const v = rec.video;
      const warnings = [...rec.warnings];
      const { bytes } = await backend.fetchImage(videoRef);
      const posterRef = state.images.find((i) => i.nodeId === VIDEO_NODES.poster);
      const stored = await withTempDir(async (dir) => {
        const { file, result } = await storeGpuVideo(dir, 'raw', bytes, v, warnings);
        let poster: StoredImage | null = null;
        if (posterRef) {
          const p = await backend.fetchImage(posterRef);
          const mime = mimeFromBytes(p.bytes);
          if (mime) poster = await storeImage(p.bytes, mime, 'gen', 'Video poster');
        }
        if (!poster) {
          const jpg = path.join(dir, 'poster.jpg');
          await posterFrame(file, jpg, 0).catch(() => {});
          const b = await fs.readFile(jpg).catch(() => null);
          if (b) poster = await storeImage(b, 'image/jpeg', 'gen', 'Video poster');
        }
        return { result, poster };
      });
      let safeFraming = v.safeFraming;
      if (safeFraming && rec.backend !== 'mock') {
        const sf = parseSafeFrame(state.texts?.[SAFE_FRAME_NODES.report]?.[0]);
        const ref = state.images.find((i) => i.nodeId === SAFE_FRAME_NODES.image);
        let framedImage: StoredImage | null = null;
        if (ref) {
          const f = await backend.fetchImage(ref);
          const mime = mimeFromBytes(f.bytes);
          if (mime) framedImage = await storeImage(f.bytes, mime, 'gen', 'Safe-framed photo');
        }
        if (!sf) warnings.push('Safe framing returned no report.');
        else if (!sf.available) warnings.push(`Safe framing couldn’t measure her (${sf.error ?? 'unknown'}); the photo was used as it is.`);
        else if (sf.plan?.capped) warnings.push('Safe framing added as much room as it may (40% of the photo); fast movements may still reach the edge.');
        safeFraming = { ...safeFraming, report: sf, framedImage };
      }
      // Lock Camera: the stabilized copy is kept only when every safety check passed; the natural video always is.
      let lockCamera = v.lockCamera;
      if (lockCamera) {
        const lc = rec.backend === 'mock' ? MOCK_LOCK_REPORT : parseLockCamera(state.texts?.[VIDEO_NODES.lock]?.[0]);
        const lockedRef = state.images.find((i) => i.nodeId === VIDEO_NODES.saveLocked);
        let locked: StoredVideo | null = null;
        if (lc?.status === 'applied' && lockedRef) {
          try {
            const b = await backend.fetchImage(lockedRef);
            locked = await withTempDir(async (dir) => (await storeGpuVideo(dir, 'locked', b.bytes, v, warnings)).result);
          } catch (e: any) {
            warnings.push(`Lock Camera’s video couldn’t be saved (${e.message}); the natural camera video is kept.`);
          }
        }
        const status = locked ? 'applied' : lc?.status === 'applied' ? 'rejected' : (lc?.status ?? 'unavailable');
        const reason = locked ? lc!.reason : lc?.status === 'applied' ? 'the locked video file was missing' : (lc?.reason ?? 'the GPU returned no Lock Camera report');
        if (status === 'rejected' || status === 'unavailable') warnings.push(`Lock Camera wasn’t applied: ${reason}. The natural camera video is kept.`);
        lockCamera = { status, reason, report: lc, result: locked };
      }
      const cost = gpu ? await videoCost(rec) : undefined;
      if (gpu) await touchVideoGpu();
      const report = v.faceCheck.status === 'on' ? parseFrameFaces(state.texts?.[VIDEO_NODES.face]?.[0]) : null;
      const identity = videoIdentity(report, FACE_THRESHOLD, FACE_MIN_SIZE, v.faceCheck.status === 'unavailable' ? v.faceCheck.reason : undefined);
      return patchRecord(id, {
        status: 'done',
        images: stored.poster ? [stored.poster] : [],
        identityCheck: identity,
        warnings,
        video: {
          ...v,
          ...(stored.result ? { width: stored.result.width, height: stored.result.height } : {}),
          result: stored.result,
          ...(report ? { frameFaces: report.frames } : {}),
          ...(safeFraming ? { safeFraming } : {}),
          ...(lockCamera ? { lockCamera } : {}),
          ...(gpu ? { gpu: { ...gpu, ...(cost ? { cost } : {}) } } : {}),
        },
        completedAt: new Date().toISOString(),
        queuePosition: 0,
      });
    }
  }
}

/** A video on the on-demand GPU ended in an error: record it (with its GPU cost) and let the GPU's idle timer run. */
async function finishGpuJob(rec: GenerationRecord, error: string, details?: unknown) {
  const cost = await videoCost(rec);
  await touchVideoGpu();
  return patchRecord(rec.id, {
    status: 'error',
    error,
    ...(details ? { errorDetails: details as GenerationRecord['errorDetails'] } : {}),
    completedAt: new Date().toISOString(),
    video: { ...rec.video!, gpu: { ...rec.video!.gpu!, phase: 'failed', ...(cost ? { cost } : {}) } },
  });
}

/** Writes a video from the GPU, makes it stream-friendly (fast start) and stores it. */
async function storeGpuVideo(dir: string, name: string, bytes: Buffer, v: VideoInfo, warnings: string[]) {
  const rawFile = path.join(dir, `${name}.mp4`);
  const fast = path.join(dir, `${name}_fast.mp4`);
  await fs.writeFile(rawFile, bytes);
  let file = rawFile;
  try {
    await faststart(rawFile, fast);
    file = fast;
  } catch (e: any) {
    warnings.push(`Saved the video as it came from the GPU (could not optimise it for streaming: ${e.message}).`);
  }
  const probe = await probeVideo(file).catch(() => null);
  const result = await storeVideoFile(file, 'vid', {
    width: probe?.width ?? v.width,
    height: probe?.height ?? v.height,
    fps: VIDEO_FPS,
    frames: probe?.frames || v.frames,
    seconds: Math.round(((probe?.frames || v.frames) / VIDEO_FPS) * 100) / 100,
  });
  return { file, result };
}

/** Test mode makes no real video, so Lock Camera is reported as applied to the mock clip (same file, for the UI). */
const MOCK_LOCK_REPORT: LockCameraReport = {
  status: 'applied',
  reason: 'test mode: no stabilization runs, the locked copy is the same mock video',
  before: null,
  after: null,
  fillPct: null,
  sharpness: null,
  seam: null,
  bodyLostPct: null,
  ms: null,
};

/** SiennaSafeFrame's JSON report (what was measured and how much room was added). */
export function parseSafeFrame(text: string | undefined): SafeFrameReport | null {
  try {
    const r = JSON.parse(text ?? '');
    if (!r || typeof r !== 'object') return null;
    const p = r.plan && typeof r.plan === 'object' ? r.plan : null;
    const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : 0);
    return {
      available: r.available !== false,
      error: typeof r.error === 'string' ? r.error : undefined,
      plan: p ? { top: num(p.top), bottom: num(p.bottom), left: num(p.left), right: num(p.right), capped: p.capped === true, changed: p.changed === true } : null,
      source: Array.isArray(r.source) ? [num(r.source[0]), num(r.source[1])] : null,
      padded: Array.isArray(r.padded) ? [num(r.padded[0]), num(r.padded[1])] : null,
    };
  } catch {
    return null;
  }
}
