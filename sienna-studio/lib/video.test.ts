import { describe, expect, it } from 'vitest';
import type { ComfyGraph } from './types';
import {
  ANIMATE2_CHUNK,
  buildMotion2Graph,
  MOTION2_FILES,
  MOTION2_NODE_CLASSES,
  motion2Chunks,
  motion2Prompt,
  ANIMATE_CHUNK,
  ANIMATE_STEPS,
  animateLength,
  animatePrompt,
  buildAnimateGraph,
  buildMotionGraph,
  checkFrames,
  motionChunks,
  parseFrameFaces,
  VIDEO_FILES,
  VIDEO_NODE_CLASSES,
  VIDEO_NODES,
  videoIdentity,
  videoSize,
  WAN_FILES,
} from './video';

const face = { reference: '[0.1,0.2]', threshold: 0.74, minFace: 64 };

/** Every link points at an existing node; returns the node ids that nothing reads (should be outputs only). */
function checkLinks(g: ComfyGraph) {
  const used = new Set<string>();
  for (const [id, node] of Object.entries(g)) {
    for (const [k, v] of Object.entries(node.inputs)) {
      if (Array.isArray(v) && v.length === 2 && typeof v[0] === 'string' && typeof v[1] === 'number') {
        expect(g[v[0]], `${id}.${k} → ${v[0]}`).toBeDefined();
        used.add(v[0]);
      }
    }
  }
  return Object.keys(g).filter((id) => !used.has(id));
}

describe('frame maths', () => {
  it('Animate Image uses 16 fps and 4n+1 frames', () => {
    expect(animateLength(5)).toBe(81);
    expect(animateLength(2)).toBe(33);
    expect(animateLength(9)).toBe(81); // capped at 5 s, what Wan2.2 was trained on
    for (const s of [1, 2, 3, 4, 5]) expect((animateLength(s) - 1) % 4).toBe(0);
  });

  it('Copy Motion adds 72 new frames per extra chunk, up to three chunks', () => {
    expect(motionChunks(40)).toEqual({ chunks: 1, frames: 40 });
    expect(motionChunks(77)).toEqual({ chunks: 1, frames: 77 });
    expect(motionChunks(78)).toEqual({ chunks: 2, frames: 78 });
    expect(motionChunks(149)).toEqual({ chunks: 2, frames: 149 });
    expect(motionChunks(150)).toEqual({ chunks: 3, frames: 150 });
    expect(motionChunks(1000)).toEqual({ chunks: 3, frames: 221 });
  });

  it('keeps the photo shape at 480p/720p, multiples of 16', () => {
    const a = videoSize(832, 1216, '480p');
    expect(a.width % 16).toBe(0);
    expect(a.height % 16).toBe(0);
    expect(a.height).toBeGreaterThan(a.width);
    expect(Math.abs(a.width / a.height - 832 / 1216)).toBeLessThan(0.03);
    expect(a.width * a.height).toBeGreaterThan(350_000);
    expect(a.width * a.height).toBeLessThan(450_000);
    const b = videoSize(832, 1216, '720p');
    expect(b.width * b.height).toBeGreaterThan(850_000);
    const land = videoSize(1216, 832, '480p');
    expect(land.width).toBeGreaterThan(land.height);
  });

  it('never face-checks the first frame of Animate Image (it is the photo itself)', () => {
    expect(checkFrames(81, true)).toEqual([20, 40, 60, 80]);
    expect(checkFrames(81, true)).not.toContain(0);
    expect(checkFrames(77, false)[0]).toBeGreaterThan(0);
  });
});

