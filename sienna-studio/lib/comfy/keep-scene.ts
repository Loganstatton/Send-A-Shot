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
export const GAP_FILL_CLASS = 'SiennaFillGaps';
/** The detail pass: her body only, at 1.5x, lightly (0.3 keeps the shapes, the cups and her face; it adds texture). */
export const DETAIL = { scale: 1.5, denoise: 0.3, steps: 20 } as const;
/** Source-locked copies' detail pass: 0.35 bared a nipple beside the photo's tiny cups on every boat try (scores
 * 0.77-0.80, 2 Nov), where 0.3 passed 7 of 7; it stays at 0.3. */
export const LOCK_DETAIL_DENOISE = 0.3;
// 0.5 left the inpainted gap's smear visible (a bright patch beside her face, a blurred tub edge by her hip, 1 Nov)
export const GAP_TOUCH_DENOISE = 0.7;
export const GAP_SCENE_POSITIVE = 'empty background, the scene only, photo texture';
export const GAP_SCENE_NEGATIVE = 'person, woman, body, skin, hand, hands, fingers, thumb, fingernail, arm, leg, face, hair, clothing, bikini, strings';
/** The CLIP feeding the prompt behind a conditioning ref (through ControlNet applies), or null. */
function clipOf(g: ComfyGraph, ref: unknown): Ref | null {
  for (let i = 0; i < 12 && isRef(ref); i++) {
    const n = g[ref[0]];
    if (!n) return null;
    if (n.class_type === 'CLIPTextEncode') return isRef(n.inputs.clip) ? (n.inputs.clip as Ref) : null;
    ref = n.inputs.positive ?? n.inputs.conditioning ?? n.inputs.conditioning_1;
  }
  return null;
}
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
/**
 * Source-locked copy (testing; the owner, 2 Nov: "the output should be nearly identical to the uploaded photograph,
 * with Sienna replacing the original subject"). The person is still drawn new (no pixel of the other woman is kept),
 * but locked to the photo: a tighter redraw region, her silhouette's own outline (from the person mask, no texture),
 * the figure's lines unblurred, and every guide held almost to the end of sampling.
 */
