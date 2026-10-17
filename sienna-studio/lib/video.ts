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
import { MOVEMENT_MARGINS, MovementKind, SAFE_FRAME_MAX_PAD, SAFE_FRAME_MIN_ASPECT } from './video-framing';

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
  /** Copy Motion v2 (Wan2.2-Animate-2-14B, Comfy-Org/Wan-Animate-2): no pose extraction, its own VAE file name. */
  animate2: 'wan_animate_2_int8_convrot.safetensors',
  vae2: 'Wan2_1_VAE_bf16.safetensors',
  /** DWPose models (comfyui_controlnet_aux downloads them on first use). */
  bbox: 'yolox_l.onnx',
  pose: 'dw-ll_ucoco_384_bs5.torchscript.pt',
} as const;

/** Wan's own recommended negative prompt (from the official templates), plus our adult-only guard. */
export const WAN_NEGATIVE =
  '色调艳丽，过曝，静态，细节模糊不清，字幕，风格，作品，画作，画面，静止，整体发灰，最差质量，低质量，JPEG压缩残留，丑陋的，残缺的，多余的手指，画得不好的手部，画得不好的脸部，畸形的，毁容的，形态畸形的肢体，手指融合，静止不动的画面，杂乱的背景，三条腿，背景人很多，倒着走';

export type VideoMode = 'animate' | 'motion';
/**
 * fast    — lightx2v 4-step LoRAs, cfg 1 (default; best cost and identity in the motion test)
 * quality — 20 steps, cfg 3.5, no LoRA (testing only: 7× the GPU time, not more natural movement in the motion test)
 * hybrid  — 2 full-guidance steps without the LoRA, then 1 + 3 lightx2v steps (testing only, experiments flag:
 *           restored speed on a jump but the image fell apart)
 */
export type VideoQuality = 'fast' | 'quality' | 'hybrid';
export type VideoResolution = '480p' | '720p';
export type CameraMove = 'still' | 'push_in' | 'orbit' | 'handheld';
/** Copy Motion model: Wan2.2-Animate-2 (end-to-end, default) or Wan2.2 Animate v1 (DWPose skeleton). */
export type MotionEngine = 'animate2' | 'animate1';

export const VIDEO_MODE_LABELS: Record<VideoMode, string> = { animate: 'Animate Image', motion: 'Copy Motion' };

export const CAMERA_LABELS: Record<CameraMove, { label: string; text: string }> = {
  still: { label: 'Still camera', text: 'static camera, tripod shot' },
  push_in: { label: 'Slow push-in', text: 'the camera slowly pushes in toward her' },
  orbit: { label: 'Slow orbit', text: 'the camera slowly circles around her' },
  handheld: { label: 'Handheld phone', text: 'handheld phone video, slight natural camera shake' },
};

/**
 * The original (v1) presets, kept unchanged for reference and A/B tests; the UI no longer offers them.
 * Measured problem (motion test, Oct 2026): speed words like "walks slowly" make Wan produce slow-motion movement
 * (an AI walk at 0.79 steps/s vs ~1.8 for a real walk).
 */
export const MOTION_PRESETS_V1: { label: string; text: string }[] = [
  { label: 'Smile at camera', text: 'she looks into the camera and smiles softly, blinking naturally, subtle breathing' },
  { label: 'Hair in the breeze', text: 'a gentle breeze moves her hair, she tucks a strand behind her ear and smiles' },
  { label: 'Turn toward camera', text: 'she slowly turns her head toward the camera and smiles' },
  { label: 'Walk toward camera', text: 'she walks slowly toward the camera with relaxed, natural steps' },
  { label: 'Sway', text: 'she sways gently from side to side to music, relaxed and smiling' },
  { label: 'Look over shoulder', text: 'she glances back over her shoulder at the camera and smiles' },
];

/**
 * One-tap movements (v2): normal human speed, no slow-motion wording. Words that describe her face ("smiles softly")
 * or the weather ("a gentle breeze") stay — only words that slow her movement were removed.
 * `best` is the engine that made this kind of movement most believable in the motion test: Animate Image for ordinary
 * moves, Copy Motion (with a real-timing reference video) where timing, gravity and momentum matter. The app never
 * switches engines on its own — the UI shows the recommendation and the user decides.
 * `framing` is the room the movement needs around her (safe framing, lib/video-framing.ts).
 */
