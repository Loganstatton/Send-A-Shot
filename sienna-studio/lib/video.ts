/**
 * Video Studio (Wan2.2): turn Sienna photos into short videos. Client-safe (no server imports).
 *
 *   Animate Image — Wan2.2 image-to-video 14B (two experts: high noise → low noise), started from a gallery photo.
 *                   Graph follows ComfyUI's official "video_wan2_2_14B_i2v" template; "fast" uses its 4-step
 *                   lightx2v LoRAs (≈ 1.5 min per 5 s clip on an RTX 4090), "quality" its 20-step setting (≈ 9 min).
 *   Copy Motion   — Wan2.2 Animate 14B in move mode (character animation, not replacement): Sienna's photo is the
 *                   character, a driving video gives the motion. DWPose turns the driving video into body/hand and
 *                   face keypoint videos, so only Sienna appears in the result. Follows the official
 *                   "video_wan2_2_14B_animate" template with the background/character-mask inputs disconnected
 *                   (the template's documented "Move" mode). Longer clips are made in chunks that continue the
 *                   previous chunk's last frames, like the template's "Video Extend" subgraph.
 *
 * Identity: Wan can't load Sienna's SDXL LoRA, so her identity comes from the photo. Frames of every result are run
 * through the same face check as photos (0.74): the video is verified only if every checked frame where a face is
 * found passes. Anything else goes to Needs Review. Videos are never retried automatically (each costs GPU time).
 */

import type { ComfyGraph } from './types';

export const VIDEO_FPS = 16;

/** Model files (ComfyUI folder → file). Download URLs are in scripts/comfyui-bootstrap.sh (--with-wan-video). */
export const WAN_FILES = {
  textEncoder: 'umt5_xxl_fp8_e4m3fn_scaled.safetensors',
  vae: 'wan_2.1_vae.safetensors',
  i2vHigh: 'wan2.2_i2v_high_noise_14B_fp8_scaled.safetensors',
  i2vLow: 'wan2.2_i2v_low_noise_14B_fp8_scaled.safetensors',
  fastHigh: 'wan2.2_i2v_lightx2v_4steps_lora_v1_high_noise.safetensors',
  fastLow: 'wan2.2_i2v_lightx2v_4steps_lora_v1_low_noise.safetensors',
  animate: 'Wan2_2-Animate-14B_fp8_e4m3fn_scaled_KJ.safetensors',
  animateFast: 'lightx2v_I2V_14B_480p_cfg_step_distill_rank64_bf16.safetensors',
  relight: 'WanAnimate_relight_lora_fp16.safetensors',
  clipVision: 'clip_vision_h.safetensors',
  /** DWPose models (comfyui_controlnet_aux downloads them on first use). */
  bbox: 'yolox_l.onnx',
  pose: 'dw-ll_ucoco_384_bs5.torchscript.pt',
} as const;

/** Wan's own recommended negative prompt (from the official templates), plus our adult-only guard. */
export const WAN_NEGATIVE =
  '色调艳丽，过曝，静态，细节模糊不清，字幕，风格，作品，画作，画面，静止，整体发灰，最差质量，低质量，JPEG压缩残留，丑陋的，残缺的，多余的手指，画得不好的手部，画得不好的脸部，畸形的，毁容的，形态畸形的肢体，手指融合，静止不动的画面，杂乱的背景，三条腿，背景人很多，倒着走';

export type VideoMode = 'animate' | 'motion';
export type VideoQuality = 'fast' | 'quality';
export type VideoResolution = '480p' | '720p';
export type CameraMove = 'still' | 'push_in' | 'orbit' | 'handheld';

export const VIDEO_MODE_LABELS: Record<VideoMode, string> = { animate: 'Animate Image', motion: 'Copy Motion' };

export const CAMERA_LABELS: Record<CameraMove, { label: string; text: string }> = {
  still: { label: 'Still camera', text: 'static camera, tripod shot' },
  push_in: { label: 'Slow push-in', text: 'the camera slowly pushes in toward her' },
  orbit: { label: 'Slow orbit', text: 'the camera slowly circles around her' },
  handheld: { label: 'Handheld phone', text: 'handheld phone video, slight natural camera shake' },
};