describe('Animate Image graph', () => {
  const base = { imageName: 'sienna/p.png', width: 480, height: 704, frames: 81, positive: 'she smiles', negative: 'bad', seed: 7 };

  it('fast mode: 4-step LoRAs on both experts, steps split 2/2 at cfg 1', () => {
    const g = buildAnimateGraph({ ...base, quality: 'fast', face });
    expect(g.v_fast_high.inputs.lora_name).toBe(WAN_FILES.fastHigh);
    expect(g.v_fast_low.inputs.lora_name).toBe(WAN_FILES.fastLow);
    expect(g.v_ks_high.inputs).toMatchObject({ steps: 4, cfg: 1, start_at_step: 0, end_at_step: 2, add_noise: 'enable', return_with_leftover_noise: 'enable' });
    expect(g.v_ks_low.inputs).toMatchObject({ steps: 4, cfg: 1, start_at_step: 2, add_noise: 'disable', latent_image: ['v_ks_high', 0] });
    expect(g.v_shift_high.inputs).toMatchObject({ shift: 5, model: ['v_fast_high', 0] });
    expect(g.v_i2v.inputs).toMatchObject({ width: 480, height: 704, length: 81, start_image: ['v_image', 0] });
  });

  it('quality mode: no LoRAs, 20 steps split 10/10 at cfg 3.5', () => {
    const g = buildAnimateGraph({ ...base, quality: 'quality', face });
    expect(g.v_fast_high).toBeUndefined();
    expect(g.v_ks_high.inputs).toMatchObject({ steps: ANIMATE_STEPS.quality.steps, cfg: 3.5, end_at_step: 10 });
    expect(g.v_shift_low.inputs.model).toEqual(['v_unet_low', 0]);
  });

  it('is fully wired: only the outputs are left unread', () => {
    const g = buildAnimateGraph({ ...base, quality: 'fast', face });
    expect(checkLinks(g).sort()).toEqual([VIDEO_NODES.face, VIDEO_NODES.poster, VIDEO_NODES.save].sort());
    for (const n of Object.values(g)) expect(VIDEO_NODE_CLASSES.animate.concat(['ImageBatch', 'SiennaFaceCheck'])).toContain(n.class_type);
  });

  it('face-checks four sampled frames, joined into one batch', () => {
    const g = buildAnimateGraph({ ...base, quality: 'fast', face });
    const picks = Object.values(g).filter((n) => n.class_type === 'ImageFromBatch' && n.inputs.length === 1 && n.inputs.batch_index !== 0);
    expect(picks.map((n) => n.inputs.batch_index)).toEqual([20, 40, 60, 80]);
    expect(g[VIDEO_NODES.face].inputs).toMatchObject({ threshold: 0.74, min_face: 64 });
  });

  it('without the face check there is no face node', () => {
    const g = buildAnimateGraph({ ...base, quality: 'fast', face: null });
    expect(g[VIDEO_NODES.face]).toBeUndefined();
    expect(checkLinks(g).sort()).toEqual([VIDEO_NODES.poster, VIDEO_NODES.save].sort());
  });

  it('saves H.264 MP4 at 16 fps', () => {
    const g = buildAnimateGraph({ ...base, quality: 'fast', face });
    expect(g.v_video.inputs.fps).toBe(16);
    expect(g[VIDEO_NODES.save].inputs).toMatchObject({ format: 'mp4', codec: 'auto', video: ['v_video', 0] });
  });
});

