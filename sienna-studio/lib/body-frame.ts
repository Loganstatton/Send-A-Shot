/**
 * Full-body framing check from the body itself. The face-size rule (identity.framingOk) can't tell a photo cut off at
 * the thighs from a full-body one when her face is small or turned away: in the position test three "head to feet"
 * requests came back cropped and passed. Here DWPose finds her joints (SiennaBodyMeasure reports them) and a
 * full-body request needs her head and at least one ankle in the picture. Built from nodes the photo servers already
 * have for pose copying and body protection; when one is missing the check is simply skipped.
 */
import type { ComfyGraph } from './types';

export const BODY_FRAME_NODE_ID = 'sienna_body_frame';
export const BODY_SEGM_MODEL = 'segm/person_yolov8m-seg.pt';

/** The nodes that measure the image going into `saveNodeId` (its id → node), or null. */
export function bodyFrameNodes(graph: ComfyGraph, saveNodeId: string): ComfyGraph | null {
  const images = graph[saveNodeId]?.inputs?.images;
  if (!Array.isArray(images)) return null;
  return {
    sienna_body_pose: {
      class_type: 'DWPreprocessor',
      inputs: {
        image: images, detect_hand: 'disable', detect_body: 'enable', detect_face: 'disable', resolution: 512,
        bbox_detector: 'yolox_l.onnx', pose_estimator: 'dw-ll_ucoco_384.onnx', scale_stick_for_xinsr_cn: 'disable',
      },
    },
    sienna_body_segm: { class_type: 'UltralyticsDetectorProvider', inputs: { model_name: BODY_SEGM_MODEL } },
    sienna_body_mask: { class_type: 'SegmDetectorCombined_v2', inputs: { segm_detector: ['sienna_body_segm', 1], image: images, threshold: 0.4, dilation: 0 } },
    sienna_body_measure: {
      class_type: 'SiennaBodyMeasure',
      inputs: { image: images, pose_keypoint: ['sienna_body_pose', 1], person_mask: ['sienna_body_mask', 0] },
    },
    [BODY_FRAME_NODE_ID]: { class_type: 'SiennaTextOutput', inputs: { text: ['sienna_body_measure', 0] } },
  };
}

export interface BodyFrame {
  /** Her body was found (DWPose + a usable torso). */
  found: boolean;
  head: boolean;
  feet: boolean;
}

/** Joints are OpenPose-18 (0 nose … 10 right ankle, 13 left ankle); SiennaBodyMeasure reports the first 14. */
export function parseBodyFrame(texts: string[] | undefined): BodyFrame | null {
  if (!texts?.length) return null;
  try {
    const m = JSON.parse(texts[0]);
    if (!m || typeof m !== 'object') return null;
    if (!m.valid || !Array.isArray(m.joints)) return { found: false, head: false, feet: false };
    const j = m.joints as (unknown[] | null)[];
    const has = (i: number) => Array.isArray(j[i]) && j[i]!.length >= 2;
    return { found: true, head: has(0) || has(1), feet: has(10) || has(13) };
  } catch {
    return null;
  }
}

/** For a full-body request: true/false when the body could be judged, undefined when it couldn't (no verdict). */
export function bodyFramingOk(fullBody: boolean, body: BodyFrame | null): boolean | undefined {
  if (!fullBody || !body?.found) return undefined;
  return body.head && body.feet;
}
