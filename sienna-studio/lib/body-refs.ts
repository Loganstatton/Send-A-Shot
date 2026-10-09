/**
 * Sienna body references (experimental, Edit Outfit body protection).
 *
 * A small set of APPROVED Sienna images that show her established body. Edit Outfit can give them to the
 * editor (so the new outfit is drawn on her body, not the clothing model's) and the body check compares
 * against the RANGE they span — never a single photo.
 *
 * Only images made by her approved identity LoRA count, and only ones whose body came from that LoRA alone:
 * an outfit-reference generation, an img2img from another photo or an Edit Outfit result may carry someone
 * else's figure, so they are refused.
 */

import type { GenerationRecord, StoredImage } from './types';

/** LoRAs whose generations may serve as body references. v2 is the approved identity model. */
export const APPROVED_BODY_MODELS = ['sienna_v2.safetensors'];
export const MIN_BODY_REFS = 3;
export const MAX_BODY_REFS = 4;

export interface BodyReference {
  image: StoredImage;
  recordId: string;
  lora: string;
  addedAt: string;
}

/** Why this image can't be a body reference, or null if it can. */
export function bodyReferenceProblem(rec: GenerationRecord, imageIndex = 0): string | null {
  if (rec.status !== 'done' || !rec.images[imageIndex]) return 'the generation has no finished image';
  const lora = rec.lora?.name ?? '';
  if (!APPROVED_BODY_MODELS.includes(lora)) return `made with ${lora || 'no Sienna LoRA'} — only ${APPROVED_BODY_MODELS.join(', ')} images can define her body`;
  if (!rec.siennaLock) return 'made with Sienna Lock off';
  if (rec.outfitEdit) return 'an Edit Outfit result — its body may come from the clothing photo';
  if (rec.outfitReference) return 'made with an outfit reference photo — its body may come from that photo';
  if (rec.initImage) return 'made from another image (img2img) — its body may come from that image';
  return null;
}