export interface MotionPreset {
  id: string;
  label: string;
  text: string;
  best: VideoMode;
  /** Why the other engine is weaker for this movement (shown when the user is on it). */
  why?: string;
  framing: MovementKind;
  /** Only offered for adult-mode photos (on a server that allows adult content). */
  adult?: boolean;
}
export const MOTION_PRESETS: MotionPreset[] = [
  { id: 'smile', label: 'Smile at camera', text: 'she looks into the camera and smiles softly, blinking naturally, subtle breathing', best: 'animate', framing: 'still' },
  { id: 'breeze', label: 'Hair in the breeze', text: 'a gentle breeze moves her hair, she tucks a strand behind her ear and smiles', best: 'animate', framing: 'still' },
  { id: 'turn_head', label: 'Turn toward camera', text: 'she turns her head toward the camera at a natural, everyday pace and smiles', best: 'animate', framing: 'still' },
  {
    id: 'walk',
    label: 'Walk toward camera',
    text: 'she walks toward the camera at a normal walking pace, natural heel-to-toe steps, her arms swinging naturally, real-time speed',
    best: 'animate',
    framing: 'walk',
  },
  { id: 'sway', label: 'Sway to music', text: 'she sways from side to side in time with upbeat music, relaxed and smiling', best: 'animate', framing: 'small' },
  {
    id: 'shift',
    label: 'Shift her stance',
    text: 'she shifts her weight from one foot to the other and adjusts her stance, an ordinary movement at normal speed',
    best: 'animate',
    framing: 'small',
  },
  { id: 'shoulder', label: 'Look over shoulder', text: 'she glances back over her shoulder at the camera and smiles', best: 'animate', framing: 'still' },
  {
    id: 'bend',
    label: 'Bend & pick up',
    text: 'she bends forward at the waist and knees in one natural movement, picks something up from the floor and stands straight back up, the whole movement takes about three seconds, her hair falls forward and swings back, real-time speed, natural momentum and gravity',
    best: 'animate',
    framing: 'bend',
  },
  {
    id: 'bend_away',
    label: 'Bend over (back to camera)',
    // Round 7: "hinge at the hips, knees almost straight" still let her hips drop to ~78% (a slight crouch), so the hips
    // staying high and the back staying long are named explicitly; facing away is stated for the whole clip.
    text: 'with her back to the camera the whole time, she hinges forward at the hips with a long straight back, hips staying high above her knees, knees only slightly bent and both feet planted, picks up a seashell from the sand and stands straight back up, real-time speed, natural balance, hair falls forward and swings back, fixed camera, her whole body stays in frame',
    best: 'animate',
    framing: 'bend',
  },
  {
    id: 'top_off',
    label: 'Take off bikini top',
    // Round 12: "unties … takes it off" came out as a quick lift-and-yank with the top vanishing; the hands are now
    // described step by step, with smooth movements and the top visibly set down (no slow-speed words: those make Wan
    // produce slow motion).
    text: 'facing the camera, she reaches behind her back with both hands and unties the strings of her bikini top, lets the loosened top slide down her arms, takes it off and drops it beside her, then lowers her arms and stands relaxed, smooth and gentle hand movements, real-time speed, fixed camera, her whole body stays in frame',
    best: 'animate',
    framing: 'small',
    adult: true,
  },
  {
    id: 'turn_around',
    label: 'Turn around, look back',
    text: 'she turns around at a normal pace until her back faces the camera, then glances back over her shoulder at the camera, her hair swinging with the turn, real-time speed',
    best: 'motion',
    why: 'Quick turns need exact timing; Copy Motion follows a real reference video, Animate Image guesses the timing.',
    framing: 'turn',
  },
  {
    id: 'jump',
    label: 'Small jump',
    text: 'she bends her knees and springs straight up into a small quick jump, both feet clearly leave the floor, she lands and her knees bend to absorb the landing, about half a second in the air, real-time speed, natural gravity',
    best: 'motion',
    why: 'In the motion test Animate Image jumps floated (≈ 1/8 of real gravity) or fell apart; Copy Motion matched a real jump’s timing and gravity.',
    framing: 'jump',
  },
];

/**
 * Speed words that slow her MOVEMENT down ("walks slowly", "slowly turns", "gently sways", "slow motion").
 * Face and mood words are left alone ("smiles softly", "a gentle breeze", "relaxed").
 */
const MOVE_VERB =
  '(?:walk|turn|move|sway|shift|bend|rise|spin|twirl|danc|step|lean|rais|lift|jump|run|stand|sit|kneel|crouch|squat|stretch|swing|rotat|approach|strut|pac|stroll|rock|bounc|wiggl|shak|twist|swirl|glid|lower|climb|roll)\\w*';