// First run (2 Nov, boat): a 1.5% redraw region put her edge on the blend seam (a cyan glow of the water round her), and
// guides held to 85-90% of the steps over-cooked the colour (orange skin, red hair, airbrushed); the shape is set in
// the first part of sampling, so the guides now let go earlier and the region is the normal one
export const SOURCE_LOCK = { grow: KEEP_SCENE_GROW, garment: { strength: 1.0, end: 0.8 }, body: { strength: 0.85, end: 0.7 }, depth: { strength: 0.8, end: 0.6 }, blurSigma: 0.8 } as const;
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
/** The figure's outline (bust, waist, legs) as its own, lighter guide. */
export const BODY_LINES = { strength: 0.55, end: 0.65 } as const;
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
  opts: { width: number; height?: number; uiMask?: boolean; uiPaint?: boolean; softSeam?: boolean; gapFill?: boolean; gapScene?: string; detail?: boolean; garment?: { phrases: string[]; controlnet: string; body?: boolean; depth?: DepthNode; twoPass?: boolean; sourceLock?: boolean } },
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
  const lock = !!opts.garment?.sourceLock;
  g[`${p}grow`] = { class_type: 'GrowMask', inputs: { mask: [`${p}person`, 0], expand: Math.round(opts.width * (lock ? SOURCE_LOCK.grow : KEEP_SCENE_GROW)), tapered_corners: true }, _meta: { title: 'Keep scene: room for Sienna' } };
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
  // Where the photo's person was but Sienna isn't, the redraw invented things (a green rail by her thigh, water where
  // the tub's edge was, 1 Nov): that gap is filled from the background round it and given texture by a light pass.
  if (opts.gapFill && isRef(g[decodeId].inputs.vae)) {
    const k = g[samplerId].inputs;
    g[`${p}gap`] = { class_type: 'MaskComposite', inputs: { destination: [`${p}oldgrow`, 0], source: [`${p}newgrow`, 0], x: 0, y: 0, operation: 'subtract' } };
    g[`${p}gapin`] = { class_type: 'MaskComposite', inputs: { destination: [`${p}gap`, 0], source: redraw, x: 0, y: 0, operation: 'multiply' } };
    g[`${p}gapgrow`] = { class_type: 'GrowMask', inputs: { mask: [`${p}gapin`, 0], expand: 4, tapered_corners: true } };
    g[`${p}gapfill`] = { class_type: GAP_FILL_CLASS, inputs: { image: finalImage, gap: [`${p}gapgrow`, 0], avoid: [`${p}new`, 0] }, _meta: { title: 'Keep scene: the scene continued where the other person was' } };
    g[`${p}gapenc`] = { class_type: 'VAEEncode', inputs: { pixels: [`${p}gapfill`, 0], vae: g[decodeId].inputs.vae } };
    g[`${p}gapnoise`] = { class_type: 'SetLatentNoiseMask', inputs: { samples: [`${p}gapenc`, 0], mask: [`${p}gapgrow`, 0] } };
    // the scene only, never her: with her prompt (and the pose guide) this pass drew loose thumbs and fingers where the
    // photo's hand had been, on every try of the pink copy (1 Nov)
    let gapPos = k.positive;
    let gapNeg = k.negative;
    const clip = clipOf(g, k.positive);
    if (clip) {
      g[`${p}gappos`] = { class_type: 'CLIPTextEncode', inputs: { clip, text: [opts.gapScene, GAP_SCENE_POSITIVE].filter(Boolean).join(', ') } };
      g[`${p}gapneg`] = { class_type: 'CLIPTextEncode', inputs: { clip, text: GAP_SCENE_NEGATIVE } };
      [gapPos, gapNeg] = [[`${p}gappos`, 0], [`${p}gapneg`, 0]];
    }
    g[`${p}gapks`] = {
      class_type: 'KSampler',
      inputs: { model: k.model, positive: gapPos, negative: gapNeg, latent_image: [`${p}gapnoise`, 0], seed: k.seed, steps: 20, cfg: k.cfg, sampler_name: k.sampler_name, scheduler: k.scheduler, denoise: GAP_TOUCH_DENOISE },
      _meta: { title: 'Keep scene: texture in the filled gap' },
    };
    g[`${p}gapdec`] = { class_type: 'VAEDecode', inputs: { samples: [`${p}gapks`, 0], vae: g[decodeId].inputs.vae } };
    g[`${p}gapfix`] = { class_type: 'ImageCompositeMasked', inputs: { destination: [`${p}gapfill`, 0], source: [`${p}gapdec`, 0], x: 0, y: 0, resize_source: false, mask: [`${p}gapgrow`, 0] } };
    finalImage = [`${p}gapfix`, 0];
  }
  if (opts.uiPaint && opts.uiMask && isRef(g[decodeId].inputs.vae)) {
    const k = g[samplerId].inputs;
    g[`${p}uigrow`] = { class_type: 'GrowMask', inputs: { mask: [`${p}ui`, 0], expand: 6, tapered_corners: true } };
    g[`${p}uienc`] = { class_type: 'VAEEncode', inputs: { pixels: finalImage, vae: g[decodeId].inputs.vae } };
    g[`${p}uinoise`] = { class_type: 'SetLatentNoiseMask', inputs: { samples: [`${p}uienc`, 0], mask: [`${p}uigrow`, 0] } };
    g[`${p}uiks`] = {
      class_type: 'KSampler',
      inputs: { model: k.model, positive: k.positive, negative: k.negative, latent_image: [`${p}uinoise`, 0], seed: k.seed, steps: 20, cfg: k.cfg, sampler_name: k.sampler_name, scheduler: k.scheduler, denoise: UI_TOUCH_DENOISE },
      _meta: { title: 'Keep scene: texture where the overlays were' },
    };
    g[`${p}uidec`] = { class_type: 'VAEDecode', inputs: { samples: [`${p}uiks`, 0], vae: g[decodeId].inputs.vae } };
    g[`${p}uifix`] = { class_type: 'ImageCompositeMasked', inputs: { destination: finalImage, source: [`${p}uidec`, 0], x: 0, y: 0, resize_source: false, mask: [`${p}uigrow`, 0] } };
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
    // only on her: a segmented string sliver running off her hip down into the water was drawn as a string down her
    // thigh (1 Nov)
    g[`${p}gonher`] = { class_type: 'MaskComposite', inputs: { destination: garment!, source: [`${p}oldgrow`, 0], x: 0, y: 0, operation: 'multiply' } };
    garment = [`${p}gonher`, 0];
    g[`${p}gmask`] = { class_type: 'GrowMask', inputs: { mask: garment!, expand: 6, tapered_corners: true } };
    // the garment's own shape, not its texture: the canny of the photo inside the garment traced every ruched fold of a
    // micro bikini's cups and the copy drew each fold as a separate string (open string cups, 1 Nov). The outline of
    // Florence-2's filled garment mask gives the solid panel's shape only.
    g[`${p}gimage`] = { class_type: 'MaskToImage', inputs: { mask: garment! } };
    g[`${p}canny`] = { class_type: 'Canny', inputs: { image: [`${p}gimage`, 0], low_threshold: 0.15, high_threshold: 0.4 } };
    g[`${p}black`] = { class_type: 'EmptyImage', inputs: { width: opts.width, height: opts.height, batch_size: 1, color: 0 } };
    let lines: Ref = [`${p}black`, 0];
    if (opts.garment.body) {
      // her figure's outline too (bust, the gap between, waist), softer edges, never her head: words alone left the
      // bust pushed up and together where the photo's hung apart (1 Nov). Face + hair box grown well past the face.
      g[`${p}fdet`] = { class_type: 'UltralyticsDetectorProvider', inputs: { model_name: OUTFIT_FACE_MODEL } };
      g[`${p}face`] = { class_type: 'BboxDetectorCombined_v2', inputs: { bbox_detector: [`${p}fdet`, 0], image: scene, threshold: 0.3, dilation: Math.round(opts.width * 0.08) } };
      g[`${p}body`] = { class_type: 'MaskComposite', inputs: { destination: [`${p}person`, 0], source: [`${p}face`, 0], x: 0, y: 0, operation: 'subtract' }, _meta: { title: 'Keep scene: her body without the head' } };
      // blurred a little first: the soft edges of fine detail (a tattoo on her side, skin texture) were drawn onto Sienna
      // as brown lines (1 Nov); a stronger blur (sigma 3) also lost the bikini cups' edges and every try drew the cups
      // see-through or as bare strings, so it stays light
      g[`${p}bodyblur`] = { class_type: 'ImageBlur', inputs: { image: scene, blur_radius: lock ? 2 : 3, sigma: lock ? SOURCE_LOCK.blurSigma : 1.5 } };
      g[`${p}softcanny`] = { class_type: 'Canny', inputs: { image: [`${p}bodyblur`, 0], low_threshold: 0.08, high_threshold: 0.25 } };
      g[`${p}bodylines`] = {
        class_type: 'ImageCompositeMasked',
        inputs: { destination: lines, source: [`${p}softcanny`, 0], x: 0, y: 0, resize_source: false, mask: [`${p}body`, 0] },
        _meta: { title: 'Keep scene: her figure’s outline (no head)' },
      };
      lines = [`${p}bodylines`, 0];
      // (a silhouette outline from the person mask was tried for source-locked copies: it drew a glowing edge round
      // her and didn't raise the silhouette match, 0.90 either way, 2 Nov)
    }
    // garment and figure are separate guides: in one image at 0.9 the photo's wider thighs and hips put their outline
    // on Sienna's slimmer legs and it was drawn as yellow strings down her thigh and round her hip (1 Nov); the figure
    // guides more lightly (BODY_LINES), the garment keeps its full strength
    const bodyLines: Ref | null = opts.garment.body ? lines : null;
    g[`${p}lines`] = {
      class_type: 'ImageCompositeMasked',
      inputs: { destination: [`${p}black`, 0], source: [`${p}canny`, 0], x: 0, y: 0, resize_source: false, mask: [`${p}gmask`, 0] },
      _meta: { title: 'Keep scene: the garment’s outline' },
    };
    g[`${p}cn`] = { class_type: 'ControlNetLoader', inputs: { control_net_name: opts.garment.controlnet } };
    g[`${p}cntype`] = { class_type: 'SetUnionControlNetType', inputs: { control_net: [`${p}cn`, 0], type: 'canny/lineart/anime_lineart/mlsd' } };
    const lineSet = lock ? SOURCE_LOCK.garment : garmentLines();
    // Body first, garment second (SIENNA_COPY_TWO_PASS / test.copyTwoPass): the first pass draws her without the
    // photo's garment outline (the garment in words only), so her own bust and waist come from her LoRA and the
    // depth guide; the outline is then fitted to her body in pass B below. Needs a DWPose node to copy.
    const poseTpl = Object.values(g).find((n) => n.class_type === 'DWPreprocessor');
    const twoPass = !lock && !!opts.garment.twoPass && !!poseTpl && isRef(g[decodeId].inputs.vae);
    let cond: Ref;
    let condNeg: Ref;
    if (twoPass) {
      cond = g[samplerId].inputs.positive as Ref;
      condNeg = g[samplerId].inputs.negative as Ref;
    } else {
      g[`${p}cnapply`] = {
        class_type: 'ControlNetApplyAdvanced',
        inputs: { positive: g[samplerId].inputs.positive, negative: g[samplerId].inputs.negative, control_net: [`${p}cntype`, 0], image: [`${p}lines`, 0], strength: lineSet.strength, start_percent: 0, end_percent: lineSet.end },
        _meta: { title: 'Keep scene: follow the garment’s outline' },
      };
      cond = [`${p}cnapply`, 0];
      condNeg = [`${p}cnapply`, 1];
    }
    if (bodyLines) {
      // the figure without the garment area (the garment guide has it)
      g[`${p}bodyonly`] = { class_type: 'ImageCompositeMasked', inputs: { destination: bodyLines, source: [`${p}black`, 0], x: 0, y: 0, resize_source: false, mask: [`${p}gmask`, 0] } };
      g[`${p}cnbody`] = {
        class_type: 'ControlNetApplyAdvanced',
        inputs: { positive: cond, negative: condNeg, control_net: [`${p}cntype`, 0], image: [`${p}bodyonly`, 0], strength: lock ? SOURCE_LOCK.body.strength : BODY_LINES.strength, start_percent: 0, end_percent: lock ? SOURCE_LOCK.body.end : BODY_LINES.end },
        _meta: { title: 'Keep scene: follow her figure’s outline (lightly)' },
      };
      cond = [`${p}cnbody`, 0];
      condNeg = [`${p}cnbody`, 1];
    }
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
        inputs: { positive: cond, negative: condNeg, control_net: [`${p}cndtype`, 0], image: [`${p}bodydepth`, 0], strength: lock ? SOURCE_LOCK.depth.strength : BODY_DEPTH.strength, start_percent: 0, end_percent: lock ? SOURCE_LOCK.depth.end : BODY_DEPTH.end },
        _meta: { title: 'Keep scene: follow her figure’s depth' },
      };
      cond = [`${p}cndapply`, 0];
      condNeg = [`${p}cndapply`, 1];
    }
    g[samplerId].inputs.positive = cond;
    g[samplerId].inputs.negative = condNeg;
    if (twoPass) finalImage = addGarmentPass(g, { samplerId, decodeId, scene, image: finalImage, phrases: gp, width: opts.width, poseInputs: poseTpl!.inputs, cond, condNeg });
  }
  // Detail pass: her body redrawn lightly at 1.5x and scaled back, for real skin texture and detail (the owner,
  // 1 Nov: the copies' body looked airbrushed). Same conditioning as the redraw (her prompt, pose and outline guides);
  // only where she is (feathered), so the scene stays the photo's.
  if (opts.detail && opts.height && isRef(g[decodeId].inputs.vae)) {
    const k = g[samplerId].inputs;
    const r8 = (n: number) => Math.round(n / 8) * 8;
    const [w, h] = [opts.width, opts.height];
    g[`${p}detup`] = { class_type: 'ImageScale', inputs: { image: finalImage, upscale_method: 'lanczos', width: r8(w * DETAIL.scale), height: r8(h * DETAIL.scale), crop: 'disabled' } };
    g[`${p}detenc`] = { class_type: 'VAEEncode', inputs: { pixels: [`${p}detup`, 0], vae: g[decodeId].inputs.vae } };
    g[`${p}detmask0`] = { class_type: 'GrowMask', inputs: { mask: [`${p}new`, 0], expand: 6, tapered_corners: true } };
    let detMask: Ref = [`${p}detmask0`, 0];
    // never over the garment or just round it: at tiny cups the pass turned a cup's edge into a bare nipple and every
    // try of the boat copy was thrown away (1 Nov); the cups keep the main redraw's coverage
    if (g[`${p}gmask`]) {
      // (two-pass: the garment where it now sits on her, not where it sat in the photo)
      g[`${p}detkeep`] = { class_type: 'GrowMask', inputs: { mask: [g[`${p}bmask`] ? `${p}bmask` : `${p}gmask`, 0], expand: Math.round(w * 0.03), tapered_corners: true } };
      g[`${p}detmaskg`] = { class_type: 'MaskComposite', inputs: { destination: detMask, source: [`${p}detkeep`, 0], x: 0, y: 0, operation: 'subtract' } };
      detMask = [`${p}detmaskg`, 0];
    }
    g[`${p}detmask`] = { class_type: 'GrowMask', inputs: { mask: detMask, expand: 0, tapered_corners: true } };
    g[`${p}detnoise`] = { class_type: 'SetLatentNoiseMask', inputs: { samples: [`${p}detenc`, 0], mask: [`${p}detmask`, 0] } };
    g[`${p}detks`] = {
      class_type: 'KSampler',
      inputs: { model: k.model, positive: k.positive, negative: k.negative, latent_image: [`${p}detnoise`, 0], seed: k.seed, steps: DETAIL.steps, cfg: k.cfg, sampler_name: k.sampler_name, scheduler: k.scheduler, denoise: lock ? LOCK_DETAIL_DENOISE : DETAIL.denoise },
      _meta: { title: 'Keep scene: detail pass on her (1.5x)' },
    };
    g[`${p}detdec`] = { class_type: 'VAEDecode', inputs: { samples: [`${p}detks`, 0], vae: g[decodeId].inputs.vae } };
    g[`${p}detdown`] = { class_type: 'ImageScale', inputs: { image: [`${p}detdec`, 0], upscale_method: 'lanczos', width: w, height: h, crop: 'disabled' } };
    g[`${p}detsoft`] = { class_type: SOFT_SEAM_CLASS, inputs: { mask: [`${p}detmask`, 0], kernel_size: 15, sigma: 5 } };
    g[`${p}detfix`] = { class_type: 'ImageCompositeMasked', inputs: { destination: finalImage, source: [`${p}detdown`, 0], x: 0, y: 0, resize_source: false, mask: [`${p}detsoft`, 0] } };
    finalImage = [`${p}detfix`, 0];
  }
  for (const [id, node] of Object.entries(g)) {
    // the paste and the person-finder read the raw redraw; the overlay touch-up reads the paste
    if (id === `${p}paste` || id === `${p}new`) continue;
    for (const [k, v] of Object.entries(node.inputs)) if (isRef(v) && v[0] === decodeId && v[1] === 0) node.inputs[k] = finalImage;
  }
  return g;
}

