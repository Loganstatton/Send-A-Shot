import { describe, expect, it } from 'vitest';
import sdxl from '../workflows/examples/sienna-sdxl-production.json';
import { analyzeCaption, MOCK_OUTFIT_CAPTION, buildOutfitAnalysisGraph, extractOutfitAttributes, garmentIsolationNodes, outfitFromCaption, OUTFIT_WEIGHT_TYPE } from './outfit';
import type { ComfyGraph } from './types';

describe('garment isolation', () => {
  it('matches the nodes in the production workflow (single source of truth)', () => {
    const { nodes, outputId } = garmentIsolationNodes('60');
    expect(outputId).toBe('68');
    for (const [id, n] of Object.entries(nodes)) {
      expect((sdxl as ComfyGraph)[id]).toEqual(n);
    }
  });

  it('analysis graph: Florence-2 captions the garment-only crop, never the raw photo', () => {
    const g = buildOutfitAnalysisGraph('sienna/o.png');
    const run = Object.values(g).find((n) => n.class_type === 'Florence2Run')!;
    const src = g[(run.inputs.image as [string, number])[0]];
    expect(src.class_type).toBe('ImageCompositeMasked');
    expect(run.inputs.task).toBe('more_detailed_caption');
    expect(run.inputs.do_sample).toBe(false);
    expect(Object.values(g).some((n) => n.class_type === 'SiennaTextOutput')).toBe(true);
    expect(g['1'].inputs.image).toBe('sienna/o.png');
  });

  it('mode → IPAdapter weight type', () => {
    expect(OUTFIT_WEIGHT_TYPE.design).toBe('style transfer');
    expect(OUTFIT_WEIGHT_TYPE.close).toBe('linear');
  });
});

describe('outfitFromCaption', () => {
  it('keeps the clothes and drops face, hair, body and background', () => {
    const caption =
      'The image shows a slim young woman with long blonde hair standing in front of a white wall. She is wearing a black satin slip dress with thin spaghetti straps and a deep v-neckline. ' +
      'The dress is fitted and ends just above the knee. Her face is not visible. The background is grey.';
    const out = outfitFromCaption(caption);
    expect(out).toContain('black satin slip dress with thin spaghetti straps and a deep v-neckline');
    expect(out).toContain('the dress is fitted and ends just above the knee');
    expect(out).not.toMatch(/hair|blonde|slim|young|wall|grey|face/i);
  });

  it('cuts a "wearing" clause where it turns into pose/setting', () => {
    expect(outfitFromCaption('A woman wearing a red bikini top and high-waisted bottoms while standing on a beach.')).toBe(
      'red bikini top and high-waisted bottoms',
    );
  });

  it('keeps garment words that look like body words ("thin straps", "short sleeves")', () => {
    expect(outfitFromCaption('She is wearing a white blouse with short sleeves and thin straps.')).toBe('white blouse with short sleeves and thin straps');
  });

  it('returns empty when nothing is about clothing', () => {
    expect(outfitFromCaption('The image shows a grey background with a blurred shape.')).toBe('');
  });
});

describe('extractOutfitAttributes', () => {
  it('finds each attribute group; longer phrases win', () => {
    const a = extractOutfitAttributes('emerald green satin midi dress with thin spaghetti straps, square neck, high slit, fitted, thin gold belt');
    expect(a.type).toEqual(['midi dress']);
    expect(a.colour).toEqual(expect.arrayContaining(['green', 'emerald', 'gold']));
    expect(a.fabric).toEqual(['satin']);
    expect(a.straps).toEqual(['spaghetti straps']);
    expect(a.neckline).toEqual(['square neck']);
    expect(a.cutouts).toEqual(['high slit']);
    expect(a.coverage).toEqual(['midi']);
    expect(a.fit).toEqual(['fitted']);
    expect(a.accessories).toEqual(['belt']);
  });

  it('reports "mini dress" once, not also "dress" or "mini"', () => {
    const a = extractOutfitAttributes('a black mini dress');
    expect(a.type).toEqual(['mini dress']);
  });

  it('empty lists mean not detected', () => {
    const a = extractOutfitAttributes('something');
    expect(Object.values(a).every((v) => v.length === 0)).toBe(true);
  });
});

describe('analyzeCaption', () => {
  it('turns the mock caption into an outfit description and attributes', () => {
    const r = analyzeCaption(MOCK_OUTFIT_CAPTION);
    expect(r.outfitText).toMatch(/^fitted emerald green satin midi dress with thin spaghetti straps and a square neckline/);
    expect(r.outfitText).toContain('thin gold belt');
    expect(r.outfitText).not.toMatch(/background|wall/);
    expect(r.attributes.type).toEqual(['midi dress']);
    expect(r.attributes.neckline).toEqual(['square neck']);
    expect(r.attributes.cutouts).toEqual(['high slit']);
    expect(r.notes).toEqual([]);
  });

  it('explains when nothing was found instead of returning silence', () => {
    expect(analyzeCaption('').notes[0]).toMatch(/no description/);
    expect(analyzeCaption('A grey background.').notes.join(' ')).toMatch(/No clothing was recognised/);
  });
});