const SLOW_ADV = '(?:slowly|gently|languidly|leisurely|unhurriedly|sluggishly)';
const SLOW_PATTERNS = [
  /\b(?:in\s+)?slow[- ]?(?:motion|mo)\b|\bslowmo\b/i,
  new RegExp(`\\b${SLOW_ADV}\\s+(?:\\w+\\s+)?${MOVE_VERB}`, 'i'),
  new RegExp(`\\b${MOVE_VERB}(?:\\s+[\\w'-]+){0,3}?\\s+${SLOW_ADV}\\b`, 'i'),
  new RegExp(`\\bslow\\s+(?:${MOVE_VERB})`, 'i'),
];
/** Taking clothes off (the prompt then also rules out ripping and tearing). */
const UNDRESS_RE = /\b(take|takes|taking|took|remove|removes|removing|untie|unties|untying|undo|undoes|slip|slips|pull|pulls|lift|lifts|strip|strips|undress|undresses)\b[^.]*\b(top|bra|bikini|shirt|dress|bottoms?|clothes|swimsuit|lingerie)\b/i;
export const UNDRESS_NEGATIVE = 'ripping, tearing, yanking, torn fabric, clothing vanishing into thin air, jerky sudden arm movements';
/** A nude photo: the video model must not add underwear or swimwear that isn't there. */
export const NUDE_SOURCE_NEGATIVE = 'underwear, panties, thong, g-string, briefs, bikini bottom, swimsuit, fabric covering her body';
const NUDE_OUTFIT_RE = /\b(nude|naked|no clothes|unclothed)\b/i;

/**
 * Extra negative words for a video: no ripping when she takes something off, and no invented underwear when the photo
 * shows her nude (adult mode only; SFW videos already exclude nudity).
 */
export function videoNegativeExtras(motion: string, outfit: string | undefined, adult: boolean): string[] {
  const extra: string[] = [];
  if (adult && UNDRESS_RE.test(motion)) extra.push(UNDRESS_NEGATIVE);
  if (adult && NUDE_OUTFIT_RE.test(outfit ?? '')) extra.push(NUDE_SOURCE_NEGATIVE);
  return extra;
}

export function slowMotionWords(text: string): string[] {
  const found: string[] = [];
  for (const sentence of text.split(/[,.;!?]/)) {
    for (const re of SLOW_PATTERNS) {
      const m = re.exec(sentence);
      if (m && !found.includes(m[0].trim())) found.push(m[0].trim());
    }
  }
  return found;
}

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
    // 640×640, 81 frames; hybrid measured at ≈ 1.75× fast in the motion test (A40: 165 s vs 100 s)
    const base = opts.quality === 'quality' ? 9 : opts.quality === 'hybrid' ? 2.6 : 1.5;
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
export const VIDEO_NODES = { save: 'v_save', poster: 'v_poster', face: 'v_face', lock: 'v_lock', saveLocked: 'v_save_locked' } as const;

type Node = ComfyGraph[string];
const n = (class_type: string, inputs: Node['inputs'], title?: string): Node => ({ class_type, inputs, ...(title ? { _meta: { title } } : {}) });

export interface FaceCheckSpec {
  reference: string;
  threshold: number;
  minFace: number;
}

/** SaveVideo inputs that validate on both older ComfyUI (plain combos) and newer (dynamic combo "format.codec"). */
function saveVideo(video: [string, number], prefix = 'sienna/video', title = 'Save video'): Node {
  // codec "auto" = H.264 in MP4 (plays on iPhone); it has no nested inputs in either ComfyUI version
  return n('SaveVideo', { video, filename_prefix: prefix, format: 'mp4', codec: 'auto', 'format.codec': 'auto' }, title);
}

/**
 * Poster frame + face check on sampled frames, wired to the final frames. With Lock Camera, a second, stabilized copy
 * is saved as well (SiennaLockCamera; it hands back the unchanged frames when a safety check fails, and its report
 * says whether the locked copy may be used). The natural video is always kept.
 */
function addOutputs(g: ComfyGraph, frames: [string, number], frameCount: number, skipFirst: boolean, face: FaceCheckSpec | null, lockCamera = false) {
  g.v_video = n('CreateVideo', { images: frames, fps: VIDEO_FPS }, 'Frames → video');
  g[VIDEO_NODES.save] = saveVideo(['v_video', 0]);
  if (lockCamera) {
    g[VIDEO_NODES.lock] = n('SiennaLockCamera', { images: frames }, 'Lock camera (stabilize)');
    g.v_video_locked = n('CreateVideo', { images: [VIDEO_NODES.lock, 0], fps: VIDEO_FPS }, 'Locked frames → video');
    g[VIDEO_NODES.saveLocked] = saveVideo(['v_video_locked', 0], 'sienna/video_locked', 'Save video (locked camera)');
  }
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
  /** Safe framing: add room around her before animating (null = use the photo as it is). */
  frame?: SafeFrameSpec | null;
  /** Also save a stabilized (locked camera) copy. */
  lockCamera?: boolean;
}