describe('Copy Motion graph', () => {
  const base = { imageName: 'sienna/p.png', videoName: 'mot_ab.mp4', width: 480, height: 704, startFrame: 32, positive: 'p', negative: 'n', seed: 9, face };

  it('one chunk: move mode (no background video or character mask), 6 steps at cfg 1, shift 8', () => {
    const g = buildMotionGraph({ ...base, frames: 60, chunks: 1 });
    const a = g.v_anim_0.inputs;
    expect(a.background_video).toBeUndefined();
    expect(a.character_mask).toBeUndefined();
    expect(a.continue_motion).toBeUndefined();
    expect(a).toMatchObject({ length: ANIMATE_CHUNK, video_frame_offset: 0, reference_image: ['v_image', 0], pose_video: ['v_pose_video', 0], face_video: ['v_face_video', 0] });
    expect(g.v_ks_0.inputs).toMatchObject({ steps: 6, cfg: 1, seed: 9, denoise: 1 });
    expect(g.v_shift.inputs.shift).toBe(8);
    expect(g.v_frames.inputs).toMatchObject({ length: 60, image: ['v_new_0', 0] });
  });

  it('copies only the chosen part of the driving video', () => {
    const g = buildMotionGraph({ ...base, frames: 60, chunks: 1 });
    expect(g.v_drive_part.inputs).toMatchObject({ image: ['v_drive_frames', 0], batch_index: 32, length: 60 });
    expect(g.v_scaled.inputs.image).toEqual(['v_drive_part', 0]);
  });

  it('DWPose: one pass for body + hands, one for the face only', () => {
    const g = buildMotionGraph({ ...base, frames: 60, chunks: 1 });
    expect(g.v_pose_video.inputs).toMatchObject({ detect_body: 'enable', detect_hand: 'enable', detect_face: 'disable' });
    expect(g.v_face_video.inputs).toMatchObject({ detect_body: 'disable', detect_hand: 'disable', detect_face: 'enable' });
  });

  it('extra chunks continue from the previous frames and offset', () => {
    const g = buildMotionGraph({ ...base, frames: 200, chunks: 3 });
    expect(g.v_anim_1.inputs).toMatchObject({ continue_motion: ['v_new_0', 0], video_frame_offset: ['v_anim_0', 5] });
    expect(g.v_anim_2.inputs).toMatchObject({ continue_motion: ['v_join_1', 0], video_frame_offset: ['v_anim_1', 5] });
    expect(g.v_join_2.inputs).toMatchObject({ image1: ['v_join_1', 0], image2: ['v_new_2', 0] });
    expect(g.v_frames.inputs.image).toEqual(['v_join_2', 0]);
    expect(checkLinks(g).sort()).toEqual([VIDEO_NODES.face, VIDEO_NODES.poster, VIDEO_NODES.save].sort());
  });

  it('uses the Animate model with its 4-step and relight LoRAs', () => {
    const g = buildMotionGraph({ ...base, frames: 60, chunks: 1 });
    expect(g.v_unet.inputs.unet_name).toBe(WAN_FILES.animate);
    expect(g.v_fast.inputs.lora_name).toBe(WAN_FILES.animateFast);
    expect(g.v_relight.inputs.lora_name).toBe(WAN_FILES.relight);
    for (const n of Object.values(g)) expect(VIDEO_NODE_CLASSES.motion.concat(['SiennaFaceCheck'])).toContain(n.class_type);
  });

  it('every model file it loads is listed for the availability check', () => {
    for (const [mode, g] of [
      ['animate', buildAnimateGraph({ ...base, frames: 81, quality: 'fast' })],
      ['motion', buildMotionGraph({ ...base, frames: 60, chunks: 1 })],
    ] as const) {
      const files = VIDEO_FILES[mode].map((f) => f[2]);
      for (const n of Object.values(g)) {
        for (const k of ['unet_name', 'lora_name', 'vae_name', 'clip_name']) if (typeof n.inputs[k] === 'string') expect(files).toContain(n.inputs[k]);
      }
    }
  });
});