/** Pass B of the two-pass copy: the garment fitted to her body. */
export const GARMENT_PASS = { denoise: 0.75, steps: 30, lines: 0.75, end: 0.6 } as const;
export const WARP_GARMENT_CLASS = 'SiennaWarpGarment';
function addGarmentPass(
  g: ComfyGraph,
  o: { samplerId: string; decodeId: string; scene: Ref; image: Ref; phrases: string[]; width: number; poseInputs: Record<string, unknown>; cond: Ref; condNeg: Ref },
): Ref {
  const p = KEEP_SCENE_PREFIX;
  const k = g[o.samplerId].inputs;
  const vae = g[o.decodeId].inputs.vae;
  // where the garment sat on the photo's torso, moved onto hers (DWPose on the photo and on pass A)
  g[`${p}ppose`] = { class_type: 'DWPreprocessor', inputs: { ...o.poseInputs, image: o.scene }, _meta: { title: 'Keep scene: the photo’s pose (for the garment)' } };
  g[`${p}hpose`] = { class_type: 'DWPreprocessor', inputs: { ...o.poseInputs, image: o.image }, _meta: { title: 'Keep scene: her pose after pass A' } };
  g[`${p}gwarp`] = { class_type: WARP_GARMENT_CLASS, inputs: { mask: [`${p}gonher`, 0], photo_pose: [`${p}ppose`, 1], her_pose: [`${p}hpose`, 1] }, _meta: { title: 'Keep scene: the photo’s garment moved onto her' } };
  // and where pass A drew her garment, so none of it is left outside the redraw
  let herG: Ref | null = null;
  o.phrases.forEach((phrase, i) => {
    g[`${p}hseg${i}`] = {
      class_type: 'Florence2Run',
      inputs: { image: o.image, florence2_model: [`${p}fl`, 0], text_input: phrase, task: 'referring_expression_segmentation', fill_mask: true, keep_model_loaded: i < o.phrases.length - 1, max_new_tokens: 1024, num_beams: 3, do_sample: false, seed: 1 },
      _meta: { title: `Keep scene: her ${phrase} after pass A` },
    };
    if (!herG) herG = [`${p}hseg${i}`, 1];
    else {
      g[`${p}hsegadd${i}`] = { class_type: 'MaskComposite', inputs: { destination: herG, source: [`${p}hseg${i}`, 1], x: 0, y: 0, operation: 'add' } };
      herG = [`${p}hsegadd${i}`, 0];
    }
  });
  g[`${p}bunion`] = herG
    ? { class_type: 'MaskComposite', inputs: { destination: [`${p}gwarp`, 0], source: herG, x: 0, y: 0, operation: 'add' } }
    : { class_type: 'GrowMask', inputs: { mask: [`${p}gwarp`, 0], expand: 0, tapered_corners: true } };
  // only on her
  g[`${p}bher`] = { class_type: 'GrowMask', inputs: { mask: [`${p}new`, 0], expand: Math.round(o.width * 0.02), tapered_corners: true } };
  g[`${p}bon`] = { class_type: 'MaskComposite', inputs: { destination: [`${p}bunion`, 0], source: [`${p}bher`, 0], x: 0, y: 0, operation: 'multiply' } };
  g[`${p}bmask`] = { class_type: 'GrowMask', inputs: { mask: [`${p}bon`, 0], expand: Math.round(o.width * 0.03), tapered_corners: true }, _meta: { title: 'Keep scene: pass B region (her garment)' } };
  // the moved garment's outline as the guide
  g[`${p}bgimage`] = { class_type: 'MaskToImage', inputs: { mask: [`${p}gwarp`, 0] } };
  g[`${p}bcanny`] = { class_type: 'Canny', inputs: { image: [`${p}bgimage`, 0], low_threshold: 0.15, high_threshold: 0.4 } };
  g[`${p}bgrow`] = { class_type: 'GrowMask', inputs: { mask: [`${p}gwarp`, 0], expand: 6, tapered_corners: true } };
  g[`${p}blines`] = { class_type: 'ImageCompositeMasked', inputs: { destination: [`${p}black`, 0], source: [`${p}bcanny`, 0], x: 0, y: 0, resize_source: false, mask: [`${p}bgrow`, 0] } };
  g[`${p}bcn`] = {
    class_type: 'ControlNetApplyAdvanced',
    inputs: { positive: o.cond, negative: o.condNeg, control_net: [`${p}cntype`, 0], image: [`${p}blines`, 0], strength: GARMENT_PASS.lines, start_percent: 0, end_percent: GARMENT_PASS.end },
    _meta: { title: 'Keep scene: pass B follows the garment fitted to her' },
  };
  g[`${p}benc`] = { class_type: 'VAEEncode', inputs: { pixels: o.image, vae } };
  g[`${p}bnoise`] = { class_type: 'SetLatentNoiseMask', inputs: { samples: [`${p}benc`, 0], mask: [`${p}bmask`, 0] } };
  g[`${p}bks`] = {
    class_type: 'KSampler',
    inputs: { model: k.model, positive: [`${p}bcn`, 0], negative: [`${p}bcn`, 1], latent_image: [`${p}bnoise`, 0], seed: k.seed, steps: GARMENT_PASS.steps, cfg: k.cfg, sampler_name: k.sampler_name, scheduler: k.scheduler, denoise: GARMENT_PASS.denoise },
    _meta: { title: 'Keep scene: pass B (garment on her body)' },
  };
  g[`${p}bdec`] = { class_type: 'VAEDecode', inputs: { samples: [`${p}bks`, 0], vae } };
  g[`${p}bsoft`] = { class_type: SOFT_SEAM_CLASS, inputs: { mask: [`${p}bmask`, 0], kernel_size: 15, sigma: 5 } };
  g[`${p}bfix`] = { class_type: 'ImageCompositeMasked', inputs: { destination: o.image, source: [`${p}bdec`, 0], x: 0, y: 0, resize_source: false, mask: [`${p}bsoft`, 0] } };
  return [`${p}bfix`, 0];
}

