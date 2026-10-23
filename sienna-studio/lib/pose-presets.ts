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
  /** Camera height the skeleton is drawn from (eye level when absent). */
  view?: 'low';
  /** Benchmark-only skeleton: not offered in Create and never picked by the AI reader or the keyword matcher. */
  testOnly?: boolean;
}

export const POSE_PRESETS = presets as PosePreset[];

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
  sitting_edge_hands_chest: 'Sitting on the bed edge — hands at chest',
  sitting_edge_hands_lap: 'Sitting on the bed edge — hands in lap',
  sitting_sofa: 'Sitting back on a sofa',
  leaning_counter_foot_up: 'Leaning on a counter — foot up behind',
  standing_leg_up: 'Standing — one foot up on a counter',
  standing_low_angle: 'Standing — low camera angle',
  standing_holding_glass: 'Standing — glass in left hand',
};

/**
 * Pose guides: presets only the AI reader picks, from what the description says her hands and legs do (the reader
 * gets these lines). Text alone never held a bed-edge sit with feet on the floor, a foot against the cabinet or a low
 * camera in the controlled test (21 Oct). Her right/left as seen by her; the skeletons are drawn facing the camera.
 */
export const POSE_GUIDES: Record<string, string> = {
  sitting_edge_hands_chest: 'sitting upright on the edge of a bed/chair, both feet on the floor, both hands together in front of her chest (holding a mug or cup)',
  sitting_edge_hands_lap: 'sitting upright on the edge of a bed/chair, both feet on the floor, hands resting in her lap or on her thighs',
  sitting_sofa: 'sitting back relaxed on a sofa or couch, one arm along the backrest or armrest, feet on the floor',
  leaning_counter_foot_up: 'leaning back against a counter/wall, right hand back on the edge beside her hip, left hand holding something at her chest, left knee bent with that foot pressed against the cabinet/wall behind her',
  standing_leg_up: 'standing on one leg with the other leg raised sideways, foot resting on a counter, table or ledge at hip height',
  standing_low_angle: 'standing, full body, photographed from a low camera angle looking up at her (arms relaxed at her sides)',
  standing_holding_glass: 'standing, full body, eye level, holding a glass or cup at her chest in her left hand, right arm relaxed',
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
  sitting_edge_hands_chest: {
    positive: '(sitting on the edge of the bed:1.2), (both feet flat on the floor:1.15)',
    negative: '(cross-legged:1.3), (legs crossed:1.2), (lying down:1.2), (standing:1.2), (kneeling:1.2)',
  },
  sitting_edge_hands_lap: {
    positive: '(sitting on the edge of the bed:1.2), (both feet flat on the floor:1.15)',
    negative: '(cross-legged:1.3), (legs crossed:1.2), (lying down:1.2), (standing:1.2), (kneeling:1.2)',
  },
  sitting_sofa: {
    positive: '(sitting on the sofa:1.2), relaxed, leaning back',
    negative: '(standing:1.2), (lying down:1.2), (kneeling:1.2)',
  },
  leaning_counter_foot_up: {
    positive: '(leaning back against the kitchen counter:1.15), (one knee bent, foot pressed flat against the cabinet behind her:1.2)',
    negative: '(sitting:1.2), (both feet on the floor:1.1)',
  },
  standing_leg_up: {
    positive: '(one leg raised, foot resting on the counter:1.2)',
    negative: '(sitting:1.2), (kneeling:1.2)',
  },
  standing_low_angle: {
    positive: "(low angle shot from near the floor, camera looking up at her:1.3), (worm's-eye perspective:1.1), long legs in perspective",
    negative: '(eye level shot:1.2), (high angle:1.3), (looking down at her:1.2)',
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
export const NOT_STANDING_RE = /\b(sit|sitting|sits|seated|lying|laying|lies|kneel|kneeling|crouch|crouching|squat|squatting|bend|bending|bent over|leaning|walking|running|dancing|jumping)\b/i;

const POSED_LIMBS_RE =
  /\b(hands?|arms?|hips?|elbows?|wrists?|fingers?|legs?|knees?|foot|feet|shoulders?|holding|holds|touching|brushing|running (her|a) hand|reaching|pointing|waving|crossed|leaning|lean(s|ing)? (on|against)|weight on|contrapposto|twist(ed|ing)?|turned|stretching|posing|pose)\b/i;

// what the preset already shows: arms hanging down
const RELAXED_ARMS_RE = /\b(her )?arms? (relaxed|down|hanging|at (her|its) sides?|by her sides?)\b|\b(relaxed|hanging) arms\b/gi;

/**
 * A camera angle the user asked for. A pose preset's skeleton fixes the viewpoint (eye level, straight on), so it is
 * never used with one: the living-room test asked for "a low angle, looking up at her", got the Standing preset,
 * and all three photos came out at eye level (21 Oct).
 */
export const CAMERA_ANGLE_RE =
  /\b(low[- ]angle|high[- ]angle|from (below|above|the side|a low|a high|overhead)|looking (up|down) at her|bird'?s[- ]eye|worm'?s[- ]eye|overhead|top[- ]down|dutch angle|tilted (camera|angle)|side view|profile view|three[- ]quarter view|from behind|over[- ]the[- ]shoulder shot)\b/i;

/**
 * Pose guides in everyday use: the reader offers these on every request. The rest stay experimental and are only
 * offered to a request that asks for all guides (testing) or with SIENNA_POSE_GUIDE=true.
 */
// None yet. Full-size review (22 Oct): bed edge held the position in 3 of 5 photos (twice she sat on top of the bed
// with her feet on the mattress) and 1 of 5 followed the whole description; low angle gave a low camera in 4 of 5 but
// lost the gray sofa, coffee table or light in every one; the counter guide never put the foot on the cabinet.
export const POSE_GUIDES_LIVE: string[] = [];

/** The guides offered to the reader: every guide when testing, otherwise the ones in everyday use. */
export function offeredGuides(all: boolean): string[] {
  return all ? Object.keys(POSE_GUIDES) : POSE_GUIDES_LIVE;
}

/**
 * A preset may be used with this camera wording: eye-level presets never with a camera angle; the low-angle preset
 * only with a low angle.
 */
const LOW_ANGLE_RE = /\b(low[- ]angle|from (below|a low)|looking up at her|worm'?s[- ]eye)\b/i;
export function presetFitsCamera(p: PosePreset, camera: string): boolean {
  if (p.view === 'low') return LOW_ANGLE_RE.test(camera);
  return !CAMERA_ANGLE_RE.test(camera);
}

export function matchPosePreset(poseText: string, fullBody: boolean): PosePreset | undefined {
  const text = poseText.trim();
  if (!text) return undefined;
  if (BEND_RE.test(text) && rearRequest(text, null, false)) return posePreset('bent_over_rear');
  for (const [id, re] of AUTO_PRESETS) if (re.test(text)) return posePreset(id);
  // a plain standing pose, framed head to feet — not when the pose says what her arms or legs do: the preset's
  // skeleton (arms down, feet together) overrode "one hand on her hip, the other brushing her hair back" (live, 18 Oct)
  if (fullBody && /\bstand(ing|s)?\b/i.test(text) && !NOT_STANDING_RE.test(text) && !POSED_LIMBS_RE.test(text.replace(RELAXED_ARMS_RE, ''))) return posePreset('standing_full_body');
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

const NUDE_RE = /\b(nude|naked|topless|bottomless|unclothed|no clothing|no clothes)\b/i;

/** The bent-over preset's thong uses the String swimsuit add-on (thin string back) at its own default strength. */
export function presetThongPack(presetId: string | undefined | null, outfit: string): boolean {
  return !!presetId && OUTFIT_GUARDED.has(presetId) && THONG_RE.test(outfit) && !NUDE_RE.test(outfit);
}

/**
 * The heavier outfit wording crowded the scene out (6-photo test: blurred backgrounds, the sea gone in 3 of 6), so
 * the Setting is repeated right after the outfit with a sharp, deep-focus phone-photo look.
 */
export function presetOutfitPrompt(presetId: string | undefined | null, outfit: string, setting = ''): { positive: string; negative: string } | null {
  if (!presetId || !OUTFIT_GUARDED.has(presetId)) return null;
  const o = outfit.replace(/[()]/g, '').trim();
  if (!o) return null;
  const pos: string[] = [`(wearing ${o}:1.3)`, '(real fabric with thickness, seams and natural folds:1.05)'];
  const neg: string[] = ['(extra people:1.3), (second person:1.3), (people in the background:1.3)', 'hat, bag, sunglasses, jewelry'];
  // a clothed request stays clothed in this pose, also in adult mode (which drops the SFW cover-up negatives)
  if (!NUDE_RE.test(o)) neg.push('(nude:1.3), (exposed genitals:1.5), (pubic hair:1.4), (wardrobe malfunction:1.3)');
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
  const scene = setting.replace(/[()]/g, '').trim();
  if (scene) {
    pos.push(`(${scene}:1.2)`, '(sharp detailed background in focus, deep depth of field, natural iPhone photo:1.15)');
    neg.push('(blurry background:1.3), (bokeh:1.3), (shallow depth of field:1.2), plain empty background, studio backdrop');
  }
  return { positive: pos.join(', '), negative: neg.join(', ') };
}
