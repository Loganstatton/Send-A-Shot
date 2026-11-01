/**
 * Keep-scene: Copy Photo's "replicate the picture" mode (31 Oct). Generating a new picture from a description of the
 * uploaded photo re-invents everything — the bush, the wall, the tub, the framing — so it was never more than "the
 * same idea". Here the uploaded photo itself is the picture: the person in it is found with the person segmenter
 * (grown well past her outline, hair included) and only that region, plus the app overlays of a screenshot, is
 * redrawn — fully (denoise 1), as Sienna, with the photo's pose — and everything else is pasted back pixel for
 * pixel. Nothing of the other person's face, hair or body survives the redraw: the region is re-sampled from noise.
 *
 *   init LoadImage → ImageScale (W×H) ─┬─► VAEEncode ─► SetLatentNoiseMask ◄─ redraw mask ─► KSampler (denoise 1)
 *                                      ├─► person segm ─► GrowMask ─┐
 *                                      ├─► SiennaUiMask ────────────┴─► MaskComposite (add) = redraw mask
 *                                      └─────────► ImageCompositeMasked (scene, unchanged) ◄─ VAEDecode
 * The face pass and later passes then work on the pasted result (they only touch her).
 */
import type { ComfyGraph } from '../types';
import { PERSON_SEGM_FILE } from '../outfit-edit';
import { FLORENCE_MODEL, OUTFIT_FACE_MODEL } from '../outfit';

export const KEEP_SCENE_PREFIX = 'ks_';
/** How far past her outline the redraw reaches, as a share of the picture's width: room for Sienna's own hair and
 * figure, and none of the other person's edges left behind. */
export const KEEP_SCENE_GROW = 0.022;
/** After the redraw, only this far past her (new and old outline) stays redrawn; the rest of the margin is the photo. */
export const KEEP_SCENE_TIGHT = 0.008;
/** Second pass over painted-out overlays: enough for the water's texture, too little for new shapes. */
export const UI_TOUCH_DENOISE = 0.5;
export const UI_MASK_CLASS = 'SiennaUiMask';
/** Depth preprocessors (comfyui_controlnet_aux), best first, with their inputs. */
export type DepthNode = 'DepthAnythingV2Preprocessor' | 'DepthAnythingPreprocessor' | 'MiDaS-DepthMapPreprocessor';
export const DEPTH_NODES: DepthNode[] = ['DepthAnythingV2Preprocessor', 'DepthAnythingPreprocessor', 'MiDaS-DepthMapPreprocessor'];
const DEPTH_INPUTS: Record<DepthNode, Record<string, unknown>> = {
  DepthAnythingV2Preprocessor: { ckpt_name: 'depth_anything_v2_vitl.pth', resolution: 1024 },
  DepthAnythingPreprocessor: { ckpt_name: 'depth_anything_vitl14.pth', resolution: 1024 },
  'MiDaS-DepthMapPreprocessor': { a: 6.283185307179586, bg_threshold: 0.1, resolution: 1024 },
};
/** The depth of her figure (no head): where the bust touches and where it separates is shading, not edges, so the
 * outline missed it and her cleavage ran long where the photo's was short (1 Nov). */
