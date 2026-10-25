import { describe, expect, it } from 'vitest';
import { outputHeight } from './framing';

describe('outputHeight', () => {
  it('the hi-res pass scales the saved photo; checks that measure it use the real height', () => {
    expect(outputHeight({ height: 1216 })).toBe(1216);
    expect(outputHeight({ height: 1216, hires: false, hiresScale: 1.5 })).toBe(1216);
    expect(outputHeight({ height: 1216, hires: true, hiresScale: 1.5 })).toBe(1824);
    expect(outputHeight({ height: 832, hires: true })).toBe(1248);
    expect(outputHeight({ height: 832, hires: true, hiresScale: 3 })).toBe(1664);
  });
});
