import { describe, expect, it } from 'vitest';
import { EMPTY_FIELDS } from './defaults';
import { detectFramingConflicts, framingLevels, skeletonExtent } from './framing';

const F = (o: Partial<typeof EMPTY_FIELDS>) => ({ ...EMPTY_FIELDS, ...o });
/** 18 keypoints, all visible unless listed in `hide`; y from a simple standing layout. */
function skel(hide: number[] = [], hipY = 0.55) {
  const ys = [0.1, 0.18, 0.19, 0.32, 0.45, 0.19, 0.32, 0.45, hipY, hipY + 0.2, hipY + 0.38, hipY, hipY + 0.2, hipY + 0.38, 0.09, 0.09, 0.1, 0.1];
  return ys.flatMap((y, i) => (hide.includes(i) ? [0, 0, 0] : [0.5, y, 1]));
}

describe('framingLevels', () => {
  it('reads common phrasings', () => {
    expect(framingLevels('waist-up, mirror frame visible')).toEqual(['waist-up']);
    expect(framingLevels('full length shot, head to toe')).toEqual(['full body']);
    expect(framingLevels('three-quarter shot')).toEqual(['thigh-up']);
    expect(framingLevels('close up of her face')).toEqual(['close-up']);
  });
});

describe('skeletonExtent', () => {
  it('ankles → full body; knees → knee-up; hips → thigh/waist; shoulders → chest-up', () => {
    expect(skeletonExtent(skel())).toBe('full body');
    expect(skeletonExtent(skel([10, 13]))).toBe('knee-up');
    expect(skeletonExtent(skel([9, 10, 12, 13], 0.6))).toBe('thigh-up');
    expect(skeletonExtent(skel([9, 10, 12, 13], 0.95))).toBe('waist-up');
    expect(skeletonExtent(skel([8, 9, 10, 11, 12, 13]))).toBe('chest-up');
    expect(skeletonExtent(null)).toBeNull();
  });
});

describe('detectFramingConflicts', () => {
  it('your case: waist-up framing with a thigh-up pose photo', () => {
    const issues = detectFramingConflicts(F({ framing: 'waist-up, mirror frame visible', pose: 'taking a mirror selfie' }), 'thigh-up');
    expect(issues).toHaveLength(1);
    expect(issues[0].severity).toBe('info'); // one step apart
    expect(issues[0].suggestion).toEqual({ field: 'framing', value: 'thigh-up shot', label: 'Use “thigh-up” framing' });
  });
  it('two steps apart is a warning', () => {
    const issues = detectFramingConflicts(F({ framing: 'waist-up' }), 'full body');
    expect(issues[0].severity).toBe('warn');
  });
  it('contradictory text', () => {
    expect(detectFramingConflicts(F({ framing: 'waist-up', pose: 'full body mirror selfie' }))[0].message).toMatch(/both “waist-up” and “full body”/);
    expect(detectFramingConflicts(F({ pose: 'mirror selfie', camera: 'photographed by another person' }))[0].message).toMatch(/mirror selfie/);
    expect(detectFramingConflicts(F({ pose: 'taking a selfie', framing: 'full body' }))[0].message).toMatch(/arm's-length/);
  });
  it('mirror full-body selfie is fine', () => {
    expect(detectFramingConflicts(F({ pose: 'full body mirror selfie', framing: 'full body' }))).toEqual([]);
  });
  it('hidden clothing details are informational', () => {
    const issues = detectFramingConflicts(F({ framing: 'waist-up', outfit: 'white sneakers and a maxi skirt' }));
    expect(issues.map((i) => i.severity)).toEqual(['info', 'info']);
  });
  it('never returns anything when nothing conflicts', () => {
    expect(detectFramingConflicts(F({ outfit: 'jeans', framing: 'waist-up' }), 'waist-up')).toEqual([]);
  });
});