export const BODY_DEPTH = { strength: 0.6, end: 0.6 } as const;
export const SOFT_SEAM_CLASS = 'ImpactGaussianBlurMask';
/** xinsir ControlNet Union SDXL (ProMax), Apache-2.0: its canny/lineart mode traces the photo's garment edges. */
export const UNION_CN_FILE = 'xinsir_union_promax.safetensors';
export const UNION_CN_URL = 'https://huggingface.co/xinsir/controlnet-union-sdxl-1.0/resolve/main/diffusion_pytorch_model_promax.safetensors';
export const GARMENT_LINES_CLASSES = ['Florence2Run', 'DownloadAndLoadFlorence2Model', 'Canny', 'SetUnionControlNetType', 'EmptyImage', 'BboxDetectorCombined_v2'];
/** How hard the garment's and figure's outline steers the redraw, and for how much of it (the end is left free for
 * detail). 0.75 / 0.65 let her bust drift off the photo's: the cleavage moved sideways, one breast bigger than the
 * other (1 Nov). 0.9 until 80% matched the bust but turned the colours cold and washed out (a purple bikini came out
blue): the outline is let go at 65%, when the shapes are set and the colours are not. SIENNA_COPY_LINES="strength,end"
overrides it. */
export const GARMENT_LINES = { strength: 0.9, end: 0.65 } as const;
export function garmentLines(env: string | undefined = process.env.SIENNA_COPY_LINES): { strength: number; end: number } {
  const [s, e] = (env ?? '').split(',').map((v) => Number(v.trim()));
  const ok = (v: number, max: number) => Number.isFinite(v) && v > 0 && v <= max;
  return { strength: ok(s, 2) ? s : GARMENT_LINES.strength, end: ok(e, 1) ? e : GARMENT_LINES.end };
}

type Ref = [string, number];
const isRef = (v: unknown): v is Ref => Array.isArray(v) && typeof v[0] === 'string' && typeof v[1] === 'number';

/** An output size near one megapixel with the photo's own shape (multiples of 8), so nothing is cropped or padded. */
export function sceneSize(w: number, h: number, pixels = 1_000_000): { width: number; height: number } {
  const a = w > 0 && h > 0 ? w / h : 832 / 1216;
  const r8 = (n: number) => Math.max(512, Math.round(n / 8) * 8);
  const width = r8(Math.sqrt(pixels * a));
  return { width, height: r8(width / a) };
}

/**
 * The graph with the keep-scene redraw wired in, or null when its first pass doesn't start from the init image
 * (VAEEncode of a resized LoadImage) — the caller then makes a normal copy.
 */