describe('video face check (strict, fail-closed)', () => {
  const rep = (frames: { found: boolean; similarity: number | null; size?: number }[], available = true) =>
    parseFrameFaces(JSON.stringify({ available, images: frames.map((f) => ({ size: 120, ...f })) }));

  it('verified only when every frame with her face passes 0.74', () => {
    expect(videoIdentity(rep([{ found: true, similarity: 0.8 }, { found: true, similarity: 0.76 }, { found: false, similarity: null }]), 0.74, 64)).toEqual({
      status: 'verified',
      similarity: 0.76,
    });
  });

  it('one weak frame sends the whole video to Needs Review', () => {
    const r = videoIdentity(rep([{ found: true, similarity: 0.9 }, { found: true, similarity: 0.7 }, { found: true, similarity: 0.85 }]), 0.74, 64);
    expect(r.status).toBe('unconfirmed');
    expect(r.similarity).toBe(0.7);
    expect(r.reason).toMatch(/1 of 3/);
  });

  it('no usable face → unchecked; tiny faces do not count', () => {
    expect(videoIdentity(rep([{ found: false, similarity: null }, { found: false, similarity: null }]), 0.74, 64).status).toBe('unchecked');
    expect(videoIdentity(rep([{ found: true, similarity: 0.9, size: 20 }]), 0.74, 64).status).toBe('unchecked');
  });

  it('a check that could not run is never a pass', () => {
    expect(videoIdentity(rep([], false), 0.74, 64).status).toBe('unavailable');
    expect(videoIdentity(null, 0.74, 64).status).toBe('unavailable');
    expect(videoIdentity(parseFrameFaces('not json'), 0.74, 64).status).toBe('unavailable');
    expect(videoIdentity(rep([{ found: true, similarity: 0.95 }]), 0.74, 64, 'node missing')).toMatchObject({ status: 'unavailable', reason: 'node missing' });
  });
});

describe('prompts', () => {
  it('adds the camera move and keeps her face consistent', () => {
    expect(animatePrompt('she smiles.', 'orbit')).toBe('she smiles, the camera slowly circles around her, realistic phone video, natural motion, consistent face');
    expect(animatePrompt('', 'still')).toMatch(/^she moves naturally/);
  });
});

/**
 * Input names of every node class the video graphs use, copied from ComfyUI's source (nodes.py, comfy_extras/
 * nodes_wan.py, nodes_video.py, nodes_images.py, nodes_model_advanced.py) and comfyui_controlnet_aux's dwpose.py, so a
 * typo fails here instead of on a paid GPU.
 */
const SCHEMAS: Record<string, string[]> = {
  LoadImage: ['image'],
  SaveImage: ['images', 'filename_prefix'],
  UNETLoader: ['unet_name', 'weight_dtype'],
  CLIPLoader: ['clip_name', 'type', 'device'],
  VAELoader: ['vae_name'],
  CLIPTextEncode: ['text', 'clip'],
  LoraLoaderModelOnly: ['model', 'lora_name', 'strength_model'],
  ModelSamplingSD3: ['model', 'shift'],
  KSampler: ['model', 'seed', 'steps', 'cfg', 'sampler_name', 'scheduler', 'positive', 'negative', 'latent_image', 'denoise'],
  KSamplerAdvanced: ['model', 'add_noise', 'noise_seed', 'steps', 'cfg', 'sampler_name', 'scheduler', 'positive', 'negative', 'latent_image', 'start_at_step', 'end_at_step', 'return_with_leftover_noise'],
  VAEDecode: ['samples', 'vae'],
  ImageScale: ['image', 'upscale_method', 'width', 'height', 'crop'],
  ImageBatch: ['image1', 'image2'],
  ImageFromBatch: ['image', 'batch_index', 'length'],
  CLIPVisionLoader: ['clip_name'],
  CLIPVisionEncode: ['clip_vision', 'image', 'crop'],
  WanImageToVideo: ['positive', 'negative', 'vae', 'width', 'height', 'length', 'batch_size', 'clip_vision_output', 'start_image', 'ref_pad_image'],
  WanAnimateToVideo: ['positive', 'negative', 'vae', 'width', 'height', 'length', 'batch_size', 'clip_vision_output', 'reference_image', 'face_video', 'pose_video', 'continue_motion_max_frames', 'background_video', 'character_mask', 'continue_motion', 'video_frame_offset'],
  TrimVideoLatent: ['samples', 'trim_amount'],
  LoadVideo: ['file'],
  GetVideoComponents: ['video'],
  CreateVideo: ['images', 'fps', 'audio', 'bit_depth', 'color_space', 'codec'],
  // "format.codec" is the newer dynamic-combo spelling of the hidden legacy "codec" input
  SaveVideo: ['video', 'filename_prefix', 'format', 'codec', 'format.codec'],
  DWPreprocessor: ['image', 'detect_hand', 'detect_body', 'detect_face', 'resolution', 'bbox_detector', 'pose_estimator', 'scale_stick_for_xinsr_cn'],
  SiennaFaceCheck: ['images', 'reference', 'threshold', 'min_face'],
  // Wan Animate 2 (comfy_extras/nodes_wan.py, nodes_custom_sampler.py)
  WanAnimate2ToVideo: ['positive', 'negative', 'vae', 'width', 'height', 'length', 'batch_size', 'reference_image', 'pose_video', 'clip_vision_output', 'positive_pose', 'clip_vision_output_pose', 'continue_motion', 'video_frame_offset', 'pose_strength', 'pose_start_percent', 'pose_end_percent', 'reference_image_strength'],
  WanAnimate2Cache: ['model', 'device', 'dtype'],
  SamplerCustom: ['model', 'add_noise', 'noise_seed', 'cfg', 'positive', 'negative', 'sampler', 'sigmas', 'latent_image'],
  BasicScheduler: ['model', 'scheduler', 'steps', 'denoise'],
  KSamplerSelect: ['sampler_name'],
};
const REQUIRED_OPTIONAL = new Set(['positive_pose', 'clip_vision_output_pose', 'clip_vision_output', 'start_image', 'ref_pad_image', 'reference_image', 'face_video', 'pose_video', 'background_video', 'character_mask', 'continue_motion', 'audio', 'bit_depth', 'color_space', 'codec', 'format.codec']);