export const ANIMATE_STEPS: Record<VideoQuality, { steps: number; cfg: number; split: number }> = {
  fast: { steps: 4, cfg: 1, split: 2 },
  quality: { steps: 20, cfg: 3.5, split: 10 },
  // hybrid: 6-step schedule; steps 0–2 full guidance on the plain high-noise expert, 2–3 high + lightx2v, 3–6 low + lightx2v
  hybrid: { steps: 6, cfg: 1, split: 3 },
};
export const HYBRID_GUIDED = { steps: 2, cfg: 3.5 };

export function buildAnimateGraph(i: AnimateGraphInput): ComfyGraph {
  const s = ANIMATE_STEPS[i.quality];
  const lora = i.quality !== 'quality';
  const g: ComfyGraph = {
    v_image: n('LoadImage', { image: i.imageName }, 'Sienna photo'),
    v_unet_high: n('UNETLoader', { unet_name: WAN_FILES.i2vHigh, weight_dtype: 'default' }),
    v_unet_low: n('UNETLoader', { unet_name: WAN_FILES.i2vLow, weight_dtype: 'default' }),
    v_clip: n('CLIPLoader', { clip_name: WAN_FILES.textEncoder, type: 'wan', device: 'default' }),
    v_vae: n('VAELoader', { vae_name: WAN_FILES.vae }),
    v_pos: n('CLIPTextEncode', { clip: ['v_clip', 0], text: i.positive }, 'Motion prompt'),
    v_neg: n('CLIPTextEncode', { clip: ['v_clip', 0], text: i.negative }, 'Negative'),
  };
  const sized = i.frame ? buildSafeFrame(g, ['v_image', 0], i.frame) : null;
  if (lora) {
    g.v_fast_high = n('LoraLoaderModelOnly', { model: ['v_unet_high', 0], lora_name: WAN_FILES.fastHigh, strength_model: 1 });
    g.v_fast_low = n('LoraLoaderModelOnly', { model: ['v_unet_low', 0], lora_name: WAN_FILES.fastLow, strength_model: 1 });
  }
  g.v_shift_high = n('ModelSamplingSD3', { model: [lora ? 'v_fast_high' : 'v_unet_high', 0], shift: 5 });
  g.v_shift_low = n('ModelSamplingSD3', { model: [lora ? 'v_fast_low' : 'v_unet_low', 0], shift: 5 });
  g.v_i2v = n('WanImageToVideo', {
    positive: ['v_pos', 0],
    negative: ['v_neg', 0],
    vae: ['v_vae', 0],
    start_image: sized ? sized.image : ['v_image', 0],
    width: sized ? sized.width : i.width,
    height: sized ? sized.height : i.height,
    length: i.frames,
    batch_size: 1,
  });
  const common = { steps: s.steps, cfg: s.cfg, sampler_name: 'euler', scheduler: 'simple', noise_seed: i.seed, positive: ['v_i2v', 0] as [string, number], negative: ['v_i2v', 1] as [string, number] };
  if (i.quality === 'hybrid') {
    g.v_shift_high_base = n('ModelSamplingSD3', { model: ['v_unet_high', 0], shift: 5 });
    g.v_ks_guided = n(
      'KSamplerAdvanced',
      { ...common, cfg: HYBRID_GUIDED.cfg, model: ['v_shift_high_base', 0], latent_image: ['v_i2v', 2], add_noise: 'enable', start_at_step: 0, end_at_step: HYBRID_GUIDED.steps, return_with_leftover_noise: 'enable' },
      'Motion steps (full guidance)',
    );
  }
  const highStart = i.quality === 'hybrid' ? HYBRID_GUIDED.steps : 0;
  g.v_ks_high = n(
    'KSamplerAdvanced',
    {
      ...common,
      model: ['v_shift_high', 0],
      latent_image: i.quality === 'hybrid' ? ['v_ks_guided', 0] : ['v_i2v', 2],
      add_noise: i.quality === 'hybrid' ? 'disable' : 'enable',
      start_at_step: highStart,
      end_at_step: s.split,
      return_with_leftover_noise: 'enable',
    },
    'High-noise expert',
  );
  g.v_ks_low = n('KSamplerAdvanced', { ...common, model: ['v_shift_low', 0], latent_image: ['v_ks_high', 0], add_noise: 'disable', start_at_step: s.split, end_at_step: 10000, return_with_leftover_noise: 'disable' }, 'Low-noise expert');
  g.v_decode = n('VAEDecode', { samples: ['v_ks_low', 0], vae: ['v_vae', 0] });
  addOutputs(g, ['v_decode', 0], i.frames, true, i.face, i.lockCamera);
  return g;
}

// ── Safe framing ─────────────────────────────────────────────────────────────

/** Node ids the server reads back for safe framing. */
export const SAFE_FRAME_NODES = { report: 'v_sf', image: 'v_sf_save' } as const;

