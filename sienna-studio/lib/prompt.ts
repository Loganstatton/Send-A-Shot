// Prompt assembly. Pure and deterministic so the UI preview matches exactly
// what the server sends to ComfyUI.

import {
  ADULT_ONLY_NEGATIVE,
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

  // 3. Positive prompt, identity first (token + traits weigh most at the front).
  const identity = siennaLock
    ? [character.triggerToken, `${age}-year-old adult woman`, character.appearanceTraits]
    : [`adult woman`];

  const camera = f.camera || (siennaLock ? character.defaultCameraStyle : '');
  const realism = joinParts([character.defaultRealismPrompt, f.realism]);

  const positive = joinParts([
    ...identity,
    f.outfit,
    f.pose,
    f.bodyPresentation,
    f.expression,
    f.setting,
    f.lighting,
    camera,
    f.framing,
    realism,
    f.extra,
  ]);

  // 4. Negative prompt.
  const wantsStudio = /\bstudio\b/i.test(`${f.lighting} ${f.setting} ${f.camera}`);
  const negative = joinParts([
    character.defaultNegativePrompt,
    wantsStudio ? '' : NON_STUDIO_NEGATIVE,
    siennaLock ? LOCK_NEGATIVE : '',
    ADULT_ONLY_NEGATIVE,
    contentMode === 'sfw' ? SFW_NEGATIVE : '',
  ]);

  if (siennaLock && !character.triggerToken.trim()) {
    warnings.push('No trigger token set in the Sienna profile — identity will rely on the LoRA and face reference only.');
  }

  return { positive, negative, warnings, blocked, effectiveFields };
}