describe('node inputs match ComfyUI', () => {
  const graphs = {
    animateFast: buildAnimateGraph({ imageName: 'a.png', width: 480, height: 704, frames: 81, positive: 'p', negative: 'n', seed: 1, quality: 'fast', face }),
    animateQuality: buildAnimateGraph({ imageName: 'a.png', width: 480, height: 704, frames: 81, positive: 'p', negative: 'n', seed: 1, quality: 'quality', face }),
    motion3: buildMotionGraph({ imageName: 'a.png', videoName: 'm.mp4', width: 480, height: 704, startFrame: 0, frames: 200, chunks: 3, positive: 'p', negative: 'n', seed: 1, face }),
    motion2x3: buildMotion2Graph({ imageName: 'a.png', videoName: 'm.mp4', width: 480, height: 832, startFrame: 16, frames: 230, chunks: 3, positive: 'p', motionText: 'm', negative: 'n', seed: 1, face }),
  };
  for (const [name, g] of Object.entries(graphs)) {
    it(`${name}: every input exists and every required input is set`, () => {
      for (const [id, node] of Object.entries(g)) {
        const schema = SCHEMAS[node.class_type];
        expect(schema, `${id} ${node.class_type}`).toBeDefined();
        for (const k of Object.keys(node.inputs)) expect(schema, `${id}.${k}`).toContain(k);
        for (const k of schema) if (!REQUIRED_OPTIONAL.has(k)) expect(node.inputs, `${id} needs ${k}`).toHaveProperty([k]);
      }
    });
  }
  it('DWPose model names are ones the node offers', () => {
    expect(['yolox_l.torchscript.pt', 'yolox_l.onnx']).toContain(WAN_FILES.bbox);
    expect(['dw-ll_ucoco_384_bs5.torchscript.pt', 'dw-ll_ucoco_384.onnx']).toContain(WAN_FILES.pose);
  });
});

