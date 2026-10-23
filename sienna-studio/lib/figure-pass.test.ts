import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { addFigurePass, FIGURE_NEGATIVE_WORDS, FIGURE_NODES, FIGURE_STYLES, FIGURE_WORDS, parseFigurePass } from './comfy/figure-pass';
import type { ComfyGraph } from './types';

const prod = (): ComfyGraph => JSON.parse(readFileSync(new URL('../workflows/examples/sienna-sdxl-production.json', import.meta.url), 'utf8'));
const opts = { file: 'pack_1883628.safetensors', strength: 0.7, denoise: 0.55, baseLoraId: '2', faceRefineId: '51' };

describe('targeted figure pass (test only)', () => {
  it('redraws only the masked region of the final image and saves the colour-matched composite', () => {
    const g = addFigurePass(prod(), opts)!;
    const n = FIGURE_NODES;
    expect(g['42'].inputs.images).toEqual([n.composite, 0]);
    // everything reads the image the face/hand passes produced
    for (const id of [n.pose, n.person, n.mask]) expect(g[id].inputs.image).toEqual(['51', 0]);
    expect(g[n.composite].inputs).toMatchObject({ original: ['51', 0], redrawn: [n.decode, 0], mask: [n.mask, 0], soft_mask: [n.mask, 1] });
    expect(g[n.noiseMask].inputs).toEqual({ samples: [n.encode, 0], mask: [n.mask, 0] });
    expect(g[n.sampler].inputs).toMatchObject({ model: [n.lora, 0], positive: [n.positive, 0], negative: [n.negative, 0], latent_image: [n.noiseMask, 0], denoise: 0.55 });
    // her usual negative plus the no-scrunch words, through the figure LoRA's text encoder
    expect(g[n.negative].inputs).toEqual({ clip: [n.lora, 1], text: `${prod()['4'].inputs.text}, ${FIGURE_NEGATIVE_WORDS}` });
    expect(FIGURE_WORDS).toMatch(/gluteal fold/);
  });
  it('the figure LoRA and wording go only into the redraw: the main sampler and the face pass are unchanged', () => {
    const before = prod();
    const g = addFigurePass(before, opts)!;
    expect(g[FIGURE_NODES.lora].inputs).toMatchObject({ model: ['2', 0], clip: ['2', 1], lora_name: 'pack_1883628.safetensors', strength_model: 0.7 });
    expect(g[FIGURE_NODES.positive].inputs.text).toBe(`${before['3'].inputs.text}, ${FIGURE_WORDS}`);
    for (const id of ['40', '51', '3', '2']) expect(g[id]).toEqual(before[id]);
  });
  it('the "fuller" test style: stronger wording, no cellulite or sagging, more room past her outline', () => {
    const g = addFigurePass(prod(), { ...opts, style: 'fuller' })!;
    expect(g[FIGURE_NODES.positive].inputs.text).toContain(FIGURE_STYLES.fuller.words);
    expect(g[FIGURE_NODES.positive].inputs.text).not.toContain(FIGURE_WORDS);
    expect(g[FIGURE_NODES.negative].inputs.text).toContain(`${FIGURE_NEGATIVE_WORDS}, ${FIGURE_STYLES.fuller.negative}`);
    expect(g[FIGURE_NODES.mask].inputs.grow).toBe(0.12);
    expect(addFigurePass(prod(), opts)![FIGURE_NODES.mask].inputs.grow).toBe(0.08);
  });
  it('nothing to copy from: no pass', () => {
    expect(addFigurePass(prod(), { ...opts, faceRefineId: 'nope' })).toBeNull();
    const g = prod();
    delete g['42'];
    expect(addFigurePass(g, opts)).toBeNull();
  });
  it('reads the nodes\' reports', () => {
    expect(parseFigurePass({ [FIGURE_NODES.mask]: ['{"mask":0.081}'], [FIGURE_NODES.composite]: ['{"color_shift":{"skin":[2,0,1]},"hip_width_change":0.031}'] }))
      .toEqual({ mask: 0.081, colorShift: { skin: [2, 0, 1] }, hipWidthChange: 0.031 });
    expect(parseFigurePass({ [FIGURE_NODES.mask]: ['{"skipped":"hips or her outline not found"}'] })).toEqual({ skipped: 'hips or her outline not found' });
    expect(parseFigurePass({})).toBeUndefined();
    expect(parseFigurePass({ [FIGURE_NODES.mask]: ['{"mask":0.09}'], [FIGURE_NODES.composite]: ['{"completed":false,"fallback":"paste-back not completed (composite timed out after 90s); photo left as made"}'] }))
      .toEqual({ completed: false, fallback: 'paste-back not completed (composite timed out after 90s); photo left as made', mask: 0.09 });
  });
});
