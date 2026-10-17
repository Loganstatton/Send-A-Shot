/**
 * Pose presets: OpenPose skeletons drawn by scripts/make_pose_presets.py (public/pose-presets). Picking one sends
 * the skeleton straight to the pose ControlNet (no photo, no DWPose), fills the Pose text if it's empty and sets
 * the output size. In the anatomy audit, prompts alone ignored "lying on her stomach" and "hand in hair" 3/3.
 */
import presets from '../public/pose-presets/presets.json';
import { rearRequest } from './identity';

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
  bent_over_rear: 'Bent over — rear view',
};

/**
 * Wording a preset adds to the prompt (front of the positive, end of the negative) and the body check it needs.
 * Bent over: SDXL's pose ControlNet turned earlier bend-over skeletons into kneeling, crouching or standing photos,
 * so the hinge is also spelled out and the usual misreads are pushed away; the hinge check redoes any that slip.
 */
export const POSE_PRESET_PROMPTS: Record<string, { positive: string; negative: string; check?: 'hinge' }> = {
  bent_over_rear: {
    positive: '(bending forward at the waist:1.3), (hips raised:1.2), (legs nearly straight:1.1), rear three-quarter view, camera at hip height',
    negative: '(squatting:1.4), (kneeling:1.4), (sitting:1.3), (crouching:1.3), (lying down:1.2), (standing upright:1.2)',
    check: 'hinge',
  },
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
// a waist bend (not "knees slightly bent") seen from behind
const BEND_RE = /\b((bend(s|ing)?|bent|lean(s|ing)?|fold(s|ed|ing)?) (over|forward|down)|(bend(s|ing)?|bent|hing(e|es|ed|ing)) (forward )?at the (waist|hips)|hip[- ]hinge)\b/i;

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
  if (BEND_RE.test(text) && rearRequest(text, null, false)) return posePreset('bent_over_rear');
  for (const [id, re] of AUTO_PRESETS) if (re.test(text)) return posePreset(id);
  // a plain standing pose, framed head to feet
  if (fullBody && /\bstand(ing|s)?\b/i.test(text) && !NOT_STANDING_RE.test(text)) return posePreset('standing_full_body');
  return undefined;
}

/**
 * Garment wording for presets that lose the outfit (bent over, 12-photo test 2026-10-17: a string thong came out as
 * full briefs 2/3, a sundress as a swimsuit or bodysuit 3/3, denim shorts once as cut-out shorts, and seed 3303 added
 * sandals to every outfit). The outfit text is repeated with weight right after the preset's pose wording, the
 * garment type gets its shape spelled out (skirt hanging with gravity, thin string back, closed shorts) and the
 * misreads go into the negative. Only presets listed in OUTFIT_GUARDED use it.
 */
const OUTFIT_GUARDED = new Set(['bent_over_rear']);
const DRESS_RE = /\b(sun ?dress|dress|skirt|gown|frock)\b/i;
const THONG_RE = /\b(thong|g-?string)\b/i;
const SWIM_RE = /\b(bikini|swimsuit|swimwear|monokini)\b/i;
const SHORTS_RE = /\b(shorts|hot ?pants)\b/i;
const FOOTWEAR_RE = /\b(shoes?|sandals?|heels|boots?|sneakers?|trainers|flip[- ]?flops|slides|socks)\b/i;

export function presetOutfitPrompt(presetId: string | undefined | null, outfit: string): { positive: string; negative: string } | null {
  if (!presetId || !OUTFIT_GUARDED.has(presetId)) return null;
  const o = outfit.replace(/[()]/g, '').trim();
  if (!o) return null;
  const pos: string[] = [`(wearing ${o}:1.35)`, '(real fabric with thickness, seams and natural folds:1.1)'];
  const neg: string[] = ['(extra people:1.3), (second person:1.3), (people in the background:1.3)', 'hat, bag, sunglasses, jewelry'];
  if (DRESS_RE.test(o)) {
    pos.push('(the dress skirt hangs down from her hips with gravity, loose draping fabric, soft folds:1.3)', '(hem at mid-thigh:1.15)');
    neg.push('(swimsuit:1.4), (bikini:1.4), (bodysuit:1.4), (leotard:1.3), (one-piece swimsuit:1.4), (underwear:1.2), (bare buttocks:1.2)');
  } else if (THONG_RE.test(o)) {
    pos.push('(thong bottoms with a thin string back between her buttocks:1.3), (thin side strings tied at the hips:1.15)');
    neg.push('(full coverage bottoms:1.4), (briefs:1.3), (boyshorts:1.3), (cheeky bottoms:1.2), (one-piece swimsuit:1.4), (bodysuit:1.3)');
  } else if (SWIM_RE.test(o)) {
    pos.push('(two-piece bikini with a separate top and bottoms:1.25), (thin straps and ties:1.1)');
    neg.push('(one-piece swimsuit:1.4), (bodysuit:1.3), (leotard:1.3)');
  }
  if (SHORTS_RE.test(o)) {
    pos.push('(shorts fully covering her buttocks, closed seams, pockets and hem:1.25)');
    neg.push('(cut-out shorts:1.3), (torn shorts:1.2), (thong:1.2), (bare buttocks:1.2)');
  }
  if (!FOOTWEAR_RE.test(o)) {
    pos.push('barefoot');
    neg.push('(sandals:1.3), (shoes:1.2), footwear');
  }
  return { positive: pos.join(', '), negative: neg.join(', ') };
}