describe('Copy Motion v2 (Wan Animate 2)', () => {
  const base = { imageName: 'sienna/p.png', videoName: 'mot_ab.mp4', width: 480, height: 832, startFrame: 16, positive: 'p', motionText: 'a woman dancing', negative: 'n', seed: 9, face };

  it('81-frame parts continuing from one frame: 81, 161, 241', () => {
    expect(motion2Chunks(65)).toEqual({ chunks: 1, frames: 65 });
    expect(motion2Chunks(81)).toEqual({ chunks: 1, frames: 81 });
    expect(motion2Chunks(82)).toEqual({ chunks: 2, frames: 82 });
    expect(motion2Chunks(161)).toEqual({ chunks: 2, frames: 161 });
    expect(motion2Chunks(999)).toEqual({ chunks: 3, frames: 241 });
  });

  it('follows the official template: no skeleton, 6 LCM steps at cfg 1, shift 5, int8 cache in system RAM', () => {
    const g = buildMotion2Graph({ ...base, frames: 65, chunks: 1 });
    expect(Object.values(g).some((x) => x.class_type === 'DWPreprocessor')).toBe(false);
    expect(g.v_cache.inputs).toMatchObject({ device: 'cpu', dtype: 'int8', model: ['v_fast', 0] });
    expect(g.v_sigmas.inputs).toMatchObject({ scheduler: 'simple', steps: 6, denoise: 1 });
    expect(g.v_sampler.inputs.sampler_name).toBe('lcm');
    expect(g.v_shift.inputs.shift).toBe(5);
    expect(g.v_ks_0.inputs).toMatchObject({ cfg: 1, add_noise: true, noise_seed: 9, sigmas: ['v_sigmas', 0], sampler: ['v_sampler', 0] });
    expect(g.v_anim_0.inputs).toMatchObject({ length: ANIMATE2_CHUNK, video_frame_offset: 0, pose_video: ['v_scaled', 0], positive_pose: ['v_pose_text', 0], reference_image: ['v_ref', 0] });
    expect(g.v_drive_part.inputs).toMatchObject({ batch_index: 16, length: 65 });
    expect(g.v_frames.inputs.length).toBe(65);
  });

  it('extra parts continue from the previous frames and offset', () => {
    const g = buildMotion2Graph({ ...base, frames: 230, chunks: 3 });
    expect(g.v_anim_1.inputs).toMatchObject({ continue_motion: ['v_new_0', 0], video_frame_offset: ['v_anim_0', 5] });
    expect(g.v_anim_2.inputs).toMatchObject({ continue_motion: ['v_join_1', 0], video_frame_offset: ['v_anim_1', 5] });
    expect(checkLinks(g).sort()).toEqual([VIDEO_NODES.face, VIDEO_NODES.poster, VIDEO_NODES.save].sort());
    for (const x of Object.values(g)) expect(MOTION2_NODE_CLASSES.concat(['SiennaFaceCheck'])).toContain(x.class_type);
    const files = MOTION2_FILES.map((f) => f[2]);
    for (const x of Object.values(g)) for (const k of ['unet_name', 'lora_name', 'vae_name', 'clip_name']) if (typeof x.inputs[k] === 'string') expect(files).toContain(x.inputs[k]);
  });

  it('drops SDXL weights from the profile text', () => {
    expect(motion2Prompt('long hair, (large round eyes:1.2), (freckles)', '', 'beach')).toBe(
      'Character Description: long hair, large round eyes, freckles. Realistic photo, natural skin, consistent face.\nBackground description: beach.',
    );
  });

  it('main prompt describes looks only', () => {
    expect(motion2Prompt('long chestnut hair', 'red bodycon dress', '')).toBe(
      'Character Description: long chestnut hair, wearing red bodycon dress. Realistic photo, natural skin, consistent face.\nBackground description: the same setting as in the photo, background stationary.',
    );
  });
});

// ── Motion presets v2 / slow-motion wording / engines (motion test, Oct 2026) ──
import { buildSafeFrame, HYBRID_GUIDED, MOTION_PRESETS, MOTION_PRESETS_V1, SAFE_FRAME_NODES, slowMotionWords } from './video';
import { MOVEMENT_MARGINS, movementFromText, SAFE_FRAMING_DEFAULT } from './video-framing';

