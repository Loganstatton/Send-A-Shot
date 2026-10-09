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
  MIRROR_FULL_BODY_FRAMING,
  LEGACY_EYE_TRAIT,
  LOCK_NEGATIVE,
  MIN_CHARACTER_AGE,
  NON_STUDIO_NEGATIVE,
  SFW_NEGATIVE,
} from './defaults';
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

export function buildPrompt({ fields, character, siennaLock, contentMode, cleanup = false }: BuildPromptInput): BuiltPrompt {
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
  const addedFraming = fullBodyMode === 'mirror' ? MIRROR_FULL_BODY_FRAMING : fullBodyMode ? FULL_BODY_FRAMING : '';

  const defaultCamera = siennaLock ? character.defaultCameraStyle : '';
  const camera = f.camera || (fullBodyMode === 'normal' ? FULL_BODY_CAMERA : fullBodyMode === 'mirror' ? '' : defaultCamera);
  const baseRealism = fullBodyMode
    ? character.defaultRealismPrompt.split(',').filter((s) => s.trim().toLowerCase() !== CLOSE_CAMERA_REALISM).join(',')
    : character.defaultRealismPrompt;
  const realism = joinParts([baseRealism, f.realism]);

  // Drop Framing fragments the added wording already covers (e.g. "head to toe").
  const framing = addedFraming
    ? f.framing.split(',').filter((s) => !addedFraming.includes(s.trim().toLowerCase())).join(',')
    : f.framing;

  const positive = joinParts([
    addedFraming,
    framing,
    f.pose,
    f.outfit,
    f.bodyPresentation,
    f.expression,
    f.setting,
    f.lighting,
    f.extra,
    ...identity,
    camera,
    realism,
    siennaLock ? traits.eyes : '',
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
      const hit = (kept.toLowerCase().match(/[a-z]{4,}/g) ?? []).find((w) => traitWords.has(w) || traitWords.has(w.replace(/s$/, '')));
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
    avoidItems.join(', '),
  ]);

  if (siennaLock && !character.triggerToken.trim()) {
    warnings.push('No trigger token set in the Sienna profile — identity will rely on the LoRA and face reference only.');
  }

  return { positive, negative, warnings, blocked, effectiveFields };
}
