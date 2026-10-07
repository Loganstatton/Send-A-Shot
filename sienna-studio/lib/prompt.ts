// Prompt assembly. Pure and deterministic so the UI preview matches exactly
// what the server sends to ComfyUI.

import {
  ADULT_ONLY_NEGATIVE,
  AGE_DRIFT_NEGATIVE,
  EYE_TRAIT,
  LEGACY_EYE_TRAIT,
  LOCK_NEGATIVE,
  MIN_CHARACTER_AGE,
  NON_STUDIO_NEGATIVE,
  SFW_NEGATIVE,
} from './defaults';
import { applyIdentityLock, findHardBlocks, GuardHit, tidy } from './guard';
import type { CharacterProfile, ContentMode, PromptFields } from './types';
import { PROMPT_FIELD_KEYS, PROMPT_FIELD_LABELS } from './types';

export interface BuildPromptInput {
  fields: PromptFields;
  character: CharacterProfile;
  siennaLock: boolean;
  contentMode: ContentMode;
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

export function buildPrompt({ fields, character, siennaLock, contentMode }: BuildPromptInput): BuiltPrompt {
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

  const camera = f.camera || (siennaLock ? character.defaultCameraStyle : '');
  const realism = joinParts([character.defaultRealismPrompt, f.realism]);

  const positive = joinParts([
    f.framing,
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

  // 4. Negative prompt.
  const wantsStudio = /\bstudio\b/i.test(`${f.lighting} ${f.setting} ${f.camera}`);
  const negative = joinParts([
    character.defaultNegativePrompt,
    wantsStudio ? '' : NON_STUDIO_NEGATIVE,
    siennaLock ? LOCK_NEGATIVE : '',
    ADULT_ONLY_NEGATIVE,
    contentMode === 'sfw' ? SFW_NEGATIVE : '',
    siennaLock ? AGE_DRIFT_NEGATIVE : '',
  ]);

  if (siennaLock && !character.triggerToken.trim()) {
    warnings.push('No trigger token set in the Sienna profile — identity will rely on the LoRA and face reference only.');
  }

  return { positive, negative, warnings, blocked, effectiveFields };
}