export interface SafeFrameSpec {
  movement: MovementKind;
  /** SDXL checkpoint that fills the added room (the photo generator's own checkpoint; nothing about it is changed). */
  checkpoint: string;
  /** What the photo shows, so the added room continues it (outfit/scene words, no identity). */
  scene: string;
  /** Output pixel count (480p: 832×480, 720p: 1280×720) — the framed photo is scaled to it, multiples of 16. */
  area: number;
  seed: number;
}

export const SAFE_FRAME_NODE_CLASSES = ['SiennaSafeFrame', 'CheckpointLoaderSimple', 'InpaintModelConditioning', 'KSampler', 'VAEDecode', 'InvertMask', 'ImageCompositeMasked', 'ImageScale', 'SaveImage'];
export const SAFE_FRAME_NEGATIVE = 'person, people, extra limbs, text, watermark, logo, frame, border, blurry, seam, duplicate';

export function safeFramePrompt(scene: string): string {
  const s = scene.trim().replace(/[.\s]+$/, '');
  return `${s ? `${s}, ` : ''}the same photo seen a little wider, natural continuation of the background, realistic photo, same lighting`;
}

/**
 * Adds the safe-framing stage: SiennaSafeFrame measures her and pads only the missing room (mask = the new strip),
 * SDXL fills the strip, the original pixels are pasted back exactly, and the result is scaled to the video size.
 * Returns links to the framed image and its width/height (computed on the GPU, multiples of 16).
 */
export function buildSafeFrame(g: ComfyGraph, image: [string, number], f: SafeFrameSpec) {
  const m = MOVEMENT_MARGINS[f.movement];
  g[SAFE_FRAME_NODES.report] = n(
    'SiennaSafeFrame',
    { image, margins: JSON.stringify(m), target_area: Math.round(f.area), max_pad: SAFE_FRAME_MAX_PAD, min_aspect: SAFE_FRAME_MIN_ASPECT, feather: 24 },
    'Safe framing (room for the movement)',
  );
  g.v_sf_ckpt = n('CheckpointLoaderSimple', { ckpt_name: f.checkpoint }, 'Fill: photo checkpoint');
  g.v_sf_pos = n('CLIPTextEncode', { clip: ['v_sf_ckpt', 1], text: safeFramePrompt(f.scene) });
  g.v_sf_neg = n('CLIPTextEncode', { clip: ['v_sf_ckpt', 1], text: SAFE_FRAME_NEGATIVE });
  g.v_sf_cond = n('InpaintModelConditioning', { positive: ['v_sf_pos', 0], negative: ['v_sf_neg', 0], vae: ['v_sf_ckpt', 2], pixels: [SAFE_FRAME_NODES.report, 0], mask: [SAFE_FRAME_NODES.report, 1], noise_mask: true });
  g.v_sf_ks = n(
    'KSampler',
    { model: ['v_sf_ckpt', 0], seed: f.seed, steps: 24, cfg: 5, sampler_name: 'dpmpp_2m', scheduler: 'karras', positive: ['v_sf_cond', 0], negative: ['v_sf_cond', 1], latent_image: ['v_sf_cond', 2], denoise: 1 },
    'Fill the added room',
  );
  g.v_sf_dec = n('VAEDecode', { samples: ['v_sf_ks', 0], vae: ['v_sf_ckpt', 2] });
  g.v_sf_keep = n('InvertMask', { mask: [SAFE_FRAME_NODES.report, 1] });
  g.v_sf_comp = n('ImageCompositeMasked', { destination: ['v_sf_dec', 0], source: [SAFE_FRAME_NODES.report, 0], x: 0, y: 0, resize_source: false, mask: ['v_sf_keep', 0] }, 'Original pixels back');
  g[SAFE_FRAME_NODES.image] = n('SaveImage', { images: ['v_sf_comp', 0], filename_prefix: 'sienna/framed' }, 'Framed photo');
  g.v_sf_out = n('ImageScale', { image: ['v_sf_comp', 0], upscale_method: 'lanczos', width: [SAFE_FRAME_NODES.report, 2], height: [SAFE_FRAME_NODES.report, 3], crop: 'disabled' }, 'Framed photo, video size');
  return { image: ['v_sf_out', 0] as [string, number], width: [SAFE_FRAME_NODES.report, 2] as [string, number], height: [SAFE_FRAME_NODES.report, 3] as [string, number] };
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
  /** Also save a stabilized (locked camera) copy. */
  lockCamera?: boolean;
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
  addOutputs(g, ['v_frames', 0], i.frames, false, i.face, i.lockCamera);
  return g;
}

