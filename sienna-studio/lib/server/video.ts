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
import { ComfyError, createBackend } from '../comfy/client';
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
  MAX_MOTION_SECONDS,
  motionChunks,
  motionPrompt,
  parseFrameFaces,
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
  videoSize,
  WAN_NEGATIVE,
} from '../video';
import { MOVEMENT_MARGINS, MovementKind } from '../video-framing';
import { FfmpegError, faststart, ffmpegPath, normaliseDrivingVideo, posterFrame, probeVideo, withTempDir } from './ffmpeg';
import { describeMissing, GenerationError } from './generate';
import { preflight } from './jobs';
import {
  adultContentAllowed,
  experimentsEnabled,
  getCharacter,
  getComfyUrl,
  getRecord,
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
  /** Testing-only options (hybrid sampler) are offered. */
  experiments: boolean;
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
export async function videoAvailability(): Promise<VideoAvailability> {
  const enabled = videoEnabled();
  const backend = createBackend(await getComfyUrl());
  const ffmpeg = !!(await ffmpegPath());
  const none = { available: false, missing: [] as string[] };
  const base = { enabled, backend: backend.kind, ffmpeg, adultAllowed: adultContentAllowed(), motionEngine: motionEngine(), experiments: experimentsEnabled() };
  if (!enabled) return { ...base, modes: { animate: none, motion: none }, faceCheck: false, safeFraming: none };
  const noFfmpeg = 'ffmpeg on the app server (npm install, or set FFMPEG_PATH)';
  if (backend.kind === 'mock') {
    const m = { available: ffmpeg, missing: ffmpeg ? [] : [noFfmpeg] };
    return { ...base, modes: { animate: m, motion: m }, faceCheck: false, safeFraming: m };
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
  const [animate, motion, safeFraming] = await Promise.all([check('animate'), check('motion'), checkFraming()]);
  let faceCheck = false;
  try {
    faceCheck = !!(await backend.nodeInfo('SiennaFaceCheck'));
  } catch {}
  return { ...base, modes: { animate, motion }, faceCheck, safeFraming };
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
}

const faceSpec: FaceCheckSpec = { reference: JSON.stringify(SIENNA_FACE_EMBEDDING), threshold: FACE_THRESHOLD, minFace: FACE_MIN_SIZE };

export async function startVideo(req: VideoRequest): Promise<GenerationRecord> {
  if (!videoEnabled()) throw new GenerationError('Video Studio is turned off on this server (SIENNA_VIDEO is not "true").', 403);
  const source = await getRecord(req.sourceId);
  if (!source) throw new GenerationError('The photo was not found.', 404);
  const sourceImage = source.images[req.imageIndex] ?? null;
  if (source.status !== 'done' || !sourceImage || source.video) throw new GenerationError('Choose a finished photo (not a video) to animate.');

  const [character, comfyUrl] = await Promise.all([getCharacter(), getComfyUrl()]);
  if ((character.age ?? 0) < MIN_CHARACTER_AGE) throw new GenerationError(`The character profile age must be at least ${MIN_CHARACTER_AGE}.`);
  const backend = createBackend(comfyUrl);
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
  const negative = [WAN_NEGATIVE, ADULT_ONLY_NEGATIVE, contentMode === 'sfw' ? SFW_NEGATIVE : ''].filter(Boolean).join(', ');
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

  let info: VideoInfo;
  let positive: string;
  let build: (imageName: string, videoName: string, face: FaceCheckSpec | null) => ReturnType<typeof buildAnimateGraph>;
  if (req.mode === 'animate') {
    const seconds = Math.min(5, Math.max(2, Math.round(req.seconds ?? 5)));
    const frames = animateLength(seconds);
    const camera = req.camera ?? 'still';
    positive = animatePrompt(lock.text, camera);
    build = (imageName, _v, face) => buildAnimateGraph({ imageName, width, height, frames, positive, negative, seed, quality: req.quality, face, frame });
    info = {
      mode: 'animate',
      model: wf.model,
      sourceId: source.id,
      sourceImage,
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
    };
  } else {
    const drive = req.drive;
    if (!drive || !SAFE_VIDEO_RE.test(drive.video.file)) throw new GenerationError('Add the video whose movement Sienna should copy.');
    const drivePath = storedFilePath(drive.video.file);
    if (!drivePath || !(await fs.stat(drivePath).catch(() => null))) throw new GenerationError('That movement video is no longer on the server — add it again.', 410);
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
        ? buildMotion2Graph({ imageName, videoName, width, height, startFrame, frames, chunks: chunks.chunks, positive, motionText, negative, seed, face, frame })
        : buildMotionGraph({ imageName, videoName, width, height, startFrame, frames, chunks: chunks.chunks, positive, negative, seed, face });
    info = {
      mode: 'motion',
      model: wf.model,
      sourceId: source.id,
      sourceImage,
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
    };
  }

  // The frame face check is optional on the GPU: without it the video still runs and goes to Needs Review.
  let face: FaceCheckSpec | null = faceSpec;
  if (backend.kind !== 'mock') {
    const avail = await videoAvailability();
    const m = avail.modes[req.mode];
    if (!m.available) throw new GenerationError(`${VIDEO_MODE_LABELS[req.mode]} can't run — the GPU server is missing ${m.missing.join('; ')}.`);
    if (movement && !avail.safeFraming.available) throw new GenerationError(`Safe framing can't run — the GPU server is missing ${avail.safeFraming.missing.join('; ')}. Turn it off to use the photo as it is.`);
    if (!avail.faceCheck) {
      face = null;
      info.faceCheck = { status: 'unavailable', reason: 'the face check could not run (server is missing SiennaFaceCheck — run comfyui-bootstrap.sh)' };
    }
    await preflight(backend, build('probe.png', 'probe.mp4', face), VIDEO_MODE_LABELS[req.mode]);
  }

  let graph;
  try {
    const photo = await readImage(sourceImage.file);
    const imageName = await backend.uploadImage(photo.bytes, sourceImage.file, photo.mime);
    const videoName = info.drive ? await backend.uploadImage(await readVideo(info.drive.video.file), info.drive.video.file, 'video/mp4', '') : '';
    graph = build(imageName, videoName, face);
  } catch (e) {
    if (e instanceof ComfyError) throw new GenerationError(`Uploading to the GPU server failed: ${e.message}`, e.status, e.details);
    throw e;
  }

  const clientId = newId('sienna-video-');
  const record: GenerationRecord = {
    id: newId('g'),
    createdAt: new Date().toISOString(),
    status: 'queued',
    clientId,
    backend: backend.kind,
    presetId: null,
    presetName: VIDEO_MODE_LABELS[req.mode],
    workflowId: wf.id,
    workflowName: wf.name,
    siennaLock: true,
    contentMode,
    fields: source.fields,
    params: { ...source.params, seed, batchSize: 1, width, height },
    seed,
    positivePrompt: positive,
    negativePrompt: negative,
    lora: null,
    faceReference: null,
    initImage: sourceImage,
    poseImage: null,
    warnings,
    prunedModules: [],
    submittedGraph: graph,
    images: [],
    favorite: false,
    review: {},
    notes: '',
    identityPolicy: 1,
    parentId: source.id,
    video: info,
  };
  try {
    const { promptId } = await backend.queuePrompt(graph, clientId);
    return saveRecord({ ...record, promptId });
  } catch (e) {
    if (!(e instanceof ComfyError)) throw e;
    return saveRecord({ ...record, status: 'error', error: e.message, errorDetails: e.details, completedAt: new Date().toISOString() });
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
  const rec = await getRecord(id);
  if (!rec || !rec.video || rec.status === 'done' || rec.status === 'error' || !rec.promptId) return rec;
  const [settings, comfyUrl] = await Promise.all([getSettings(), getComfyUrl()]);
  const backend = createBackend(rec.backend === 'mock' ? 'mock' : comfyUrl);
  let state;
  try {
    state = await backend.jobState(rec.promptId, []);
  } catch (e: any) {
    return { ...rec, warnings: [...rec.warnings.filter((w) => !w.startsWith('Status check:')), `Status check: ${e.message}`] };
  }
  const ageSec = (Date.now() - Date.parse(rec.createdAt)) / 1000;
  switch (state.state) {
    case 'pending':
      return patchRecord(id, { status: 'queued', queuePosition: state.position });
    case 'running':
      return patchRecord(id, { status: 'running', queuePosition: 0 });
    case 'error':
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
        const rawFile = path.join(dir, 'raw.mp4');
        const fast = path.join(dir, 'fast.mp4');
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
        },
        completedAt: new Date().toISOString(),
        queuePosition: 0,
      });
    }
  }
}

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