/** One-tap motion ideas for Animate Image. */
export const MOTION_PRESETS: { label: string; text: string }[] = [
  { label: 'Smile at camera', text: 'she looks into the camera and smiles softly, blinking naturally, subtle breathing' },
  { label: 'Hair in the breeze', text: 'a gentle breeze moves her hair, she tucks a strand behind her ear and smiles' },
  { label: 'Turn toward camera', text: 'she slowly turns her head toward the camera and smiles' },
  { label: 'Walk toward camera', text: 'she walks slowly toward the camera with relaxed, natural steps' },
  { label: 'Sway', text: 'she sways gently from side to side to music, relaxed and smiling' },
  { label: 'Look over shoulder', text: 'she glances back over her shoulder at the camera and smiles' },
];

export const DURATIONS_ANIMATE = [2, 3, 4, 5] as const;
export const MAX_MOTION_SECONDS = 14;
export const MAX_MOTION_TEXT = 400;

/** Frames per Wan2.2 Animate chunk and how many frames each extra chunk carries over (template defaults). */
export const ANIMATE_CHUNK = 77;
export const ANIMATE_OVERLAP = 5;
export const MAX_ANIMATE_CHUNKS = 3;

/** Wan wants 4n+1 frames. */
export function animateLength(seconds: number): number {
  const s = Math.min(5, Math.max(1, Math.round(seconds)));
  return s * VIDEO_FPS + 1;
}

/** Chunks needed to cover `frames` frames of driving video, and the frames the chunks produce. */
export function motionChunks(frames: number): { chunks: number; frames: number } {
  const want = Math.max(1, Math.floor(frames));
  const chunks = Math.min(MAX_ANIMATE_CHUNKS, Math.max(1, Math.ceil((want - ANIMATE_CHUNK) / (ANIMATE_CHUNK - ANIMATE_OVERLAP)) + 1));
  const produced = ANIMATE_CHUNK + (chunks - 1) * (ANIMATE_CHUNK - ANIMATE_OVERLAP);
  return { chunks, frames: Math.min(want, produced) };
}

/** Output size: keep the photo's shape, aim at 480p / 720p pixel counts, multiples of 16. */
export function videoSize(srcW: number, srcH: number, res: VideoResolution): { width: number; height: number } {
  const w0 = srcW > 0 ? srcW : 832;
  const h0 = srcH > 0 ? srcH : 1216;
  const area = res === '720p' ? 1280 * 720 : 832 * 480;
  const scale = Math.sqrt(area / (w0 * h0));
  const r16 = (n: number) => Math.max(256, Math.min(1280, Math.round(n / 16) * 16));
  return { width: r16(w0 * scale), height: r16(h0 * scale) };
}

/** Rough GPU minutes on an RTX 4090 (from the template notes, scaled by pixels and frames). Shown in the UI. */
export function estimateMinutes(opts: { mode: VideoMode; quality: VideoQuality; width: number; height: number; frames: number; chunks?: number }): number {
  const px = (opts.width * opts.height) / (640 * 640);
  if (opts.mode === 'animate') {
    const base = opts.quality === 'quality' ? 9 : 1.5; // 640×640, 81 frames
    return Math.max(0.5, Math.round(base * px * (opts.frames / 81) * 10) / 10);
  }
  // Animate: 6 steps per chunk, plus DWPose on the driving frames
  return Math.max(1, Math.round((1.8 * px * (opts.chunks ?? 1) + opts.frames / 200) * 10) / 10);
}

/** Frames to face-check: four spread through the clip (never the first frame of Animate Image — that is the photo). */
export function checkFrames(frames: number, skipFirst: boolean): number[] {
  const last = Math.max(0, frames - 1);
  const picks = [0.25, 0.5, 0.75, 1].map((f) => Math.round(last * f));
  if (!skipFirst) picks[0] = Math.round(last * 0.1);
  return [...new Set(picks)].filter((i) => i >= 0 && i <= last);
}

// ── Graphs ─────────────────────────────────────────────────────────────────

