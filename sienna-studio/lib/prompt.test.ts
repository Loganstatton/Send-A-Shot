import { describe, expect, it } from 'vitest';
import { DEFAULT_CHARACTER, EMPTY_FIELDS } from './defaults';
import { buildPrompt, joinParts } from './prompt';

const character = { ...DEFAULT_CHARACTER, triggerToken: 'sienna_v1', loraFilename: 'sienna_v1.safetensors' };

describe('buildPrompt', () => {
  it('puts trigger token and traits first when locked', () => {
    const r = buildPrompt({ fields: { ...EMPTY_FIELDS, outfit: 'red hoodie' }, character, siennaLock: true, contentMode: 'sfw' });
    expect(r.positive.startsWith('sienna_v1, 26-year-old adult woman, ')).toBe(true);
    expect(r.positive).toContain('red hoodie');
    expect(r.positive).toContain(character.defaultCameraStyle);
  });

  it('removes identity edits under Sienna Lock and warns', () => {
    const r = buildPrompt({ fields: { ...EMPTY_FIELDS, outfit: 'platinum blonde hair, tank top' }, character, siennaLock: true, contentMode: 'sfw' });
    expect(r.positive).not.toMatch(/blonde/);
    expect(r.positive).toContain('tank top');
    expect(r.warnings.some((w) => w.includes('blonde'))).toBe(true);
  });

  it('does not inject identity when unlocked', () => {
    const r = buildPrompt({ fields: { ...EMPTY_FIELDS, outfit: 'blonde hair' }, character, siennaLock: false, contentMode: 'sfw' });
    expect(r.positive).not.toContain('sienna_v1');
    expect(r.positive).toContain('blonde hair');
    expect(r.positive.startsWith('adult woman')).toBe(true);
  });

  it('always includes adult-only negatives; SFW adds nsfw negatives', () => {
    const sfw = buildPrompt({ fields: EMPTY_FIELDS, character, siennaLock: true, contentMode: 'sfw' });
    const adult = buildPrompt({ fields: EMPTY_FIELDS, character, siennaLock: true, contentMode: 'adult' });
    expect(sfw.negative).toMatch(/\bteen\b/);
    expect(adult.negative).toMatch(/\bteen\b/);
    expect(sfw.negative).toMatch(/nsfw/);
    expect(adult.negative).not.toMatch(/nsfw/);
  });

  it('drops the anti-studio negative only when studio lighting is requested', () => {
    const casual = buildPrompt({ fields: EMPTY_FIELDS, character, siennaLock: true, contentMode: 'sfw' });
    const studio = buildPrompt({ fields: { ...EMPTY_FIELDS, lighting: 'studio softbox' }, character, siennaLock: true, contentMode: 'sfw' });
    expect(casual.negative).toMatch(/studio lighting/);
    expect(studio.negative).not.toMatch(/studio lighting/);
  });

  it('reports hard blocks', () => {
    const r = buildPrompt({ fields: { ...EMPTY_FIELDS, outfit: 'school girl uniform' }, character, siennaLock: true, contentMode: 'sfw' });
    expect(r.blocked.length).toBeGreaterThan(0);
  });

  it('clamps age to the adult minimum', () => {
    const r = buildPrompt({ fields: EMPTY_FIELDS, character: { ...character, age: 12 }, siennaLock: true, contentMode: 'sfw' });
    expect(r.positive).toContain('21-year-old adult woman');
  });
});

describe('joinParts', () => {
  it('dedupes and drops empties', () => {
    expect(joinParts(['a', '', ' A ', 'b', null])).toBe('a, b');
  });
});