/**
 * Cover-up: a nipple showing beside a copied micro top is redrawn as the top's fabric instead of the whole copy being
 * thrown away. The photo's tiny cups traced onto Sienna's own figure missed her nipples on every try of the boat photo
 * (1 Nov: 3 of 3 tries scored 0.79-0.83 while the photo itself scored covered). SiennaCoverMask marks a small ellipse
 * over each nipple NudeNet finds (nothing when none); only that patch is redrawn, with a fabric-only prompt, and the
 * top check still runs on the result.
 */
export const COVER_MASK_CLASS = 'SiennaCoverMask';
// filled with the garment's colour first, the redraw only adds fabric texture (0.5); without a known colour it has to
// redraw more (0.75 alone kept the nipple's dark spot on every try, 2 Nov)
export const COVER = { denoise: 0.75, filledDenoise: 0.5, steps: 24, grow: 6, radius: 0.3, secondRadius: 0.3 } as const;
/** Garment colour words → the fill colour (most specific first). */
const COVER_COLOURS: [RegExp, string][] = [
  [/\bhot pink|fuchsia|magenta\b/, '#e0287a'], [/\b(baby|light|pastel) pink\b/, '#f2b6c8'], [/\bpink\b/, '#e98aa9'],
  [/\bwhite|ivory\b/, '#f2f1ee'], [/\bcream\b/, '#efe6d2'], [/\bblack\b/, '#161616'], [/\bred\b/, '#b3161e'],
  [/\b(neon|lime) green\b/, '#9be12a'], [/\b(sage|olive) green\b/, '#8c9a6e'], [/\bgreen\b/, '#2f8a46'],
  [/\b(navy|dark) blue\b/, '#1d2a4d'], [/\b(baby|light|sky) blue\b/, '#9cc8ec'], [/\bblue\b/, '#2f5fb3'],
  [/\byellow\b/, '#f2d23c'], [/\borange\b/, '#f0802a'], [/\b(purple|violet|lilac|lavender)\b/, '#8a5cc2'],
  [/\b(beige|nude|tan)\b/, '#d8b896'], [/\bbrown\b/, '#6b4430'], [/\b(grey|gray|silver)\b/, '#a3a3a3'], [/\bgold\b/, '#d4af37'],
];
/** The fill colour for a garment phrase, or '' when it names none. */
export function coverColour(top: string): string {
  const t = top.toLowerCase();
  return COVER_COLOURS.find(([re]) => re.test(t))?.[1] ?? '';
}
// "fabric cup" drew moulded seashell cups (pasties with ridges, then big shells with a bow over both breasts, round 47,
// 2 Nov): the patch is described as thin flat fabric, and shells and padding are kept out
export const COVER_NEGATIVE = 'nipple, nipples, areola, bare breast, exposed breast, see-through, sheer, mesh, transparent, hole, gap, strings, seashell, shell bikini, scalloped, moulded cup, padded cup, bow, ribbon, ornament, brooch';
/** The graph with the cover-up before SaveImage (and before the colour step, which then matches its colour), or null
 * without a keep-scene redraw in it. `top` names the garment, e.g. "tiny white micro string bikini top". */
