// Prompt assembly. Pure and deterministic so the UI preview matches exactly
// what the server sends to ComfyUI.

import {
  ADULT_ONLY_NEGATIVE,
  AGE_DRIFT_NEGATIVE,
  AGE_DRIFT_NEGATIVE_CLEAN,
  EYE_TRAIT,
  CLOSE_CAMERA_REALISM,
  FULL_BODY_CAMERA,
  FULL_BODY_FRAMING,
  FULL_BODY_NEGATIVE,
  KEEP_TOP_NEGATIVE,
  MIRROR_FULL_BODY_FRAMING,
  LEGACY_EYE_TRAIT,
  LOCK_NEGATIVE,
  MIN_CHARACTER_AGE,
  NON_STUDIO_NEGATIVE,
  SFW_NEGATIVE,
} from './defaults';
import { outfitHasTop } from './exposure';
import { rearRequest } from './identity';
import { applyIdentityLock, findHardBlocks, GuardHit, tidy } from './guard';
import { splitAvoid } from './outfit-edit';
import type { CharacterProfile, ContentMode, PromptFields } from './types';
import { PROMPT_FIELD_KEYS, PROMPT_FIELD_LABELS } from './types';

export interface BuildPromptInput {
  fields: PromptFields;
  character: CharacterProfile;
  siennaLock: boolean;
  contentMode: ContentMode;
  /**
   * Experimental prompt cleanup: drop negatives that work against the request — the abstract
   * identity phrases ("different person, altered face…", which CLIP can't act on) and the
   * texture-penalising age terms. Off = the current production prompt.
   */
  cleanup?: boolean;
  /**
   * A pose guide holds her body with a skeleton, so the request's outfit goes ahead of the pose and the guide's own
   * pose wording follows the outfit. In the first guide test the wording in front cost the outfit (sweatpants, the
   * button-up shirt) in 5 of 7 photos and the golden-hour light (21 Oct).
   */
  poseGuide?: string;
}

export interface BuiltPrompt {
  positive: string;
  negative: string;
  /** Non-fatal notices, e.g. phrases removed by Sienna Lock. */
  warnings: string[];
  /** Fatal problems — generation must not proceed. */
  blocked: GuardHit[];
  /** Fields after Sienna Lock filtering. */
  effectiveFields: PromptFields;
}

/**
 * Split profile traits into eye-colour wording and everything else, so the eye
 * description can be placed at the end of the prompt. The pre-reorder default
 * wording is upgraded to EYE_TRAIT; custom eye wording is kept as written.
 */
export function splitEyeTraits(traits: string): { rest: string; eyes: string } {
  const parts = traits.split(',').map((s) => s.trim()).filter(Boolean);
  const isEye = (s: string) => /\b(eyes?|iris(es)?)\b/i.test(s);
  const eyes = parts.filter(isEye).join(', ');
  return {
    rest: parts.filter((s) => !isEye(s)).join(', '),
    eyes: eyes.toLowerCase() === LEGACY_EYE_TRAIT ? EYE_TRAIT : eyes,
  };
}

/** With "barefoot": the model still added sandals from habit. */
const BAREFOOT_NEGATIVE = 'shoes, sandals, flip-flops, footwear';
const FULL_BODY_RE = /\b(full[\s-]?body|head[\s-]?to[\s-]?toe|full[\s-]?length|entire\s+body)\b/i;
const NOT_FULL_BODY_RE = /\b(close[\s-]?up|portrait|waist[\s-]?up|chest[\s-]?up|half[\s-]?body|head[\s-]?and[\s-]?shoulders|headshot)\b/i;

/**
 * Whether to prepend FULL_BODY_FRAMING. The Framing field decides when filled:
 * a full-body framing there is strengthened unless it already carries the
 * strong wording; any other framing (waist-up, medium shot…) is left alone.
 * Otherwise the request must ask for full body and not also for a tighter shot.
 */
export function fullBodyFraming(f: PromptFields): { add: boolean; conflict: boolean; mirror: boolean } {
  const request = [f.pose, f.outfit, f.bodyPresentation, f.expression, f.setting, f.lighting, f.extra].join(' \n ');
  const mirror = /\bmirror\b/i.test(`${f.framing} ${request}`);
  const framing = f.framing.trim();
  if (framing) {
    const add = FULL_BODY_RE.test(framing) && !NOT_FULL_BODY_RE.test(framing) && !/entire (reflected )?body visible/i.test(framing);
    return { add, conflict: false, mirror };
  }
  const full = FULL_BODY_RE.test(request);
  const tight = NOT_FULL_BODY_RE.test(request);
  return { add: full && !tight, conflict: full && tight, mirror };
}

