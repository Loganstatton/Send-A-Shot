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

export const KEEP_SCENE_PREFIX = 'ks_';
/** How far past her outline the redraw reaches, as a share of the picture's width: room for Sienna's own hair and
 * figure, and none of the other person's edges left behind. */
export const KEEP_SCENE_GROW = 0.035;
export const UI_MASK_CLASS = 'SiennaUiMask';

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
export function addKeepScene(graph: ComfyGraph, opts: { width: number; uiMask?: boolean }): ComfyGraph | null {
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
  for (const [id, node] of Object.entries(g)) {
    if (id === `${p}paste`) continue;
    for (const [k, v] of Object.entries(node.inputs)) if (isRef(v) && v[0] === decodeId && v[1] === 0) node.inputs[k] = [`${p}paste`, 0];
  }
  return g;
}