// ── Copy Motion v2: Wan2.2-Animate-2 ────────────────────────────────────────────
/**
 * Follows ComfyUI's official "video_wan_animate2" template (Motion Transfer subgraph): the driving frames go straight
 * into WanAnimate2ToVideo (no skeleton), plus a text for the character/background and one for the motion. Base model
 * int8 + the lightx2v LoRA, 6 steps, LCM sampler, cfg 1, shift 5. The pose-branch cache lives in system RAM (the
 * template's tip for 24 GB cards). Longer clips are 81-frame parts continuing from the previous part's last frame.
 */
export const ANIMATE2_CHUNK = 81;
export const ANIMATE2_OVERLAP = 1;
export const MOTION2_STEPS = { steps: 6, cfg: 1, shift: 5, sampler: 'lcm', scheduler: 'simple' };

export function motion2Chunks(frames: number): { chunks: number; frames: number } {
  const want = Math.max(1, Math.floor(frames));
  const step = ANIMATE2_CHUNK - ANIMATE2_OVERLAP;
  const chunks = Math.min(MAX_ANIMATE_CHUNKS, Math.max(1, Math.ceil((want - ANIMATE2_CHUNK) / step) + 1));
  return { chunks, frames: Math.min(want, ANIMATE2_CHUNK + (chunks - 1) * step) };
}

export interface Motion2GraphInput extends MotionGraphInput {
  /** What the motion is (the template's pose prompt), e.g. "a woman doing an energetic street dance". */
  motionText: string;
  /** Where the motion-branch cache is kept: 'cpu' (safe on 24 GB cards) or 'gpu'. */
  cacheDevice?: 'cpu' | 'gpu';
  /** Safe framing: add room around her before copying the movement (null = use the photo as it is). */
  frame?: SafeFrameSpec | null;
}