/** Join comma-separated fragments, dropping blanks and exact duplicates. */
/** Colour words that get extra weight in the Outfit field (the model drifted to olive/beige without it). */
const COLOUR_RE = /\b(black|white|red|pink|blue|navy|green|olive|yellow|orange|purple|lilac|lavender|beige|nude|tan|brown|grey|gray|silver|gold|cream|ivory|burgundy|maroon|teal|turquoise|coral|denim|light-wash|dark-wash|khaki)\b/i;

/** Wrap text in a prompt weight, unless it is empty or already weighted. */
export function emphasize(text: string, weight: number): string {
  const t = text.trim().replace(/[,.\s]+$/, '');
  if (!t || /^\(.*:\d(\.\d+)?\)$/.test(t) || t.includes('(')) return t;
  return `(${t}:${weight})`;
}

export const COLOUR_WEIGHT = 1.1;

/** Outfit with each comma-separated item that names a colour weighted COLOUR_WEIGHT, so the colour sticks. */
export function emphasizeColours(outfit: string): string {
  return outfit
    .split(',')
    .map((item) => (COLOUR_RE.test(item) && !item.includes('(') ? ` ${emphasize(item, COLOUR_WEIGHT)}` : item))
    .join(',')
    .trim();
}

/**
 * Clothing colours the model drifts to (her green eyes and brown hair bleed into the outfit): in testing a
 * "red bodycon dress" came out green, brown or beige in 13 of 15 photos. When the outfit names a colour, the
 * drift colours it didn't ask for go in the negative prompt — as clothing, so her hair and eyes are untouched.
 */
const DRIFT_COLOURS: { phrase: string; family: RegExp }[] = [
  { phrase: 'olive green clothing, sage green clothing', family: /\b(green|olive|sage|khaki|teal|turquoise)\b/i },
  { phrase: 'brown clothing', family: /\b(brown|chocolate|tan|camel|khaki|burgundy|maroon)\b/i },
  { phrase: 'beige clothing', family: /\b(beige|nude|tan|cream|ivory|camel|khaki)\b/i },
];

export function colourDriftNegative(outfit: string): string {
  // "completely nude" is not a clothing colour
  const clothing = outfit.replace(/\b(completely|fully|totally)\s+nude\b/gi, '').replace(/^\s*nude\s*$/i, '');
  if (!COLOUR_RE.test(clothing)) return '';
  return DRIFT_COLOURS.filter((d) => !d.family.test(clothing))
    .map((d) => d.phrase)
    .join(', ');
}

export function joinParts(parts: (string | undefined | null)[]): string {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of parts) {
    const p = tidy(raw ?? '');
    if (!p) continue;
    const key = p.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(p);
  }
  return out.join(', ');
}

// Rear-view requests came back facing the camera: the rear wording sat mid-prompt, unweighted, behind full-body
// framing, while her face traits (freckles, eye colour) pulled her face into view. Weighted up front it held (9 of 10
// test photos from behind vs 1 of 4 without, same base model and Sienna LoRA).
const REAR_VIEW = '(view from behind:1.3), (back view:1.3)';
const FACE_AWAY = '(head facing away from the camera:1.2)';
const REAR_NEGATIVE_FACE_AWAY = '(looking at viewer:1.3), (facing the camera:1.3), (front view:1.3)';
const REAR_NEGATIVE = '(front view:1.2)';
const LOOKING_BACK_RE = /\b(looking back|over (her|the|his) shoulder|profile view|side profile|looks? at the camera|eye contact)\b/i;

const OUTDOOR_SCENE_RE = /\b(beach|ocean|sea|lake|river|forest|woods|park|street|city|outdoors?|outside|garden|backyard|mountains?|desert|pool|balcony|rooftop|field|sunlight|sunlit|sunset|sunrise|golden hour|daylight)\b/i;
const LIGHT_WORDS_RE = /\b(lighting|light|lit|sunlight|sunlit|daylight|lamp|lamplight|candlelight|neon|golden hour|sunset|sunrise|backlit|flash)\b/i;
const NON_PHONE_CAMERA_RE = /\b(dslr|mirrorless|film camera|35mm film|medium format|professional (camera|photographer|photo ?shoot)|studio (photo|shoot|portrait)|canon|nikon|sony a\d|leica|hasselblad)\b/i;

