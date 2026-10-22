/**
 * Keep-person correction: redraw only what is around her.
 *
 * When a photo has her right — face, outfit, pose, camera, anatomy — and only the room or the light is wrong,
 * a full redo puts all of that at risk: in the living-room test a "gray sofa" correction turned a correct black
 * turtleneck and beige trousers into a gray top and gray trousers on the same seed, and the next correction swapped
 * the two colours (22 Oct). Prompt wording can't stop that: SDXL doesn't reliably bind a colour to its object.
 * So instead the earlier photo is the starting point, the person is found with the person segmenter, and only the
 * background is re-sampled (latent noise mask); she is then pasted back pixel for pixel. What was correct can't change.
 *
 *   LoadImage (earlier photo, from the output folder)
 *     ├─► SegmDetectorCombined_v2 (person) ─► GrowMask ─► InvertMask ─► SetLatentNoiseMask ◄─ VAEEncode
 *     │                                                                       └─► KSampler (corrected prompt)
 *     └─────────────────────────────── ImageCompositeMasked (her, unchanged) ◄─ VAEDecode
 *
 * Her face and hand touch-up passes are skipped (she was refined in the earlier photo; they would only change her).
 * Limitation: light that should fall on her (golden light on her skin) can't be added this way — only the light in
 * the room and the shadows on the floor.
 */
import type { ComfyGraph } from '../types';
import { PERSON_SEGM_FILE } from '../outfit-edit';

export const KEEP_PERSON_PREFIX = 'kp_';
/** Background redraw strength: the room is rebuilt, but keeps the earlier photo's perspective and floor line. */
export const KEEP_PERSON_DENOISE = 0.9;
/** Pixels around her kept out of the redraw so her outline doesn't change. */
const EDGE_PX = 10;

type Ref = [string, number];
const isRef = (v: unknown): v is Ref => Array.isArray(v) && typeof v[0] === 'string' && typeof v[1] === 'number';

/** A saved ComfyUI image as LoadImage can read it straight from the output folder. */
export function outputImageName(img: { filename: string; subfolder?: string }): string {
  return `${img.subfolder ? `${img.subfolder}/` : ''}${img.filename} [output]`;
}

/**
 * The graph with the keep-person redraw wired in, or null when the graph has no plain KSampler → VAEDecode first pass
 * to attach to (then the caller falls back to a normal correction).
 */
export function addKeepPerson(
  graph: ComfyGraph,
  image: { filename: string; subfolder?: string } | { inputName: string },
  denoise = KEEP_PERSON_DENOISE,
): ComfyGraph | null {
  const original = structuredClone(graph);
  const g: ComfyGraph = structuredClone(graph);
  // the first pass: a KSampler fed by an empty (or encoded) latent, decoded by a VAEDecode
  const samplerId = Object.keys(g).find((id) => g[id].class_type === 'KSampler' && isRef(g[id].inputs.latent_image) && ['EmptyLatentImage', 'VAEEncode'].includes(g[(g[id].inputs.latent_image as Ref)[0]]?.class_type));
  if (!samplerId) return null;
  const decodeId = Object.keys(g).find((id) => g[id].class_type === 'VAEDecode' && isRef(g[id].inputs.samples) && (g[id].inputs.samples as Ref)[0] === samplerId);
  if (!decodeId || !isRef(g[decodeId].inputs.vae)) return null;
  const vae = g[decodeId].inputs.vae as Ref;
  const p = KEEP_PERSON_PREFIX;
  const rewire = (from: Ref, to: Ref, skip: string) => {
    for (const [id, node] of Object.entries(g)) {
      if (id === skip) continue;
      for (const [k, v] of Object.entries(node.inputs)) if (isRef(v) && v[0] === from[0] && v[1] === from[1]) node.inputs[k] = to;
    }
  };

  g[`${p}load`] = { class_type: 'LoadImage', inputs: { image: 'inputName' in image ? image.inputName : outputImageName(image) }, _meta: { title: 'Keep person: earlier photo' } };
  g[`${p}segm`] = { class_type: 'UltralyticsDetectorProvider', inputs: { model_name: PERSON_SEGM_FILE } };
  g[`${p}person`] = { class_type: 'SegmDetectorCombined_v2', inputs: { segm_detector: [`${p}segm`, 1], image: [`${p}load`, 0], threshold: 0.4, dilation: 0 } };
  g[`${p}grow`] = { class_type: 'GrowMask', inputs: { mask: [`${p}person`, 0], expand: EDGE_PX, tapered_corners: true } };
  g[`${p}background`] = { class_type: 'InvertMask', inputs: { mask: [`${p}grow`, 0] } };
  g[`${p}encode`] = { class_type: 'VAEEncode', inputs: { pixels: [`${p}load`, 0], vae } };
  g[`${p}noise`] = { class_type: 'SetLatentNoiseMask', inputs: { samples: [`${p}encode`, 0], mask: [`${p}background`, 0] } };
  // her, pixel for pixel, over the redrawn room (the grown mask, so the redraw's edge sits outside her outline)
  g[`${p}paste`] = {
    class_type: 'ImageCompositeMasked',
    inputs: { destination: [decodeId, 0], source: [`${p}load`, 0], x: 0, y: 0, resize_source: false, mask: [`${p}grow`, 0] },
    // the graph as it was, for when a later attempt needs a fresh composition again (stripKeepPerson)
    _meta: { title: 'Keep person: paste her back', original },
  };
  g[samplerId] = { ...g[samplerId], inputs: { ...g[samplerId].inputs, latent_image: [`${p}noise`, 0], denoise } };
  rewire([decodeId, 0], [`${p}paste`, 0], `${p}paste`);
  // her face and hands were already refined in the earlier photo: the touch-up passes would only change them
  for (const id of Object.keys(g).filter((id) => g[id].class_type === 'FaceDetailer' && isRef(g[id].inputs.image))) {
    rewire([id, 0], g[id].inputs.image as Ref, id);
    delete g[id];
  }
  return g;
}

/** The graph without a keep-person redraw (the next correction may need a fresh composition). */
export function stripKeepPerson(graph: ComfyGraph): ComfyGraph {
  const original = graph[`${KEEP_PERSON_PREFIX}paste`]?._meta?.original as ComfyGraph | undefined;
  return original ? structuredClone(original) : graph;
}
