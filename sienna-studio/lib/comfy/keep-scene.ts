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
import { FLORENCE_MODEL } from '../outfit';

export const KEEP_SCENE_PREFIX = 'ks_';
/** How far past her outline the redraw reaches, as a share of the picture's width: room for Sienna's own hair and
 * figure, and none of the other person's edges left behind. */
export const KEEP_SCENE_GROW = 0.035;
export const UI_MASK_CLASS = 'SiennaUiMask';
/** xinsir ControlNet Union SDXL (ProMax), Apache-2.0: its canny/lineart mode traces the photo's garment edges. */
export const UNION_CN_FILE = 'xinsir_union_promax.safetensors';
export const UNION_CN_URL = 'https://huggingface.co/xinsir/controlnet-union-sdxl-1.0/resolve/main/diffusion_pytorch_model_promax.safetensors';
export const GARMENT_LINES_CLASSES = ['Florence2Run', 'DownloadAndLoadFlorence2Model', 'Canny', 'SetUnionControlNetType', 'EmptyImage'];
/** How hard the garment's outline steers the redraw, and for how much of it (the end is left free for detail). */
export const GARMENT_LINES = { strength: 0.75, end: 0.65 } as const;

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
  opts: { width: number; height?: number; uiMask?: boolean; garment?: { phrases: string[]; controlnet: string } },
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
  if (opts.uiMask) {
    g[`${p}ui`] = { class_type: UI_MASK_CLASS, inputs: { image: scene }, _meta: { title: 'Keep scene: app overlays' } };
    g[`${p}union`] = { class_type: 'MaskComposite', inputs: { destination: [`${p}grow`, 0], source: [`${p}ui`, 0], x: 0, y: 0, operation: 'add' } };
    redraw = [`${p}union`, 0];
  }
  g[`${p}noise`] = { class_type: 'SetLatentNoiseMask', inputs: { samples: [encodeId, 0], mask: redraw }, _meta: { title: 'Keep scene: redraw only her' } };
  g[`${p}keep`] = { class_type: 'InvertMask', inputs: { mask: redraw } };
  g[`${p}paste`] = {
    class_type: 'ImageCompositeMasked',
    inputs: { destination: [decodeId, 0], source: scene, x: 0, y: 0, resize_source: false, mask: [`${p}keep`, 0] },
    _meta: { title: 'Keep scene: the photo, pixel for pixel, around her' },
  };
  g[samplerId] = { ...g[samplerId], inputs: { ...g[samplerId].inputs, latent_image: [`${p}noise`, 0], denoise: 1 } };
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
    g[`${p}lines`] = {
      class_type: 'ImageCompositeMasked',
      inputs: { destination: [`${p}black`, 0], source: [`${p}canny`, 0], x: 0, y: 0, resize_source: false, mask: [`${p}gmask`, 0] },
      _meta: { title: 'Keep scene: the garment’s outline only' },
    };
    g[`${p}cn`] = { class_type: 'ControlNetLoader', inputs: { control_net_name: opts.garment.controlnet } };
    g[`${p}cntype`] = { class_type: 'SetUnionControlNetType', inputs: { control_net: [`${p}cn`, 0], type: 'canny/lineart/anime_lineart/mlsd' } };
    g[`${p}cnapply`] = {
      class_type: 'ControlNetApplyAdvanced',
      inputs: { positive: g[samplerId].inputs.positive, negative: g[samplerId].inputs.negative, control_net: [`${p}cntype`, 0], image: [`${p}lines`, 0], strength: GARMENT_LINES.strength, start_percent: 0, end_percent: GARMENT_LINES.end },
      _meta: { title: 'Keep scene: follow the garment’s outline' },
    };
    g[samplerId].inputs.positive = [`${p}cnapply`, 0];
    g[samplerId].inputs.negative = [`${p}cnapply`, 1];
  }
  for (const [id, node] of Object.entries(g)) {
    if (id === `${p}paste`) continue;
    for (const [k, v] of Object.entries(node.inputs)) if (isRef(v) && v[0] === decodeId && v[1] === 0) node.inputs[k] = [`${p}paste`, 0];
  }
  return g;
}