export function buildPrompt({ fields, character, siennaLock, contentMode, cleanup = false, poseGuide }: BuildPromptInput): BuiltPrompt {
  const warnings: string[] = [];
  const effectiveFields = { ...fields };

  // 1. Hard blocks across every user-editable field and the profile traits.
  const allText = [...PROMPT_FIELD_KEYS.map((k) => fields[k]), character.appearanceTraits].join(' \n ');
  const blocked = findHardBlocks(allText);

  // 2. Sienna Lock: strip identity-altering phrases from free-text fields.
  if (siennaLock) {
    for (const key of PROMPT_FIELD_KEYS) {
      const res = applyIdentityLock(fields[key] ?? '', character.extraLockedTerms);
      effectiveFields[key] = res.text;
      for (const r of res.removed) {
        warnings.push(`Sienna Lock removed “${r.term}” from ${PROMPT_FIELD_LABELS[key]} (${r.category} is locked).`);
      }
    }
  }

  const age = Math.max(MIN_CHARACTER_AGE, Math.round(character.age || MIN_CHARACTER_AGE));
  const f = effectiveFields;

  // 3. Positive prompt. SDXL weighs the start of the prompt most, so the
  // request (framing, then scene and outfit) comes first and identity after it;
  // with identity first, outfit colours and full-body framing were ignored.
  // Eye-colour wording goes last because it bled into clothing colour
  // (requested red/yellow tops came out muted green).
  // The LoRA was captioned "<token> woman", so the token is sent in that form.
  const token = character.triggerToken.trim();
  const tokenPhrase = !token || /\bwoman$/i.test(token) ? token : `${token} woman`;
  const traits = splitEyeTraits(character.appearanceTraits);
  const identity = siennaLock
    ? [tokenPhrase, `${age}-year-old adult woman`, traits.rest]
    : [`adult woman`];

  const fullBody = fullBodyFraming(f);
  if (fullBody.conflict) warnings.push('Request mixes full-body and close-up/half-body framing — no full-body framing was added.');
  // Full-body shots came out as arm's-length selfies, so the default close
  // phone-camera wording is swapped out (only when the user set no camera):
  // normal shots get a "taken by another person" camera and anti-crop
  // negatives; mirror selfies get a full-length mirror composition instead.
  const fullBodyMode = !fullBody.add ? null : fullBody.mirror ? 'mirror' : 'normal';
  // "barefoot" anywhere (or shoes in Avoid): the full-body wording's "feet and shoes" put sandals on her (live, 18 Oct)
  const barefoot =
    /\b(barefoot(ed)?|bare[- ]feet|bare[- ]foot)\b/i.test([f.outfit, f.pose, f.bodyPresentation, f.setting, f.framing, f.extra].join(' ')) ||
    /\b(shoes|sandals|footwear|flip[- ]flops)\b/i.test(f.avoid ?? '');
  const addedFraming =
    fullBodyMode === 'mirror'
      ? MIRROR_FULL_BODY_FRAMING
      : fullBodyMode
        ? barefoot
          ? FULL_BODY_FRAMING.replace('including feet and shoes', 'including her bare feet')
          : FULL_BODY_FRAMING
        : '';

  const defaultCamera = siennaLock ? character.defaultCameraStyle : '';
  const camera = f.camera || (fullBodyMode === 'normal' ? FULL_BODY_CAMERA : fullBodyMode === 'mirror' ? '' : defaultCamera);
  // The profile's default realism wording must not contradict the request: its indoor-lighting phrase goes when the
  // scene is outdoors or the lighting is described, and its phone-camera phrases go when another camera is asked for.
  const outdoors = OUTDOOR_SCENE_RE.test(`${f.setting} ${f.lighting} ${f.pose}`);
  // the light may be described in any field ("a modern kitchen with natural morning lighting")
  const lightDescribed = !!f.lighting.trim() || LIGHT_WORDS_RE.test(PROMPT_FIELD_KEYS.filter((k) => k !== 'avoid').map((k) => f[k]).join(' '));
  const otherCamera = !!f.camera && NON_PHONE_CAMERA_RE.test(f.camera) && !/\b(phone|iphone|selfie)\b/i.test(f.camera);
  const baseRealism = character.defaultRealismPrompt
    .split(',')
    .filter((s) => {
      const t = s.trim().toLowerCase();
      if (fullBodyMode && t === CLOSE_CAMERA_REALISM) return false;
      if ((outdoors || lightDescribed) && /\bindoor lighting\b/.test(t)) return false;
      if (otherCamera && /\b(iphone|phone|smartphone|selfie)\b/.test(t)) return false;
      return true;
    })
    .join(',');
  const realism = joinParts([baseRealism, f.realism]);

  // Drop Framing fragments the added wording already covers (e.g. "head to toe").
  const framing = addedFraming
    ? f.framing.split(',').filter((s) => !addedFraming.includes(s.trim().toLowerCase())).join(',')
    : f.framing;

  // From-behind request: weighted rear wording first; unless she looks back, her face turned away and no eye wording.
  const poseText = `${f.pose} ${f.framing} ${f.extra}`;
  const rear = rearRequest(poseText, null, false);
  const faceAway = rear && !LOOKING_BACK_RE.test(`${poseText} ${f.expression}`);

  const positive = joinParts([
    rear ? REAR_VIEW : '',
    faceAway ? FACE_AWAY : '',
    addedFraming,
    framing,
    poseGuide === undefined ? f.pose : '',
    // outfit colours get a little extra weight: in the audit "red bikini" came out beige/green. 1.1 keeps her face
    // (1.2 cost likeness, and so did weighting the pose)
    emphasizeColours(f.outfit),
    poseGuide ?? '',
    poseGuide === undefined ? '' : f.pose,
    f.bodyPresentation,
    f.expression,
    f.setting,
    f.lighting,
    f.extra,
    ...identity,
    camera,
    realism,
    siennaLock && !faceAway ? traits.eyes : '',
  ]);

  // 4. Negative prompt. The Avoid box goes here (never the positive prompt); with Sienna Lock on, identity terms
  // ("freckles", "dark hair") can't be avoided.
  let avoidItems = splitAvoid(fields.avoid ?? '');
  if (siennaLock && avoidItems.length) {
    // her own traits (freckles, wavy hair, eye colour) can't be avoided either
    const traitWords = new Set((character.appearanceTraits.toLowerCase().match(/[a-z]{4,}/g) ?? []).filter((w) => !['with', 'across', 'light', 'long'].includes(w)));
    avoidItems = avoidItems.flatMap((item) => {
      const res = applyIdentityLock(item, character.extraLockedTerms);
      for (const r of res.removed) warnings.push(`Sienna Lock removed “${r.term}” from Avoid (${r.category} is locked).`);
      const kept = res.text.trim();
      // "bare breasts" / "exposed nipples" ask for coverage, not a smaller bust — let those through
      const coverage = /\b(bare|topless|nude|naked|exposed|nipples?|areolae?|uncovered|see-through)\b/i.test(kept);
      const hit = coverage ? undefined : (kept.toLowerCase().match(/[a-z]{4,}/g) ?? []).find((w) => traitWords.has(w) || traitWords.has(w.replace(/s$/, '')));
      if (hit) warnings.push(`Sienna Lock removed “${kept}” from Avoid (it is one of her traits).`);
      return kept && !hit ? [kept] : [];
    });
  }
  const wantsStudio = /\bstudio\b/i.test(`${f.lighting} ${f.setting} ${f.camera}`);
  const negative = joinParts([
    character.defaultNegativePrompt,
    wantsStudio ? '' : NON_STUDIO_NEGATIVE,
    siennaLock && !cleanup ? LOCK_NEGATIVE : '',
    ADULT_ONLY_NEGATIVE,
    contentMode === 'sfw' ? SFW_NEGATIVE : '',
    siennaLock ? (cleanup ? AGE_DRIFT_NEGATIVE_CLEAN : AGE_DRIFT_NEGATIVE) : '',
    fullBodyMode === 'normal' ? FULL_BODY_NEGATIVE : '',
    barefoot ? BAREFOOT_NEGATIVE : '',
    outfitHasTop(f.outfit) ? KEEP_TOP_NEGATIVE : '',
    colourDriftNegative(f.outfit),
    faceAway ? REAR_NEGATIVE_FACE_AWAY : rear ? REAR_NEGATIVE : '',
    avoidItems.join(', '),
  ]);

  if (siennaLock && !character.triggerToken.trim()) {
    warnings.push('No trigger token set in the Sienna profile — identity will rely on the LoRA and face reference only.');
  }

  return { positive, negative, warnings, blocked, effectiveFields };
}
