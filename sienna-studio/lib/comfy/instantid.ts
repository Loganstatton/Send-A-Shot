/**
 * InstantID on the face pass (cubiq/ComfyUI_InstantID, antelopev2 face analysis): Sienna's identity from her face
 * reference photos, taken by a face-recognition model rather than IP-Adapter's image features. The face pass's own
 * IP-Adapter Plus Face reached 0.6-0.7 against her reference (0.74 needed) whatever its denoise or weight (2 Nov:
 * 0.40-0.60 denoise, 0.35-0.60 weight, three photos), and ordinary pictures scored lower still.
 *
 * Only the identity part is used (cn_strength 0): the face pass works on a cropped, enlarged face, and InstantID's
 * keypoint ControlNet would read a hint made for the whole picture.
 */
import type { ComfyGraph } from '../types';

export const INSTANTID_CLASSES = ['InstantIDModelLoader', 'InstantIDFaceAnalysis', 'ApplyInstantIDAdvanced'] as const;
export const INSTANTID_FILE = 'ip-adapter.bin';
export const INSTANTID_CONTROLNET = 'instantid_controlnet.safetensors';
export const INSTANTID_WEIGHT = 0.8;

type Ref = [string, number];
const isRef = (v: unknown): v is Ref => Array.isArray(v) && typeof v[0] === 'string' && typeof v[1] === 'number';

/** The face reference image(s) the face pass's IP-Adapter reads (one photo or a batch). */
export function faceReferenceImage(graph: ComfyGraph, refineId: string): Ref | null {
  let ref = graph[refineId]?.inputs.model;
  for (let i = 0; i < 8 && isRef(ref); i++) {
    const n = graph[ref[0]];
    if (!n) return null;
    if (/^IPAdapter(Advanced)?$/.test(n.class_type) && isRef(n.inputs.image)) return n.inputs.image;
    ref = n.inputs.model;
  }
  return null;
}

/** The graph with InstantID applied to the face pass `refineId`, or null without a face pass or face reference. */
export function addInstantIdFacePass(graph: ComfyGraph, refineId: string, opts: { weight?: number } = {}): ComfyGraph | null {
  const face = graph[refineId];
  const image = faceReferenceImage(graph, refineId);
  if (!face || face.class_type !== 'FaceDetailer' || !image || graph.iid_apply) return null;
  const f = face.inputs;
  if (!isRef(f.model) || !isRef(f.positive) || !isRef(f.negative)) return null;
  return {
    ...graph,
    iid_model: { class_type: 'InstantIDModelLoader', inputs: { instantid_file: INSTANTID_FILE }, _meta: { title: 'InstantID' } },
    iid_face: { class_type: 'InstantIDFaceAnalysis', inputs: { provider: 'CPU' }, _meta: { title: 'InstantID face analysis' } },
    iid_cn: { class_type: 'ControlNetLoader', inputs: { control_net_name: INSTANTID_CONTROLNET } },
    iid_apply: {
      class_type: 'ApplyInstantIDAdvanced',
      inputs: {
        instantid: ['iid_model', 0], insightface: ['iid_face', 0], control_net: ['iid_cn', 0], image,
        model: f.model, positive: f.positive, negative: f.negative,
        ip_weight: opts.weight ?? INSTANTID_WEIGHT, cn_strength: 0, start_at: 0, end_at: 1, noise: 0, combine_embeds: 'average',
      },
      _meta: { title: 'Face pass: Sienna’s identity (InstantID)' },
    },
    [refineId]: { ...face, inputs: { ...f, model: ['iid_apply', 0], positive: ['iid_apply', 1], negative: ['iid_apply', 2] } },
  };
}