describe('motion presets v2', () => {
  it('no preset asks for slow movement; the old walk/turn/sway presets did', () => {
    for (const p of MOTION_PRESETS) expect(slowMotionWords(p.text), p.label).toEqual([]);
    const old = Object.fromEntries(MOTION_PRESETS_V1.map((p) => [p.label, slowMotionWords(p.text)]));
    expect(old['Walk toward camera']).toEqual(['walks slowly']);
    expect(old['Turn toward camera']).toEqual(['slowly turns']);
    expect(old['Sway']).toEqual(['sways gently']);
    expect(old['Smile at camera']).toEqual([]); // "smiles softly" is her face, not her speed
  });
  it('keeps facial and weather words', () => {
    expect(MOTION_PRESETS.find((p) => p.id === 'smile')!.text).toContain('smiles softly');
    expect(MOTION_PRESETS.find((p) => p.id === 'breeze')!.text).toContain('a gentle breeze');
  });
  it('flags speed words on movement only', () => {
    expect(slowMotionWords('she gently shifts her weight and smiles softly')).toEqual(['gently shifts']);
    expect(slowMotionWords('she turns her head slowly toward the camera')).toEqual(['turns her head slowly']);
    expect(slowMotionWords('a jump in slow motion')).toEqual(['in slow motion']);
    expect(slowMotionWords('a gentle breeze, she smiles softly, relaxed and happy')).toEqual([]);
    expect(slowMotionWords('she walks toward the camera at a normal walking pace')).toEqual([]);
  });
  it('recommends the engine that won the motion test, never both', () => {
    const best = Object.fromEntries(MOTION_PRESETS.map((p) => [p.id, p.best]));
    expect(best).toMatchObject({ walk: 'animate', bend: 'animate', shift: 'animate', jump: 'motion', turn_around: 'motion' });
    for (const p of MOTION_PRESETS.filter((x) => x.best === 'motion')) expect(p.why).toBeTruthy();
  });
});

describe('hybrid (testing only)', () => {
  it('2 full-guidance steps without the LoRA, then lightx2v high 2–3 and low 3–6', () => {
    const g = buildAnimateGraph({ imageName: 'a.png', width: 480, height: 832, frames: 81, positive: 'p', negative: 'n', seed: 1, quality: 'hybrid', face: null });
    expect(g.v_ks_guided.inputs).toMatchObject({ cfg: HYBRID_GUIDED.cfg, steps: 6, start_at_step: 0, end_at_step: 2, add_noise: 'enable', model: ['v_shift_high_base', 0] });
    expect(g.v_shift_high_base.inputs.model).toEqual(['v_unet_high', 0]);
    expect(g.v_ks_high.inputs).toMatchObject({ cfg: 1, start_at_step: 2, end_at_step: 3, add_noise: 'disable', latent_image: ['v_ks_guided', 0], model: ['v_shift_high', 0] });
    expect(g.v_ks_low.inputs).toMatchObject({ cfg: 1, start_at_step: 3, latent_image: ['v_ks_high', 0] });
    expect(g.v_shift_high.inputs.model).toEqual(['v_fast_high', 0]);
  });
  it('fast and quality graphs are unchanged by the hybrid option', () => {
    const f = buildAnimateGraph({ imageName: 'a.png', width: 480, height: 832, frames: 81, positive: 'p', negative: 'n', seed: 1, quality: 'fast', face: null });
    expect(f.v_ks_guided).toBeUndefined();
    expect(f.v_ks_high.inputs).toMatchObject({ steps: 4, cfg: 1, start_at_step: 0, end_at_step: 2, add_noise: 'enable', latent_image: ['v_i2v', 2] });
    const q = buildAnimateGraph({ imageName: 'a.png', width: 480, height: 832, frames: 81, positive: 'p', negative: 'n', seed: 1, quality: 'quality', face: null });
    expect(q.v_fast_high).toBeUndefined();
    expect(q.v_ks_high.inputs).toMatchObject({ steps: 20, cfg: 3.5, end_at_step: 10 });
  });
});