/** Node ids the server reads back. */
export const VIDEO_NODES = { save: 'v_save', poster: 'v_poster', face: 'v_face' } as const;

type Node = ComfyGraph[string];
const n = (class_type: string, inputs: Node['inputs'], title?: string): Node => ({ class_type, inputs, ...(title ? { _meta: { title } } : {}) });

export interface FaceCheckSpec {
  reference: string;
  threshold: number;
  minFace: number;
}

/** SaveVideo inputs that validate on both older ComfyUI (plain combos) and newer (dynamic combo "format.codec"). */
function saveVideo(video: [string, number]): Node {
  // codec "auto" = H.264 in MP4 (plays on iPhone); it has no nested inputs in either ComfyUI version
  return n('SaveVideo', { video, filename_prefix: 'sienna/video', format: 'mp4', codec: 'auto', 'format.codec': 'auto' }, 'Save video');
}

/** Poster frame + face check on sampled frames, wired to the final frames. */
function addOutputs(g: ComfyGraph, frames: [string, number], frameCount: number, skipFirst: boolean, face: FaceCheckSpec | null) {
  g.v_video = n('CreateVideo', { images: frames, fps: VIDEO_FPS }, 'Frames → video');
  g[VIDEO_NODES.save] = saveVideo(['v_video', 0]);
  g.v_poster_frame = n('ImageFromBatch', { image: frames, batch_index: 0, length: 1 });
  g[VIDEO_NODES.poster] = n('SaveImage', { images: ['v_poster_frame', 0], filename_prefix: 'sienna/poster' }, 'Poster');
  if (!face) return;
  const idx = checkFrames(frameCount, skipFirst);
  let batch: [string, number] | null = null;
  idx.forEach((i, k) => {
    const id = `v_fc_${k}`;
    g[id] = n('ImageFromBatch', { image: frames, batch_index: i, length: 1 });
    if (!batch) batch = [id, 0];
    else {
      g[`v_fcb_${k}`] = n('ImageBatch', { image1: batch, image2: [id, 0] });
      batch = [`v_fcb_${k}`, 0];
    }
  });
  g[VIDEO_NODES.face] = n('SiennaFaceCheck', { images: batch!, reference: face.reference, threshold: face.threshold, min_face: face.minFace }, 'Face check (frames)');
}

export interface AnimateGraphInput {
  imageName: string;
  width: number;
  height: number;
  frames: number;
  positive: string;
  negative: string;
  seed: number;
  quality: VideoQuality;
  face: FaceCheckSpec | null;
}

export const ANIMATE_STEPS: Record<VideoQuality, { steps: number; cfg: number; split: number }> = {
  fast: { steps: 4, cfg: 1, split: 2 },
  quality: { steps: 20, cfg: 3.5, split: 10 },
};

