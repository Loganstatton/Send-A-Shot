/**
 * Framing conflict detection
 * ==========================
 *
 * Finds instructions that cannot all be true in one photo — e.g. "waist-up" in Framing while
 * the pose photo is a full-length skeleton (the pose map wins), or "mirror selfie" together
 * with "photographed by another person". It only reports: nothing is changed automatically.
 * A suggestion is applied only when the user taps it.
 */

import type { PromptFields } from './types';

/** Ordered from tightest to widest shot. */
export const FRAMING_LEVELS = ['close-up', 'chest-up', 'waist-up', 'thigh-up', 'knee-up', 'full body'] as const;
export type FramingLevel = (typeof FRAMING_LEVELS)[number];
const LEVEL = (l: FramingLevel) => FRAMING_LEVELS.indexOf(l);

const LEVEL_RE: [FramingLevel, RegExp][] = [
  ['close-up', /\b(extreme close[- ]?up|close[- ]?up|headshot|face only|face close)\b/i],
  ['chest-up', /\b(chest[- ]up|bust shot|head and shoulders|shoulders[- ]up|portrait crop)\b/i],
  ['waist-up', /\b(waist[- ]up|half[- ]body|upper body|medium shot|from the waist up)\b/i],
  ['thigh-up', /\b(thigh[- ]up|mid[- ]thigh up|three[- ]quarter(?: length| shot)?|3\/4 (?:shot|length)|cowboy shot)\b/i],
  ['knee-up', /\b(knee[- ]up|from the knees? up|knee[- ]length shot)\b/i],
  ['full body', /\b(full[- ]body|full[- ]length|head to toe|whole body|entire body|feet visible)\b/i],
];

export function framingLevels(text: string): FramingLevel[] {
  return LEVEL_RE.filter(([, re]) => re.test(text)).map(([l]) => l);
}

/** OpenPose-18 keypoints, normalized [x, y, confidence]*18 (DWPose output). */
export function skeletonExtent(flat: number[] | null | undefined): FramingLevel | null {
  if (!flat || flat.length < 54) return null;
  const vis = (i: number) => flat[i * 3 + 2] > 0 && flat[i * 3] >= 0 && flat[i * 3] <= 1 && flat[i * 3 + 1] >= 0 && flat[i * 3 + 1] <= 1;
  const any = (...ids: number[]) => ids.some(vis);
  if (any(10, 13)) return 'full body';
  if (any(9, 12)) return 'knee-up';
  if (any(8, 11)) {
    // hips visible, knees not: how much of the thighs is in frame?
    const hipY = Math.max(...[8, 11].filter(vis).map((i) => flat[i * 3 + 1]));
    const neckY = vis(1) ? flat[4] : hipY - 0.3;
    return 1 - hipY > 0.35 * Math.max(0.05, hipY - neckY) ? 'thigh-up' : 'waist-up';
  }
  if (any(2, 5)) return 'chest-up';
  if (any(0, 14, 15)) return 'close-up';
  return null;
}

export interface FramingIssue {
  severity: 'warn' | 'info';
  message: string;
  /** Optional one-tap fix; never applied automatically. */
  suggestion?: { field: keyof PromptFields; value: string; label: string };
}

const FOOTWEAR = /\b(shoes?|sneakers?|heels|boots?|sandals?|loafers|flats|stilettos?|slippers?|socks)\b/i;
const LONG_HEM = /\b(midi|maxi|floor[- ]length|ankle[- ]length|knee[- ]length|long skirt|long dress|gown)\b/i;
const MIRROR_SELFIE = /\bmirror\b[^.]*\bselfie\b|\bselfie\b[^.]*\bmirror\b/i;
const THIRD_PERSON = /\b(photographed by|taken by|shot by) (?:another person|a friend|someone|a photographer)|\banother person\b|\bthird[- ]person\b/i;
const ARM_SELFIE = /\bselfie\b/i;

export function detectFramingConflicts(fields: PromptFields, poseExtent?: FramingLevel | null): FramingIssue[] {
  const issues: FramingIssue[] = [];
  const all = [fields.framing, fields.pose, fields.camera, fields.extra, fields.setting, fields.bodyPresentation].join(' . ');
  const requested = framingLevels(all);
  const framingField = framingLevels(fields.framing);

  // 1. The text asks for two different shot sizes.
  if (requested.length > 1) {
    const [a, b] = [requested[0], requested[requested.length - 1]];
    issues.push({
      severity: 'warn',
      message: `The description asks for both “${a}” and “${b}” framing — the model can only do one. Keep one of them.`,
    });
  }

  // 2. Mirror selfie vs. photographed by someone else.
  if (MIRROR_SELFIE.test(all) && THIRD_PERSON.test(all)) {
    issues.push({ severity: 'warn', message: 'A mirror selfie and “photographed by another person” contradict each other — pick one camera.' });
  }

  // 3. Arm's-length selfie with a wide shot.
  const want = framingField[0] ?? requested[0];
  if (ARM_SELFIE.test(all) && !/\bmirror\b/i.test(all) && want && LEVEL(want) >= LEVEL('knee-up')) {
    issues.push({
      severity: 'warn',
      message: `An arm's-length selfie can't show a ${want} shot. Use a mirror selfie, or describe it as taken by someone else.`,
    });
  }

  // 4. The pose photo's skeleton decides the composition.
  if (poseExtent) {
    if (want && want !== poseExtent) {
      const gap = Math.abs(LEVEL(want) - LEVEL(poseExtent));
      issues.push({
        severity: gap >= 2 ? 'warn' : 'info',
        message: `Framing asks for “${want}”, but the pose photo shows a ${poseExtent} body — the pose usually wins. Match the framing to the pose, or crop the pose photo.`,
        suggestion: { field: 'framing', value: poseExtent === 'full body' ? 'full body shot' : `${poseExtent} shot`, label: `Use “${poseExtent}” framing` },
      });
    } else if (!want) {
      issues.push({
        severity: 'info',
        message: `No framing set — the pose photo will give a ${poseExtent} shot.`,
        suggestion: { field: 'framing', value: poseExtent === 'full body' ? 'full body shot' : `${poseExtent} shot`, label: `Set “${poseExtent}” framing` },
      });
    }
  }

  // 5. Clothing details that the requested framing won't show.
  const shot = poseExtent ?? want;
  if (shot && LEVEL(shot) < LEVEL('full body') && FOOTWEAR.test(fields.outfit)) {
    issues.push({ severity: 'info', message: `Footwear is in the outfit, but a ${shot} shot won't show feet.` });
  }
  if (shot && LEVEL(shot) <= LEVEL('waist-up') && LONG_HEM.test(fields.outfit)) {
    issues.push({ severity: 'info', message: `The outfit's hemline won't be visible in a ${shot} shot.` });
  }
  return issues;
}
