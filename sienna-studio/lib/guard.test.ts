import { describe, expect, it } from 'vitest';
import { applyIdentityLock, findHardBlocks } from './guard';

describe('findHardBlocks', () => {
  it.each(['teen girl', 'schoolgirl outfit', '16 year old', 'aged 15', 'childlike face', 'looks young', 'loli', 'little girl'])(
    'blocks minor-coded term: %s',
    (t) => expect(findHardBlocks(t).length).toBeGreaterThan(0),
  );
  it.each(['celebrity lookalike', 'resembling a famous actress', 'face swap', 'deepfake'])('blocks real-person likeness: %s', (t) =>
    expect(findHardBlocks(t).length).toBeGreaterThan(0),
  );
  it.each(['oversized sweater, skinny jeans', 'canteen in the background', 'iPhone 15 Pro selfie', 'young woman in her late twenties', 'babydoll dress'])(
    'allows ordinary text: %s',
    (t) => expect(findHardBlocks(t)).toEqual([]),
  );
});

describe('applyIdentityLock', () => {
  it('strips hair and eye colour changes but keeps clothing colours', () => {
    const r = applyIdentityLock('black dress, blonde hair, blue eyes, white sneakers');
    expect(r.text).toBe('black dress, white sneakers');
    expect(r.removed.map((x) => x.category)).toEqual(expect.arrayContaining(['hair colour', 'eye colour']));
  });

  it('strips multi-word colours like "platinum blonde hair" and "dark brown eyes"', () => {
    const r = applyIdentityLock('white tank top, platinum blonde hair, dark brown eyes');
    expect(r.text).toBe('white tank top');
  });

  it('keeps hairstyles (styling is allowed)', () => {
    const r = applyIdentityLock('messy bun, ponytail with a scrunchie');
    expect(r.text).toBe('messy bun, ponytail with a scrunchie');
    expect(r.removed).toEqual([]);
  });

  it('strips age and face changes', () => {
    const r = applyIdentityLock('different face, 45 years old, wrinkles, smiling');
    expect(r.text).toBe('smiling');
    expect(r.removed.length).toBe(3);
  });

  it('honours custom locked terms', () => {
    const r = applyIdentityLock('wearing glasses and a red scarf', ['glasses']);
    expect(r.text).not.toMatch(/glasses/);
    expect(r.text).toMatch(/red scarf/);
  });

  it('does not treat "skinny" as skin tone', () => {
    expect(applyIdentityLock('dark skinny jeans').text).toBe('dark skinny jeans');
  });
});