export function buildAnimateGraph(i: AnimateGraphInput): ComfyGraph {
  const s = ANIMATE_STEPS[i.quality];
  const fast = i.quality === 'fast';
  const g: ComfyGraph = {
    v_image: n('LoadImage', { image: i.imageName }, 'Sienna photo'),
    v_unet_high: n('UNETLoader', { unet_name: WAN_FILES.i2vHigh, weight_dtype: 'default' }),
    v_unet_low: n('UNETLoader', { unet_name: WAN_FILES.i2vLow, weight_dtype: 'default' }),
    v_clip: n('CLIPLoader', { clip_name: WAN_FILES.textEncoder, type: 'wan', device: 'default' }),
    v_vae: n('VAELoader', { vae_name: WAN_FILES.vae }),
    v_pos: n('CLIPTextEncode', { clip: ['v_clip', 0], text: i.positive }, 'Motion prompt'),
    v_neg: n('CLIPTextEncode', { clip: ['v_clip', 0], text: i.negative }, 'Negative'),
  };
  if (fast) {
    g.v_fast_high = n('LoraLoaderModelOnly', { model: ['v_unet_high', 0], lora_name: WAN_FILES.fastHigh, strength_model: 1 });
    g.v_fast_low = n('LoraLoaderModelOnly', { model: ['v_unet_low', 0], lora_name: WAN_FILES.fastLow, strength_model: 1 });
  }
  g.v_shift_high = n('ModelSamplingSD3', { model: [fast ? 'v_fast_high' : 'v_unet_high', 0], shift: 5 });
  g.v_shift_low = n('ModelSamplingSD3', { model: [fast ? 'v_fast_low' : 'v_unet_low', 0], shift: 5 });
  g.v_i2v = n('WanImageToVideo', {
    positive: ['v_pos', 0],
    negative: ['v_neg', 0],
    vae: ['v_vae', 0],
    start_image: ['v_image', 0],
    width: i.width,
    height: i.height,
    length: i.frames,
    batch_size: 1,
  });
  const common = { steps: s.steps, cfg: s.cfg, sampler_name: 'euler', scheduler: 'simple', noise_seed: i.seed, positive: ['v_i2v', 0] as [string, number], negative: ['v_i2v', 1] as [string, number] };
  g.v_ks_high = n('KSamplerAdvanced', { ...common, model: ['v_shift_high', 0], latent_image: ['v_i2v', 2], add_noise: 'enable', start_at_step: 0, end_at_step: s.split, return_with_leftover_noise: 'enable' }, 'High-noise expert');
  g.v_ks_low = n('KSamplerAdvanced', { ...common, model: ['v_shift_low', 0], latent_image: ['v_ks_high', 0], add_noise: 'disable', start_at_step: s.split, end_at_step: 10000, return_with_leftover_noise: 'disable' }, 'Low-noise expert');
  g.v_decode = n('VAEDecode', { samples: ['v_ks_low', 0], vae: ['v_vae', 0] });
  addOutputs(g, ['v_decode', 0], i.frames, true, i.face);
  return g;
}

export interface MotionGraphInput {
  imageName: string;
  videoName: string;
  width: number;
  height: number;
  /** First frame of the chosen part of the driving video (the stored clip is already 16 fps). */
  startFrame: number;
  /** Frames of driving video to copy; the result has the same number. */
  frames: number;
  chunks: number;
  positive: string;
  negative: string;
  seed: number;
  face: FaceCheckSpec | null;
}

export const MOTION_STEPS = { steps: 6, cfg: 1, shift: 8 };

