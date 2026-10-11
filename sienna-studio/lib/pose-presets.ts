/**
 * Pose presets: OpenPose skeletons drawn by scripts/make_pose_presets.py (public/pose-presets). Picking one sends
 * the skeleton straight to the pose ControlNet (no photo, no DWPose), fills the Pose text if it's empty and sets
 * the output size. In the anatomy audit, prompts alone ignored "lying on her stomach" and "hand in hair" 3/3.
 */
import presets from '../public/pose-presets/presets.json';

export interface PosePreset {
  id: string;
  width: number;
  height: number;
  /** Pose wording used when the Pose field is empty. */
  pose: string;
  /** Pose ControlNet strength for this preset. */
  strength: number;
}

export const POSE_PRESETS: PosePreset[] = presets;

export const POSE_PRESET_LABELS: Record<string, string> = {
  sitting_crosslegged: 'Sitting cross-legged',
  arms_crossed: 'Arms crossed',
  hand_in_hair: 'Hand in hair',
  mirror_selfie: 'Mirror selfie',
  lying_on_stomach: 'Lying on stomach',
  looking_back: 'Looking back (from behind)',
};

export function posePreset(id: string | undefined | null): PosePreset | undefined {
  return id ? POSE_PRESETS.find((p) => p.id === id) : undefined;
}
