/**
 * Pose check job: the pose photo → (optional pad to the output shape) → DWPose skeleton →
 * (optional retarget to Sienna's proportions). Lets the user see exactly what the ControlNet
 * will get, and gives the framing check the skeleton's visible extent. Same node settings
 * as the production workflow's pose module.
 */

import type { ComfyGraph } from './types';

export const POSE_DETECT_NODE = '3';
export const POSE_SKELETON_PREVIEW = '4';
export const POSE_RETARGET_NODE = '5';
export const POSE_RETARGET_PREVIEW = '6';

export const DWPOSE_INPUTS = {
  detect_hand: 'enable',
  detect_body: 'enable',
  detect_face: 'disable',
  resolution: 1024,
  bbox_detector: 'yolox_l.onnx',
  pose_estimator: 'dw-ll_ucoco_384.onnx',
  scale_stick_for_xinsr_cn: 'enable',
} as const;

export function buildPoseCheckGraph(
  uploadedName: string,
  opts: { pad?: { left: number; top: number; right: number; bottom: number } | null; retarget?: number; proportions?: Record<string, number> } = {},
): ComfyGraph {
  const g: ComfyGraph = {
    '1': { class_type: 'LoadImage', inputs: { image: uploadedName }, _meta: { title: 'Pose Photo' } },
  };
  let src: [string, number] = ['1', 0];
  if (opts.pad) {
    g['2'] = { class_type: 'ImagePadForOutpaint', inputs: { image: ['1', 0], ...opts.pad, feathering: 0 }, _meta: { title: 'Pad To Output Shape' } };
    src = ['2', 0];
  }
  g[POSE_DETECT_NODE] = { class_type: 'DWPreprocessor', inputs: { image: src, ...DWPOSE_INPUTS }, _meta: { title: 'Skeleton (DWPose)' } };
  g[POSE_SKELETON_PREVIEW] = { class_type: 'PreviewImage', inputs: { images: [POSE_DETECT_NODE, 0] }, _meta: { title: 'Skeleton' } };
  if ((opts.retarget ?? 0) > 0) {
    g[POSE_RETARGET_NODE] = {
      class_type: 'SiennaPoseRetarget',
      inputs: { pose_keypoint: [POSE_DETECT_NODE, 1], strength: opts.retarget!, max_change: 0.2, proportions: JSON.stringify(opts.proportions ?? {}) },
      _meta: { title: 'Retargeted Skeleton' },
    };
    g[POSE_RETARGET_PREVIEW] = { class_type: 'PreviewImage', inputs: { images: [POSE_RETARGET_NODE, 0] }, _meta: { title: 'Retargeted Skeleton' } };
  }
  return g;
}

/** First person's body keypoints from a DWPose / SiennaPoseRetarget openpose_json string. */
export function firstBody(json: string | undefined): { flat: number[]; width: number; height: number } | null {
  if (!json) return null;
  try {
    const parsed = JSON.parse(json);
    const pose = Array.isArray(parsed) ? parsed[0] : parsed;
    const flat = pose?.people?.[0]?.pose_keypoints_2d;
    if (!Array.isArray(flat)) return null;
    return { flat, width: pose.canvas_width, height: pose.canvas_height };
  } catch {
    return null;
  }
}