export function addCoverUp(graph: ComfyGraph, opts: { top: string; threshold: number }): ComfyGraph | null {
  const p = KEEP_SCENE_PREFIX;
  const saveId = Object.keys(graph).find((id) => graph[id].class_type === 'SaveImage');
  const samplerId = Object.keys(graph).find((id) => graph[id].class_type === 'KSampler' && isRef(graph[id].inputs.latent_image) && (graph[id].inputs.latent_image as Ref)[0] === `${p}noise`);
  if (!saveId || !samplerId) return null;
  const decodeId = Object.keys(graph).find((id) => graph[id].class_type === 'VAEDecode' && isRef(graph[id].inputs.samples) && (graph[id].inputs.samples as Ref)[0] === samplerId);
  const image = graph[saveId].inputs.images;
  const k = graph[samplerId].inputs;
  const vae = decodeId ? graph[decodeId].inputs.vae : null;
  const clip = clipOf(graph, k.positive);
  if (!isRef(image) || !isRef(vae) || !clip) return null;
  const g: ComfyGraph = { ...graph };
  const fill = coverColour(opts.top);
  g[`${p}covpos`] = { class_type: 'CLIPTextEncode', inputs: { clip, text: `${opts.top}, (thin smooth opaque fabric lying flat on the skin over the nipple:1.35), part of the same small bikini triangle, natural skin, photo` } };
  g[`${p}covneg`] = { class_type: 'CLIPTextEncode', inputs: { clip, text: COVER_NEGATIVE } };
  // Round 1 covers the areola found by colour; round 2 checks again and covers whatever still shows with a larger
  // patch at the breast's middle (the colour search took the crease under a breast for the nipple once, 2 Nov).
  const round = (s: string, from: Ref, locate: boolean, radius: number): Ref => {
    g[`${p}covmask${s}`] = { class_type: COVER_MASK_CLASS, inputs: { image: from, threshold: opts.threshold, fill, locate, radius }, _meta: { title: `Keep scene: where a nipple shows (${s ? 'second look' : 'first look'})` } };
    g[`${p}covgrow${s}`] = { class_type: 'GrowMask', inputs: { mask: [`${p}covmask${s}`, 0], expand: COVER.grow, tapered_corners: true } };
    g[`${p}covenc${s}`] = { class_type: 'VAEEncode', inputs: { pixels: [`${p}covmask${s}`, 2], vae } };
    g[`${p}covnoise${s}`] = { class_type: 'SetLatentNoiseMask', inputs: { samples: [`${p}covenc${s}`, 0], mask: [`${p}covgrow${s}`, 0] } };
    g[`${p}covks${s}`] = {
      class_type: 'KSampler',
      inputs: { model: k.model, positive: [`${p}covpos`, 0], negative: [`${p}covneg`, 0], latent_image: [`${p}covnoise${s}`, 0], seed: k.seed, steps: COVER.steps, cfg: k.cfg, sampler_name: k.sampler_name, scheduler: k.scheduler, denoise: fill ? COVER.filledDenoise : COVER.denoise },
      _meta: { title: 'Keep scene: cover-up (fabric over a showing nipple)' },
    };
    g[`${p}covdec${s}`] = { class_type: 'VAEDecode', inputs: { samples: [`${p}covks${s}`, 0], vae } };
    g[`${p}covsoft${s}`] = { class_type: SOFT_SEAM_CLASS, inputs: { mask: [`${p}covgrow${s}`, 0], kernel_size: 9, sigma: 3 } };
    // an empty mask (nothing showing) leaves the photo exactly as it was
    g[`${p}cover${s}`] = { class_type: 'ImageCompositeMasked', inputs: { destination: from, source: [`${p}covdec${s}`, 0], x: 0, y: 0, resize_source: false, mask: [`${p}covsoft${s}`, 0] } };
    return [`${p}cover${s}`, 0];
  };
  const first = round('', image, true, COVER.radius);
  const second = round('2', first, false, COVER.secondRadius);
  g[saveId] = { ...g[saveId], inputs: { ...g[saveId].inputs, images: second } };
  return g;
}