export function buildMotionGraph(i: MotionGraphInput): ComfyGraph {
  const dw = (face: boolean) =>
    n(
      'DWPreprocessor',
      {
        image: ['v_scaled', 0],
        detect_hand: face ? 'disable' : 'enable',
        detect_body: face ? 'disable' : 'enable',
        detect_face: face ? 'enable' : 'disable',
        resolution: 512,
        bbox_detector: WAN_FILES.bbox,
        pose_estimator: WAN_FILES.pose,
        scale_stick_for_xinsr_cn: 'disable',
      },
      face ? 'Face keypoints (driving video)' : 'Body + hand pose (driving video)',
    );
  const g: ComfyGraph = {
    v_image: n('LoadImage', { image: i.imageName }, 'Sienna photo'),
    v_drive: n('LoadVideo', { file: i.videoName }, 'Driving video'),
    v_drive_frames: n('GetVideoComponents', { video: ['v_drive', 0] }),
    v_drive_part: n('ImageFromBatch', { image: ['v_drive_frames', 0], batch_index: Math.max(0, Math.floor(i.startFrame)), length: i.frames }, 'Chosen part'),
    v_scaled: n('ImageScale', { image: ['v_drive_part', 0], upscale_method: 'lanczos', width: i.width, height: i.height, crop: 'center' }),
    v_face_video: dw(true),
    v_pose_video: dw(false),
    v_unet: n('UNETLoader', { unet_name: WAN_FILES.animate, weight_dtype: 'default' }),
    v_fast: n('LoraLoaderModelOnly', { model: ['v_unet', 0], lora_name: WAN_FILES.animateFast, strength_model: 1 }),
    v_relight: n('LoraLoaderModelOnly', { model: ['v_fast', 0], lora_name: WAN_FILES.relight, strength_model: 1 }),
    v_shift: n('ModelSamplingSD3', { model: ['v_relight', 0], shift: MOTION_STEPS.shift }),
    v_clip: n('CLIPLoader', { clip_name: WAN_FILES.textEncoder, type: 'wan', device: 'default' }),
    v_pos: n('CLIPTextEncode', { clip: ['v_clip', 0], text: i.positive }, 'Prompt'),
    v_neg: n('CLIPTextEncode', { clip: ['v_clip', 0], text: i.negative }, 'Negative'),
    v_vae: n('VAELoader', { vae_name: WAN_FILES.vae }),
    v_clipvision: n('CLIPVisionLoader', { clip_name: WAN_FILES.clipVision }),
    v_clipvision_out: n('CLIPVisionEncode', { clip_vision: ['v_clipvision', 0], image: ['v_image', 0], crop: 'none' }),
  };
  let images: [string, number] | null = null;
  let anim: string | null = null;
  for (let c = 0; c < i.chunks; c++) {
    const a = `v_anim_${c}`;
    g[a] = n(
      'WanAnimateToVideo',
      {
        positive: ['v_pos', 0],
        negative: ['v_neg', 0],
        vae: ['v_vae', 0],
        clip_vision_output: ['v_clipvision_out', 0],
        reference_image: ['v_image', 0],
        face_video: ['v_face_video', 0],
        pose_video: ['v_pose_video', 0],
        width: i.width,
        height: i.height,
        length: ANIMATE_CHUNK,
        batch_size: 1,
        continue_motion_max_frames: ANIMATE_OVERLAP,
        video_frame_offset: anim ? [anim, 5] : 0,
        ...(images ? { continue_motion: images } : {}),
      },
      c ? `Continue (part ${c + 1})` : 'Animate (part 1)',
    );
    g[`v_ks_${c}`] = n('KSampler', {
      model: ['v_shift', 0],
      positive: [a, 0],
      negative: [a, 1],
      latent_image: [a, 2],
      seed: i.seed,
      steps: MOTION_STEPS.steps,
      cfg: MOTION_STEPS.cfg,
      sampler_name: 'euler',
      scheduler: 'simple',
      denoise: 1,
    });
    g[`v_trim_${c}`] = n('TrimVideoLatent', { samples: [`v_ks_${c}`, 0], trim_amount: [a, 3] });
    g[`v_dec_${c}`] = n('VAEDecode', { samples: [`v_trim_${c}`, 0], vae: ['v_vae', 0] });
    g[`v_new_${c}`] = n('ImageFromBatch', { image: [`v_dec_${c}`, 0], batch_index: [a, 4], length: 4096 });
    if (images) {
      g[`v_join_${c}`] = n('ImageBatch', { image1: images, image2: [`v_new_${c}`, 0] });
      images = [`v_join_${c}`, 0];
    } else images = [`v_new_${c}`, 0];
    anim = a;
  }
  // The last chunk may run past the driving video (Wan holds its last pose): cut back to the clip's length.
  g.v_frames = n('ImageFromBatch', { image: images!, batch_index: 0, length: i.frames });
  addOutputs(g, ['v_frames', 0], i.frames, false, i.face);
  return g;
}

/** Every node class a video graph can use (for availability checks). */
export const VIDEO_NODE_CLASSES: Record<VideoMode, string[]> = {
  animate: ['LoadImage', 'UNETLoader', 'CLIPLoader', 'VAELoader', 'CLIPTextEncode', 'LoraLoaderModelOnly', 'ModelSamplingSD3', 'WanImageToVideo', 'KSamplerAdvanced', 'VAEDecode', 'CreateVideo', 'SaveVideo', 'ImageFromBatch', 'SaveImage'],
  motion: [
    'LoadImage',
    'LoadVideo',
    'GetVideoComponents',
    'ImageScale',
    'DWPreprocessor',
    'UNETLoader',
    'LoraLoaderModelOnly',
    'ModelSamplingSD3',
    'CLIPLoader',
    'CLIPTextEncode',
    'VAELoader',
    'CLIPVisionLoader',
    'CLIPVisionEncode',
    'WanAnimateToVideo',
    'KSampler',
    'TrimVideoLatent',
    'VAEDecode',
    'ImageFromBatch',
    'ImageBatch',
    'CreateVideo',
    'SaveVideo',
    'SaveImage',
  ],
};