export function addKeepScene(
  graph: ComfyGraph,
  opts: { width: number; height?: number; uiMask?: boolean; uiPaint?: boolean; softSeam?: boolean; garment?: { phrases: string[]; controlnet: string; body?: boolean; depth?: DepthNode } },
): ComfyGraph | null {
  if (Object.values(graph).some((n) => n.class_type === 'ImageScaleBy')) return null; // the hi-res pass would resample the scene
  const g: ComfyGraph = structuredClone(graph);
  const samplerId = Object.keys(g).find((id) => g[id].class_type === 'KSampler' && isRef(g[id].inputs.latent_image) && g[(g[id].inputs.latent_image as Ref)[0]]?.class_type === 'VAEEncode');
  if (!samplerId) return null;
  const encodeId = (g[samplerId].inputs.latent_image as Ref)[0];
  const scene = g[encodeId].inputs.pixels;
  if (!isRef(scene)) return null;
  const decodeId = Object.keys(g).find((id) => g[id].class_type === 'VAEDecode' && isRef(g[id].inputs.samples) && (g[id].inputs.samples as Ref)[0] === samplerId);
  if (!decodeId) return null;
  const p = KEEP_SCENE_PREFIX;
  g[`${p}segm`] = { class_type: 'UltralyticsDetectorProvider', inputs: { model_name: PERSON_SEGM_FILE } };
  g[`${p}person`] = { class_type: 'SegmDetectorCombined_v2', inputs: { segm_detector: [`${p}segm`, 1], image: scene, threshold: 0.3, dilation: 0 }, _meta: { title: 'Keep scene: the person' } };
  g[`${p}grow`] = { class_type: 'GrowMask', inputs: { mask: [`${p}person`, 0], expand: Math.round(opts.width * KEEP_SCENE_GROW), tapered_corners: true }, _meta: { title: 'Keep scene: room for Sienna' } };
  let redraw: Ref = [`${p}grow`, 0];
  // the photo as pasted back round her: with uiPaint, the overlays already painted out from the pixels round them (the
  // image model wrote fake letters where it redrew them, 1 Nov), so only she is redrawn
  let backdrop: Ref = scene;
  const redrawUi = opts.uiMask && !opts.uiPaint;
  if (opts.uiMask) {
    g[`${p}ui`] = { class_type: UI_MASK_CLASS, inputs: { image: scene }, _meta: { title: 'Keep scene: app overlays' } };
    if (opts.uiPaint) {
      backdrop = [`${p}ui`, 2];
      g[encodeId].inputs.pixels = backdrop;
    } else {
      g[`${p}union`] = { class_type: 'MaskComposite', inputs: { destination: [`${p}grow`, 0], source: [`${p}ui`, 0], x: 0, y: 0, operation: 'add' } };
      redraw = [`${p}union`, 0];
    }
  }
  g[`${p}noise`] = { class_type: 'SetLatentNoiseMask', inputs: { samples: [encodeId, 0], mask: redraw }, _meta: { title: 'Keep scene: redraw only her' } };
  // What stays redrawn: where the new Sienna actually is (found again in the result), where the other person was, and
  // the overlays. The rest of the margin goes back to the photo, so nothing can be invented round her (a cushion under
  // her arm, a plant beside her, 1 Nov). Both person masks grown a little for her edges and the old outline.
  const tight = Math.max(4, Math.round(opts.width * KEEP_SCENE_TIGHT));
  g[`${p}new`] = { class_type: 'SegmDetectorCombined_v2', inputs: { segm_detector: [`${p}segm`, 1], image: [decodeId, 0], threshold: 0.3, dilation: 0 }, _meta: { title: 'Keep scene: Sienna in the result' } };
  g[`${p}newgrow`] = { class_type: 'GrowMask', inputs: { mask: [`${p}new`, 0], expand: tight, tapered_corners: true } };
  g[`${p}oldgrow`] = { class_type: 'GrowMask', inputs: { mask: [`${p}person`, 0], expand: tight, tapered_corners: true } };
  g[`${p}both`] = { class_type: 'MaskComposite', inputs: { destination: [`${p}newgrow`, 0], source: [`${p}oldgrow`, 0], x: 0, y: 0, operation: 'add' } };
  let kept: Ref = [`${p}both`, 0];
  if (redrawUi) {
    g[`${p}bothui`] = { class_type: 'MaskComposite', inputs: { destination: kept, source: [`${p}ui`, 0], x: 0, y: 0, operation: 'add' } };
    kept = [`${p}bothui`, 0];
  }
  // never more than was redrawn
  g[`${p}within`] = { class_type: 'MaskComposite', inputs: { destination: kept, source: redraw, x: 0, y: 0, operation: 'multiply' } };
  g[`${p}keep`] = { class_type: 'InvertMask', inputs: { mask: [`${p}within`, 0] } };
  // a soft seam: the redraw fades into the photo over a few pixels instead of a hard edge (blocky patches, 31 Oct)
  if (opts.softSeam !== false) g[`${p}soft`] = { class_type: SOFT_SEAM_CLASS, inputs: { mask: [`${p}keep`, 0], kernel_size: 15, sigma: 5 } };
  g[`${p}paste`] = {
    class_type: 'ImageCompositeMasked',
    inputs: { destination: [decodeId, 0], source: backdrop, x: 0, y: 0, resize_source: false, mask: [opts.softSeam !== false ? `${p}soft` : `${p}keep`, 0] },
    _meta: { title: 'Keep scene: the photo, pixel for pixel, around her' },
  };
  g[samplerId] = { ...g[samplerId], inputs: { ...g[samplerId].inputs, latent_image: [`${p}noise`, 0], denoise: 1 } };
  // Painted-out overlays get a light second pass of their own: the plain fill smeared on foamy water (blue streaks,
  // 1 Nov), and at this strength the fill's shapes stay, so no letters can come back.
  let finalImage: Ref = [`${p}paste`, 0];
  if (opts.uiPaint && opts.uiMask && isRef(g[decodeId].inputs.vae)) {
    const k = g[samplerId].inputs;
    g[`${p}uigrow`] = { class_type: 'GrowMask', inputs: { mask: [`${p}ui`, 0], expand: 6, tapered_corners: true } };
    g[`${p}uienc`] = { class_type: 'VAEEncode', inputs: { pixels: [`${p}paste`, 0], vae: g[decodeId].inputs.vae } };
    g[`${p}uinoise`] = { class_type: 'SetLatentNoiseMask', inputs: { samples: [`${p}uienc`, 0], mask: [`${p}uigrow`, 0] } };
    g[`${p}uiks`] = {
      class_type: 'KSampler',
      inputs: { model: k.model, positive: k.positive, negative: k.negative, latent_image: [`${p}uinoise`, 0], seed: k.seed, steps: 20, cfg: k.cfg, sampler_name: k.sampler_name, scheduler: k.scheduler, denoise: UI_TOUCH_DENOISE },
      _meta: { title: 'Keep scene: texture where the overlays were' },
    };
    g[`${p}uidec`] = { class_type: 'VAEDecode', inputs: { samples: [`${p}uiks`, 0], vae: g[decodeId].inputs.vae } };
    g[`${p}uifix`] = { class_type: 'ImageCompositeMasked', inputs: { destination: [`${p}paste`, 0], source: [`${p}uidec`, 0], x: 0, y: 0, resize_source: false, mask: [`${p}uigrow`, 0] } };
    finalImage = [`${p}uifix`, 0];
  }
  // The garment's own outline from the photo (only the garment: Florence-2 segments the named pieces), so the cups and
  // straps follow the original instead of the model's default triangle top (31 Oct). Union ControlNet, canny mode.
  const gp = opts.garment?.phrases.filter(Boolean).slice(0, 3) ?? [];
  if (opts.garment && gp.length && opts.height && isRef(g[samplerId].inputs.positive) && isRef(g[samplerId].inputs.negative)) {
    g[`${p}fl`] = { class_type: 'DownloadAndLoadFlorence2Model', inputs: { model: FLORENCE_MODEL, precision: 'fp16' } };
    let garment: Ref | null = null;
    gp.forEach((phrase, i) => {
      g[`${p}seg${i}`] = {
        class_type: 'Florence2Run',
        inputs: { image: scene, florence2_model: [`${p}fl`, 0], text_input: phrase, task: 'referring_expression_segmentation', fill_mask: true, keep_model_loaded: i < gp.length - 1, max_new_tokens: 1024, num_beams: 3, do_sample: false, seed: 1 },
        _meta: { title: `Keep scene: find the ${phrase}` },
      };
      if (!garment) garment = [`${p}seg${i}`, 1];
      else {
        g[`${p}segadd${i}`] = { class_type: 'MaskComposite', inputs: { destination: garment, source: [`${p}seg${i}`, 1], x: 0, y: 0, operation: 'add' } };
        garment = [`${p}segadd${i}`, 0];
      }
    });
    g[`${p}gmask`] = { class_type: 'GrowMask', inputs: { mask: garment!, expand: 6, tapered_corners: true } };
    g[`${p}canny`] = { class_type: 'Canny', inputs: { image: scene, low_threshold: 0.15, high_threshold: 0.4 } };
    g[`${p}black`] = { class_type: 'EmptyImage', inputs: { width: opts.width, height: opts.height, batch_size: 1, color: 0 } };
    let lines: Ref = [`${p}black`, 0];
    if (opts.garment.body) {
      // her figure's outline too (bust, the gap between, waist), softer edges, never her head: words alone left the
      // bust pushed up and together where the photo's hung apart (1 Nov). Face + hair box grown well past the face.
      g[`${p}fdet`] = { class_type: 'UltralyticsDetectorProvider', inputs: { model_name: OUTFIT_FACE_MODEL } };
      g[`${p}face`] = { class_type: 'BboxDetectorCombined_v2', inputs: { bbox_detector: [`${p}fdet`, 0], image: scene, threshold: 0.3, dilation: Math.round(opts.width * 0.08) } };
      g[`${p}body`] = { class_type: 'MaskComposite', inputs: { destination: [`${p}person`, 0], source: [`${p}face`, 0], x: 0, y: 0, operation: 'subtract' }, _meta: { title: 'Keep scene: her body without the head' } };
      g[`${p}softcanny`] = { class_type: 'Canny', inputs: { image: scene, low_threshold: 0.08, high_threshold: 0.25 } };
      g[`${p}bodylines`] = {
        class_type: 'ImageCompositeMasked',
        inputs: { destination: lines, source: [`${p}softcanny`, 0], x: 0, y: 0, resize_source: false, mask: [`${p}body`, 0] },
        _meta: { title: 'Keep scene: her figure’s outline (no head)' },
      };
      lines = [`${p}bodylines`, 0];
    }
    g[`${p}lines`] = {
      class_type: 'ImageCompositeMasked',
      inputs: { destination: lines, source: [`${p}canny`, 0], x: 0, y: 0, resize_source: false, mask: [`${p}gmask`, 0] },
      _meta: { title: 'Keep scene: the garment’s outline' },
    };
    g[`${p}cn`] = { class_type: 'ControlNetLoader', inputs: { control_net_name: opts.garment.controlnet } };
    g[`${p}cntype`] = { class_type: 'SetUnionControlNetType', inputs: { control_net: [`${p}cn`, 0], type: 'canny/lineart/anime_lineart/mlsd' } };
    const lineSet = garmentLines();
    g[`${p}cnapply`] = {
      class_type: 'ControlNetApplyAdvanced',
      inputs: { positive: g[samplerId].inputs.positive, negative: g[samplerId].inputs.negative, control_net: [`${p}cntype`, 0], image: [`${p}lines`, 0], strength: lineSet.strength, start_percent: 0, end_percent: lineSet.end },
      _meta: { title: 'Keep scene: follow the garment’s outline' },
    };
    let cond: Ref = [`${p}cnapply`, 0];
    if (opts.garment.body && opts.garment.depth) {
      g[`${p}depth`] = { class_type: opts.garment.depth, inputs: { image: scene, ...DEPTH_INPUTS[opts.garment.depth] }, _meta: { title: 'Keep scene: depth of the photo' } };
      g[`${p}depthblack`] = { class_type: 'EmptyImage', inputs: { width: opts.width, height: opts.height, batch_size: 1, color: 0 } };
      g[`${p}bodydepth`] = {
        class_type: 'ImageCompositeMasked',
        inputs: { destination: [`${p}depthblack`, 0], source: [`${p}depth`, 0], x: 0, y: 0, resize_source: true, mask: [`${p}body`, 0] },
        _meta: { title: 'Keep scene: her figure’s depth (no head)' },
      };
      g[`${p}cndtype`] = { class_type: 'SetUnionControlNetType', inputs: { control_net: [`${p}cn`, 0], type: 'depth' } };
      g[`${p}cndapply`] = {
        class_type: 'ControlNetApplyAdvanced',
        inputs: { positive: [`${p}cnapply`, 0], negative: [`${p}cnapply`, 1], control_net: [`${p}cndtype`, 0], image: [`${p}bodydepth`, 0], strength: BODY_DEPTH.strength, start_percent: 0, end_percent: BODY_DEPTH.end },
        _meta: { title: 'Keep scene: follow her figure’s depth' },
      };
      cond = [`${p}cndapply`, 0];
    }
    g[samplerId].inputs.positive = cond;
    g[samplerId].inputs.negative = [cond[0], 1];
  }
  for (const [id, node] of Object.entries(g)) {
    // the paste and the person-finder read the raw redraw; the overlay touch-up reads the paste
    if (id === `${p}paste` || id === `${p}new`) continue;
    for (const [k, v] of Object.entries(node.inputs)) if (isRef(v) && v[0] === decodeId && v[1] === 0) node.inputs[k] = finalImage;
  }
  return g;
}