/** Copy Photo hand check (SiennaHandCheck): the copy keeps every hand the photo shows. The photo checker passed a boat
 * copy whose hand on her hip was a thumb-like lump (2 Nov); MediaPipe found 2 hands in the photo and 1 in that copy. */
export const HAND_CHECK_CLASS = 'SiennaHandCheck';
export const HAND_CHECK_NODE_ID = `${KEEP_SCENE_PREFIX}hands`;
/** The hand-check node reading the image that goes into SaveImage, or null without a keep-scene redraw. */
export function handCheckNode(graph: ComfyGraph): ComfyGraph[string] | null {
  const saveId = Object.keys(graph).find((id) => graph[id].class_type === 'SaveImage');
  const person = graph[`${KEEP_SCENE_PREFIX}person`];
  const image = saveId ? graph[saveId].inputs.images : undefined;
  if (!person || !isRef(image) || !isRef(person.inputs.image)) return null;
  return { class_type: HAND_CHECK_CLASS, inputs: { photo: person.inputs.image, image }, _meta: { title: 'Copy: every hand of the photo kept' } };
}
/** The hand check's verdict: false when the copy lost a hand the photo shows; undefined when it didn't run. */
export function parseHandCheck(texts: string[] | undefined): { ok: boolean; photo: number; copy: number } | undefined {
  try {
    const r = JSON.parse(texts?.[0] ?? '');
    return r && r.available && typeof r.ok === 'boolean' ? { ok: r.ok, photo: Number(r.photo) || 0, copy: Number(r.copy) || 0 } : undefined;
  } catch {
    return undefined;
  }
}