/** [loader class, input, file] for every model file each mode needs. */
export const VIDEO_FILES: Record<VideoMode, [string, string, string][]> = {
  animate: [
    ['UNETLoader', 'unet_name', WAN_FILES.i2vHigh],
    ['UNETLoader', 'unet_name', WAN_FILES.i2vLow],
    ['LoraLoaderModelOnly', 'lora_name', WAN_FILES.fastHigh],
    ['LoraLoaderModelOnly', 'lora_name', WAN_FILES.fastLow],
    ['CLIPLoader', 'clip_name', WAN_FILES.textEncoder],
    ['VAELoader', 'vae_name', WAN_FILES.vae],
  ],
  motion: [
    ['UNETLoader', 'unet_name', WAN_FILES.animate],
    ['LoraLoaderModelOnly', 'lora_name', WAN_FILES.animateFast],
    ['LoraLoaderModelOnly', 'lora_name', WAN_FILES.relight],
    ['CLIPLoader', 'clip_name', WAN_FILES.textEncoder],
    ['VAELoader', 'vae_name', WAN_FILES.vae],
    ['CLIPVisionLoader', 'clip_name', WAN_FILES.clipVision],
  ],
};

// ── Face check over frames ─────────────────────────────────────────────────

export interface FrameFace {
  found: boolean;
  similarity: number | null;
  size: number | null;
}

export type VideoIdentity = {
  status: 'verified' | 'unconfirmed' | 'unchecked' | 'unavailable';
  similarity: number | null;
  reason?: string;
};

/** Parse SiennaFaceCheck's report for the sampled frames. null = no usable report. */
export function parseFrameFaces(text: string | undefined): { available: boolean; error?: string; frames: FrameFace[] } | null {
  try {
    const r = JSON.parse(text ?? '');
    if (!r || typeof r !== 'object') return null;
    const num = (v: unknown) => (typeof v === 'number' ? v : null);
    const frames = Array.isArray(r.images) ? r.images.map((f: any) => ({ found: f?.found === true, similarity: num(f?.similarity), size: num(f?.size) })) : [];
    return { available: r.available !== false, error: typeof r.error === 'string' ? r.error : undefined, frames };
  } catch {
    return null;
  }
}

/**
 * Strict, fail-closed: verified only when her face was found and big enough in at least one checked frame and
 * every frame where it was found scores ≥ threshold. One weak frame sends the whole video to Needs Review.
 */
export function videoIdentity(report: ReturnType<typeof parseFrameFaces>, threshold: number, minFace: number, notRun?: string): VideoIdentity {
  if (notRun) return { status: 'unavailable', similarity: null, reason: notRun };
  if (!report) return { status: 'unavailable', similarity: null, reason: 'the face check returned no result' };
  if (!report.available) return { status: 'unavailable', similarity: null, reason: `the face check could not run (${report.error ?? 'models not loaded'})` };
  const usable = report.frames.filter((f) => f.found && f.similarity !== null && (f.size ?? 0) >= minFace);
  if (!usable.length) return { status: 'unchecked', similarity: null, reason: `her face wasn't found clearly in any of the ${report.frames.length} checked frames` };
  const worst = Math.min(...usable.map((f) => f.similarity!));
  if (worst >= threshold) return { status: 'verified', similarity: worst };
  const failed = usable.filter((f) => f.similarity! < threshold).length;
  return { status: 'unconfirmed', similarity: worst, reason: `${failed} of ${usable.length} checked frames scored below ${threshold.toFixed(2)}` };
}

// ── Prompts ────────────────────────────────────────────────────────────────

export function animatePrompt(motion: string, camera: CameraMove): string {
  const m = motion.trim().replace(/[.\s]+$/, '');
  return [m || 'she moves naturally, subtle breathing and blinking', CAMERA_LABELS[camera].text, 'realistic phone video, natural motion, consistent face'].join(', ');
}

export function motionPrompt(scene: string): string {
  const s = scene.trim().replace(/[.\s]+$/, '');
  return [s || 'a woman performing the movement naturally', 'realistic video, natural motion, consistent face'].join(', ');
}
