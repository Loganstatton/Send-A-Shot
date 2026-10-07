import { describe, expect, it } from 'vitest';
import { DEFAULT_CHARACTER, DEFAULT_PARAMS } from './defaults';
import { SIENNA_MODELS, resolveLockedLora } from './sienna-models';

describe('resolveLockedLora', () => {
  it("uses the profile's LoRA by default", () => {
    expect(DEFAULT_CHARACTER.loraFilename).toBe('sienna_v2.safetensors');
    expect(DEFAULT_PARAMS.siennaModel).toBe('');
    expect(resolveLockedLora(DEFAULT_CHARACTER.loraFilename, DEFAULT_PARAMS.siennaModel)).toEqual({ file: 'sienna_v2.safetensors' });
    expect(resolveLockedLora('sienna_v2.safetensors', undefined)).toEqual({ file: 'sienna_v2.safetensors' });
  });

  it('uses an approved A/B model when chosen', () => {
    expect(SIENNA_MODELS.map((m) => m.file)).toContain('sienna_v3_3_s3750.safetensors');
    expect(resolveLockedLora('sienna_v2.safetensors', 'sienna_v3_3_s3750.safetensors')).toEqual({ file: 'sienna_v3_3_s3750.safetensors' });
  });

  it('ignores a LoRA that is not on the approved list', () => {
    expect(resolveLockedLora('sienna_v2.safetensors', 'someone_else.safetensors')).toEqual({
      file: 'sienna_v2.safetensors',
      ignored: 'someone_else.safetensors',
    });
  });
});