/** The copy's outfit and skin colours taken from the photo's pixels (SiennaCopyColours): words drifted them — a purple
 * bikini drawn royal blue, a pale woman under grey light drawn deeply bronzed (1 Nov). */
export const COPY_COLOURS_CLASS = 'SiennaCopyColours';
export const COPY_COLOURS = { clothes: 1.0, skin: 0.8 } as const;
/** The graph with the colour step as the last change before SaveImage, or null without a keep-scene redraw in it. */
export function addCopyColours(graph: ComfyGraph, opts: { clothes?: number; skin?: number } = {}): ComfyGraph | null {
  const p = KEEP_SCENE_PREFIX;
  const saveId = Object.keys(graph).find((id) => graph[id].class_type === 'SaveImage');
  const person = graph[`${p}person`];
  if (!saveId || !person || !graph[`${p}new`] || !graph[`${p}oldgrow`]) return null;
  const image = graph[saveId].inputs.images;
  if (!isRef(image) || !isRef(person.inputs.image)) return null;
  return {
    ...graph,
    [`${p}colours`]: {
      class_type: COPY_COLOURS_CLASS,
      inputs: {
        photo: person.inputs.image,
        image,
        region: [`${p}new`, 0],
        // the photo's garment colour read only on the garment itself (Florence-2's mask, when the outline guide ran):
        // the segmenter called foam round her legs "clothes" and the copy's yellow bikini was turned white (1 Nov)
        photo_region: graph[`${p}gmask`] ? [`${p}gmask`, 0] : [`${p}oldgrow`, 0],
        clothes: opts.clothes ?? COPY_COLOURS.clothes,
        skin: opts.skin ?? COPY_COLOURS.skin,
      },
      _meta: { title: 'Keep scene: outfit and skin colours from the photo' },
    },
    [saveId]: { ...graph[saveId], inputs: { ...graph[saveId].inputs, images: [`${p}colours`, 0] } },
  };
}
