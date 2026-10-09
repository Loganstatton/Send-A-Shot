import { describe, expect, it } from 'vitest';
import { bodyReferenceProblem } from './body-refs';
import type { GenerationRecord } from './types';

const img = { id: 'i1', file: 'gen_a.png', createdAt: '' };
const rec = (over: Partial<GenerationRecord> = {}) =>
  ({ status: 'done', images: [img], siennaLock: true, lora: { name: 'sienna_v2.safetensors', strength: 0.8, clipStrength: 1, injected: false }, initImage: null, outfitReference: null, ...over }) as GenerationRecord;

describe('bodyReferenceProblem', () => {
  it('accepts a plain approved-LoRA generation', () => expect(bodyReferenceProblem(rec())).toBeNull());
  it('refuses other or candidate LoRAs', () => {
    expect(bodyReferenceProblem(rec({ lora: { name: 'sienna_v3_3_s3750.safetensors', strength: 1, clipStrength: 1, injected: false } }))).toMatch(/only sienna_v2/);
    expect(bodyReferenceProblem(rec({ lora: null }))).toMatch(/no Sienna LoRA/);
  });
  it('refuses images whose body may come from another person', () => {
    expect(bodyReferenceProblem(rec({ outfitReference: { image: img, strength: 0.7, mode: 'design' } }))).toMatch(/outfit reference/);
    expect(bodyReferenceProblem(rec({ initImage: img }))).toMatch(/img2img/);
    expect(bodyReferenceProblem(rec({ outfitEdit: {} as any }))).toMatch(/Edit Outfit/);
    expect(bodyReferenceProblem(rec({ siennaLock: false }))).toMatch(/Lock off/);
    expect(bodyReferenceProblem(rec({ status: 'error', images: [] }))).toMatch(/no finished image/);
  });
});