describe('safe framing', () => {
  const frame = { movement: 'jump' as const, checkpoint: 'sdxl.safetensors', scene: 'sunny park path', area: 832 * 480, seed: 7 };
  it('Animate Image starts from the framed photo at the size the GPU computes', () => {
    const g = buildAnimateGraph({ imageName: 'a.png', width: 480, height: 832, frames: 81, positive: 'p', negative: 'n', seed: 1, quality: 'fast', face: null, frame });
    const sf = g[SAFE_FRAME_NODES.report];
    expect(sf.class_type).toBe('SiennaSafeFrame');
    expect(JSON.parse(sf.inputs.margins as string)).toEqual(MOVEMENT_MARGINS.jump);
    expect(sf.inputs.target_area).toBe(832 * 480);
    expect(g.v_i2v.inputs).toMatchObject({ start_image: ['v_sf_out', 0], width: ['v_sf', 2], height: ['v_sf', 3] });
    expect(g.v_sf_ckpt.inputs.ckpt_name).toBe('sdxl.safetensors');
    // her pixels go back unchanged: composite source = the padded original, mask = inverted outpaint mask
    expect(g.v_sf_comp.inputs).toMatchObject({ source: ['v_sf', 0], destination: ['v_sf_dec', 0], mask: ['v_sf_keep', 0] });
    expect(g.v_sf_pos.inputs.text).toContain('sunny park path');
    expect(g[SAFE_FRAME_NODES.image].class_type).toBe('SaveImage');
  });
  it('without framing the graph is exactly as before', () => {
    const g = buildAnimateGraph({ imageName: 'a.png', width: 480, height: 832, frames: 81, positive: 'p', negative: 'n', seed: 1, quality: 'fast', face: null });
    expect(g.v_sf).toBeUndefined();
    expect(g.v_i2v.inputs).toMatchObject({ start_image: ['v_image', 0], width: 480, height: 832 });
  });
  it('Copy Motion: framed reference, driving frames and output follow the framed shape', () => {
    const g = buildMotion2Graph({ imageName: 'a.png', videoName: 'd.mp4', width: 480, height: 832, startFrame: 0, frames: 60, chunks: 1, positive: 'p', motionText: 'm', negative: 'n', seed: 1, face: null, frame });
    expect(g.v_ref.inputs).toMatchObject({ image: ['v_sf_out', 0], width: ['v_sf', 2], height: ['v_sf', 3] });
    expect(g.v_scaled.inputs).toMatchObject({ width: ['v_sf', 2], height: ['v_sf', 3] });
    expect(g.v_anim_0.inputs).toMatchObject({ width: ['v_sf', 2], height: ['v_sf', 3] });
    const plain = buildMotion2Graph({ imageName: 'a.png', videoName: 'd.mp4', width: 480, height: 832, startFrame: 0, frames: 60, chunks: 1, positive: 'p', motionText: 'm', negative: 'n', seed: 1, face: null });
    expect(plain.v_sf).toBeUndefined();
    expect(plain.v_ref.inputs).toMatchObject({ image: ['v_image', 0], width: 480, height: 832 });
  });
  it('movement from free text, and which movements default to safe framing', () => {
    expect(movementFromText('she does a small jump')).toBe('jump');
    expect(movementFromText('she turns around and looks back')).toBe('turn');
    expect(movementFromText('she bends down to pick something up')).toBe('bend');
    expect(movementFromText('she walks toward the camera')).toBe('walk');
    expect(movementFromText('she smiles')).toBe('still');
    expect(SAFE_FRAMING_DEFAULT).toMatchObject({ jump: true, turn: true, athletic: true, walk: false, bend: false, still: false });
    expect(MOVEMENT_MARGINS.jump.top).toBeGreaterThanOrEqual(0.18); // reference jump: feet rose 0.18 of her height
    expect(typeof buildSafeFrame).toBe('function');
  });
});