export function buildMotion2Graph(i: Motion2GraphInput): ComfyGraph {
  const g: ComfyGraph = { v_image: n('LoadImage', { image: i.imageName }, 'Sienna photo') };
  // Safe framing: the framed photo is already at the video size; the driving frames follow its shape.
  const sized = i.frame ? buildSafeFrame(g, ['v_image', 0], i.frame) : null;
  const W = sized ? sized.width : i.width;
  const H = sized ? sized.height : i.height;
  Object.assign(g, {
    v_ref: sized
      ? n('ImageScale', { image: sized.image, upscale_method: 'area', width: W, height: H, crop: 'center' }, 'Sienna photo (framed), output size')
      : n('ImageScale', { image: ['v_image', 0], upscale_method: 'area', width: i.width, height: i.height, crop: 'center' }, 'Sienna photo, output size'),
    v_drive: n('LoadVideo', { file: i.videoName }, 'Driving video'),
    v_drive_frames: n('GetVideoComponents', { video: ['v_drive', 0] }),
    v_drive_part: n('ImageFromBatch', { image: ['v_drive_frames', 0], batch_index: Math.max(0, Math.floor(i.startFrame)), length: i.frames }, 'Chosen part'),
    v_scaled: n('ImageScale', { image: ['v_drive_part', 0], upscale_method: 'area', width: W, height: H, crop: 'center' }),
    v_drive_first: n('ImageFromBatch', { image: ['v_scaled', 0], batch_index: 0, length: 1 }),
    v_clipvision: n('CLIPVisionLoader', { clip_name: WAN_FILES.clipVision }),
    v_cv_ref: n('CLIPVisionEncode', { clip_vision: ['v_clipvision', 0], image: ['v_ref', 0], crop: 'none' }),
    v_cv_pose: n('CLIPVisionEncode', { clip_vision: ['v_clipvision', 0], image: ['v_drive_first', 0], crop: 'none' }),
    v_clip: n('CLIPLoader', { clip_name: WAN_FILES.textEncoder, type: 'wan', device: 'default' }),
    v_pos: n('CLIPTextEncode', { clip: ['v_clip', 0], text: i.positive }, 'Character + background'),
    v_pose_text: n('CLIPTextEncode', { clip: ['v_clip', 0], text: i.motionText }, 'Motion'),
    v_neg: n('CLIPTextEncode', { clip: ['v_clip', 0], text: i.negative }, 'Negative'),
    v_vae: n('VAELoader', { vae_name: WAN_FILES.vae2 }),
    v_unet: n('UNETLoader', { unet_name: WAN_FILES.animate2, weight_dtype: 'default' }),
    v_fast: n('LoraLoaderModelOnly', { model: ['v_unet', 0], lora_name: WAN_FILES.animateFast, strength_model: 1 }),
    v_cache: n('WanAnimate2Cache', { model: ['v_fast', 0], device: i.cacheDevice ?? 'cpu', dtype: 'int8' }, 'Motion-branch cache'),
    v_shift: n('ModelSamplingSD3', { model: ['v_cache', 0], shift: MOTION2_STEPS.shift }),
    v_sigmas: n('BasicScheduler', { model: ['v_cache', 0], scheduler: MOTION2_STEPS.scheduler, steps: MOTION2_STEPS.steps, denoise: 1 }),
    v_sampler: n('KSamplerSelect', { sampler_name: MOTION2_STEPS.sampler }),
  });
  let images: [string, number] | null = null;
  let anim: string | null = null;
  for (let c = 0; c < i.chunks; c++) {
    const a = `v_anim_${c}`;
    g[a] = n(
      'WanAnimate2ToVideo',
      {
        positive: ['v_pos', 0],
        negative: ['v_neg', 0],
        vae: ['v_vae', 0],
        reference_image: ['v_ref', 0],
        pose_video: ['v_scaled', 0],
        clip_vision_output: ['v_cv_ref', 0],
        positive_pose: ['v_pose_text', 0],
        clip_vision_output_pose: ['v_cv_pose', 0],
        width: W,
        height: H,
        length: ANIMATE2_CHUNK,
        batch_size: 1,
        video_frame_offset: anim ? [anim, 5] : 0,
        pose_strength: 1,
        pose_start_percent: 0,
        pose_end_percent: 1,
        reference_image_strength: 1,
        ...(images ? { continue_motion: images } : {}),
      },
      c ? `Continue (part ${c + 1})` : 'Animate (part 1)',
    );
    g[`v_ks_${c}`] = n('SamplerCustom', {
      model: ['v_shift', 0],
      add_noise: true,
      noise_seed: i.seed,
      cfg: MOTION2_STEPS.cfg,
      positive: [a, 0],
      negative: [a, 1],
      sampler: ['v_sampler', 0],
      sigmas: ['v_sigmas', 0],
      latent_image: [a, 2],
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
  g.v_frames = n('ImageFromBatch', { image: images!, batch_index: 0, length: i.frames });
  addOutputs(g, ['v_frames', 0], i.frames, false, i.face, i.lockCamera);
  return g;
}

/** Text for Wan Animate 2's main prompt: looks only (character + background), no motion words. */
/** Which way she faces the camera in Copy Motion. 'away' = rear view (see motion2RearPrompt). */
export type Facing = 'camera' | 'away';

/** Front-only features: asking for them in a rear-view clip makes the model turn her round to show them. */
const FRONT_ONLY = /\b(freckles?|eyes?|iris|eyelash\w*|brows?|face|facial|lips?|smile|teeth|nose|cheeks?|chin|breasts?|bust|chest|cleavage|nipples?|abs|abdomen|stomach|belly|navel)\b/i;

/**
 * Her profile seen from behind: the profile's own comma-separated traits minus anything only visible from the front,
 * plus what a rear view does show (hair down her back, back, waist, hips, the approved fuller glute shape, posture).
 * Identity still comes from the photo itself (reference image + its CLIP-vision embedding); this only changes the text.
 */
export function rearViewTraits(character: string): string {
  const kept = character
    .replace(/\(([^()]*?)(?::\s*[\d.]+)?\)/g, '$1')
    .split(',')
    .map((t) => t.trim())
    .filter((t) => t && !FRONT_ONLY.test(t));
  const rear = [
    'seen from behind',
    'long dark-brown wavy hair falling down her back',
    'smooth tanned back with natural skin texture',
    'slim waist',
    'curvy hips',
    'full, round, prominent glutes',
    'natural relaxed posture',
  ];
  return [...kept.filter((t) => !/\b(hair|waist|hips?)\b/i.test(t)), ...rear].join(', ');
}

/** Wan Animate 2 rear-view prompt: looks from behind only, and an explicit "back to the camera for the whole clip". */
export function motion2RearPrompt(character: string, outfit: string, scene: string): string {
  const clean = (t: string) => t.replace(/\s+/g, ' ').trim().replace(/[.,\s]+$/, '');
  const who = [rearViewTraits(character) || 'a woman seen from behind', clean(outfit) ? `wearing ${clean(outfit)}` : ''].filter(Boolean).join(', ');
  return (
    `Character Description: ${who}. Her back stays toward the camera from the first frame to the last; she never turns around ` +
    `and her face is never shown. Realistic photo, natural skin.\nBackground description: ${clean(scene) || 'the same setting as in the photo, background stationary'}.`
  );
}

/** Motion text for rear-view Copy Motion (Wan Animate 2's pose prompt). */
export const MOTION2_REAR_TEXT =
  'a woman seen from behind performing the movement from the reference video naturally, keeping her back to the camera the whole time, background stationary';

export function motion2Prompt(character: string, outfit: string, scene: string): string {
  // SDXL weighting like "(large eyes:1.2)" means nothing to Wan's text encoder: keep the words only
  const clean = (t: string) =>
    t
      .replace(/\(([^()]*?)(?::\s*[\d.]+)?\)/g, '$1')
      .replace(/\s+/g, ' ')
      .trim()
      .replace(/[.,\s]+$/, '');
  const who = [clean(character) || 'a woman', clean(outfit) ? `wearing ${clean(outfit)}` : ''].filter(Boolean).join(', ');
  return `Character Description: ${who}. Realistic photo, natural skin, consistent face.\nBackground description: ${clean(scene) || 'the same setting as in the photo, background stationary'}.`;
}

/** Every node class a video graph can use (for availability checks). */
export const MOTION2_NODE_CLASSES = [
  'LoadImage', 'ImageScale', 'LoadVideo', 'GetVideoComponents', 'ImageFromBatch', 'CLIPVisionLoader', 'CLIPVisionEncode', 'CLIPLoader', 'CLIPTextEncode',
  'VAELoader', 'UNETLoader', 'LoraLoaderModelOnly', 'WanAnimate2Cache', 'ModelSamplingSD3', 'BasicScheduler', 'KSamplerSelect', 'WanAnimate2ToVideo',
  'SamplerCustom', 'TrimVideoLatent', 'VAEDecode', 'ImageBatch', 'CreateVideo', 'SaveVideo', 'SaveImage',
];
export const MOTION2_FILES: [string, string, string][] = [
  ['UNETLoader', 'unet_name', WAN_FILES.animate2],
  ['LoraLoaderModelOnly', 'lora_name', WAN_FILES.animateFast],
  ['CLIPLoader', 'clip_name', WAN_FILES.textEncoder],
  ['VAELoader', 'vae_name', WAN_FILES.vae2],
  ['CLIPVisionLoader', 'clip_name', WAN_FILES.clipVision],
];

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

// ── Lock Camera ──────────────────────────────────────────────────────────────

/** GPU node for Lock Camera (sienna_nodes, installed by comfyui-bootstrap.sh). */
export const LOCK_CAMERA_NODE_CLASSES = ['SiennaLockCamera'];

/** applied = the locked copy is good to use; steady = nothing to fix; rejected = a safety check failed (natural kept). */
export type LockCameraStatus = 'applied' | 'steady' | 'rejected' | 'unavailable';

export interface CameraDrift {
  /** Largest movement of the frame's corners vs the first frame, px. */
  maxPx: number;
  maxXPct: number;
  maxYPct: number;
  maxZoomPct: number;
  maxRotDeg: number;
}

export interface LockCameraReport {
  status: LockCameraStatus;
  reason: string;
  before: CameraDrift | null;
  after: CameraDrift | null;
  /** Largest filled edge strip, % of the frame. */
  fillPct: number | null;
  /** Her body's sharpness vs the original (1 = same). */
  sharpness: number | null;
  /** Edge texture where the fill meets the frame vs nearby background (1 = indistinguishable). */
  seam: number | null;
  bodyLostPct: number | null;
  ms: number | null;
}

/**
 * Lock Camera removes unwanted drift; it is not offered with the deliberate camera moves (push-in, orbit, handheld),
 * which it would undo. Copy Motion has no camera setting, so it can always be locked.
 */
export function lockCameraAllowed(mode: VideoMode, camera: CameraMove | undefined): boolean {
  return mode === 'motion' || (camera ?? 'still') === 'still';
}

/** SiennaLockCamera's JSON report (null when missing or unreadable). */
export function parseLockCamera(text: string | undefined): LockCameraReport | null {
  try {
    const r = JSON.parse(text ?? '');
    if (!r || typeof r !== 'object') return null;
    const statuses: LockCameraStatus[] = ['applied', 'steady', 'rejected', 'unavailable'];
    const status: LockCameraStatus = statuses.includes(r.status) ? r.status : 'rejected';
    const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : null);
    const drift = (d: any): CameraDrift | null =>
      d && typeof d === 'object'
        ? { maxPx: num(d.max_px) ?? 0, maxXPct: num(d.max_x_pct) ?? 0, maxYPct: num(d.max_y_pct) ?? 0, maxZoomPct: num(d.max_zoom_pct) ?? 0, maxRotDeg: num(d.max_rot_deg) ?? 0 }
        : null;
    return {
      status,
      reason: typeof r.reason === 'string' ? r.reason : status === 'applied' ? 'camera locked' : 'no reason given',
      before: drift(r.before),
      after: drift(r.after),
      fillPct: num(r.fill_pct),
      sharpness: num(r.sharpness_ratio),
      seam: num(r.seam_ratio),
      bodyLostPct: num(r.body_lost_pct),
      ms: num(r.ms),
    };
  } catch {
    return null;
  }
}
