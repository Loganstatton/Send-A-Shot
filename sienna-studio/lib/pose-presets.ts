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
  standing_full_body: 'Standing (full body)',
  lying_on_back: 'Lying on back',
  lying_on_side: 'Lying on side',
  kneeling_upright: 'Kneeling upright',
};

export function posePreset(id: string | undefined | null): PosePreset | undefined {
  return id ? POSE_PRESETS.find((p) => p.id === id) : undefined;
}

/**
 * The preset whose position the Pose text asks for, if any. In the position test (2026-10-17) text alone held 1 of 4
 * positions (lying on her back/side came out sitting up) while presets held 5 of 6, so a matching preset is used
 * automatically when no preset or pose photo was chosen. Close-up and over-the-shoulder presets are never picked
 * automatically: they change the framing or turn her face.
 */
const AUTO_PRESETS: [string, RegExp][] = [
  ['lying_on_stomach', /\b(lying|laying|lies|lays) (face[- ]?down|on (her|the|its) (stomach|front|belly|tummy))\b|\bprone\b/i],
  ['lying_on_back', /\b(lying|laying|lies|lays) (face[- ]?up|(flat )?on her back)\b|\bsupine\b/i],
  ['lying_on_side', /\b(lying|laying|lies|lays) on (her|one|the) side\b|\bside[- ]lying\b/i],
  ['sitting_crosslegged', /\bcross[- ]?legged\b/i],
  ['arms_crossed', /\b(arms (folded|crossed)|(folded|crossed) arms)\b/i],
  ['mirror_selfie', /\bmirror selfie\b/i],
  ['kneeling_upright', /\bkneel(ing|s)?( up| upright)?\b(?![^,.]*\b(all fours|bent over|bending|sitting back)\b)/i],
];
const NOT_STANDING_RE = /\b(sit|sitting|sits|seated|lying|laying|lies|kneel|kneeling|crouch|crouching|squat|squatting|bend|bending|bent over|leaning|walking|running|dancing|jumping)\b/i;

export function matchPosePreset(poseText: string, fullBody: boolean): PosePreset | undefined {
  const text = poseText.trim();
  if (!text) return undefined;
  for (const [id, re] of AUTO_PRESETS) if (re.test(text)) return posePreset(id);
  // a plain standing pose, framed head to feet
  if (fullBody && /\bstand(ing|s)?\b/i.test(text) && !NOT_STANDING_RE.test(text)) return posePreset('standing_full_body');
  return undefined;
}
