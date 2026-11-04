import { describe, expect, it } from 'vitest';
import sdxl from '../../workflows/examples/sienna-sdxl-production.json';
import type { ComfyGraph } from '../types';
import { addKeepScene, KEEP_SCENE_PREFIX as P, sceneSize } from './keep-scene';
import { addCopyColours, addFaceUpright, COPY_COLOURS_LOCAL, COPY_SHADE, LOCK_COLOUR_PRIOR, addCoverUp, COVER, coverColour, DETAIL, GARMENT_PASS, handCheckNode, parseHandCheck, garmentLines, KEEP_SCENE_GROW, LOCK_DETAIL_DENOISE, SOURCE_LOCK } from './keep-scene';

const graph = () => {
  const g = structuredClone(sdxl) as ComfyGraph;
  g['40'].inputs.latent_image = ['32', 0]; // img2img: the first pass starts from the encoded init image
  for (const id of ['80', '81', '82', '83', '84', '85']) delete g[id]; // the unused hi-res pass (applyQualityOptions drops it)
  return g;
};

describe('sceneSize', () => {
  it('keeps the photo’s shape near a megapixel', () => {
    const s = sceneSize(720, 1200);
    expect(s.width % 8).toBe(0);
    expect(s.height % 8).toBe(0);
    expect(Math.abs(s.width / s.height - 0.6)).toBeLessThan(0.01);
    expect(s.width * s.height).toBeGreaterThan(900_000);
  });
});

describe('addKeepScene', () => {
  it('redraws only the person (and overlays) and pastes the photo back around her', () => {
    const g = addKeepScene(graph(), { width: 776, uiMask: true })!;
    expect(g).not.toBeNull();
    expect(g['40'].inputs.latent_image).toEqual([`${P}noise`, 0]);
    expect(g['40'].inputs.denoise).toBe(1);
    expect(g[`${P}noise`].inputs.samples).toEqual(['32', 0]);
    expect(g[`${P}person`].inputs.image).toEqual(['31', 0]);
    expect(g[`${P}union`].inputs.source).toEqual([`${P}ui`, 0]);
    expect(g[`${P}paste`].inputs).toMatchObject({ destination: ['41', 0], source: ['31', 0], mask: [`${P}soft`, 0] });
    // what stays redrawn: the new person and the old one (and the overlays), never more than the redraw
    expect(g[`${P}new`].inputs.image).toEqual(['41', 0]);
    expect(g[`${P}within`].inputs).toMatchObject({ destination: [`${P}bothui`, 0], source: [`${P}union`, 0], operation: 'multiply' });
    expect(g[`${P}keep`].inputs.mask).toEqual([`${P}within`, 0]);
    // everything that read the decoded picture now reads the pasted one
    for (const [id, n] of Object.entries(g)) if (id !== `${P}paste` && id !== `${P}new`) for (const v of Object.values(n.inputs)) expect(v).not.toEqual(['41', 0]);
  });
  it('paints the overlays out instead of redrawing them when the node can', () => {
    const g = addKeepScene(graph(), { width: 776, uiMask: true, uiPaint: true })!;
    expect(g['32'].inputs.pixels).toEqual([`${P}ui`, 2]);
    expect(g[`${P}paste`].inputs.source).toEqual([`${P}ui`, 2]);
    expect(g[`${P}noise`].inputs.mask).toEqual([`${P}grow`, 0]);
    expect(g[`${P}union`]).toBeUndefined();
    expect(g[`${P}within`].inputs.destination).toEqual([`${P}both`, 0]);
    // a light second pass over the painted-out spots, and the rest of the graph reads its result
    expect(g[`${P}uiks`].inputs).toMatchObject({ denoise: 0.5, latent_image: [`${P}uinoise`, 0], positive: ['22', 0] });
    expect(g[`${P}uienc`].inputs.pixels).toEqual([`${P}paste`, 0]);
    for (const [id, n] of Object.entries(g)) if (!id.startsWith(P)) for (const v of Object.values(n.inputs)) expect(v).not.toEqual([`${P}paste`, 0]);
  });
  it('traces the garment’s outline with the union ControlNet when asked', () => {
    const g = addKeepScene(graph(), { width: 776, height: 1296, garment: { phrases: ['bikini top'], controlnet: 'u.safetensors' } })!;
    expect(g['40'].inputs.positive).toEqual([`${P}cnapply`, 0]);
    expect(g['40'].inputs.negative).toEqual([`${P}cnapply`, 1]);
    expect(g[`${P}cnapply`].inputs.positive).toEqual(['22', 0]);
    expect(g[`${P}seg0`].inputs).toMatchObject({ text_input: 'bikini top', image: ['31', 0] });
    expect(g[`${P}lines`].inputs.mask).toEqual([`${P}gmask`, 0]);
    expect(g[`${P}cntype`].inputs.type).toBe('canny/lineart/anime_lineart/mlsd');
    expect(g[`${P}body`]).toBeUndefined();
  });
  it('adds her figure’s outline without the head when asked', () => {
    const g = addKeepScene(graph(), { width: 776, height: 1296, garment: { phrases: ['bikini top'], controlnet: 'u.safetensors', body: true } })!;
    expect(g[`${P}body`].inputs).toMatchObject({ destination: [`${P}person`, 0], source: [`${P}face`, 0], operation: 'subtract' });
    expect(g[`${P}lines`].inputs.destination).toEqual([`${P}black`, 0]);
    expect(g[`${P}bodyonly`].inputs.destination).toEqual([`${P}bodylines`, 0]);
    expect(g[`${P}cnbody`].inputs.positive).toEqual([`${P}cnapply`, 0]);
    expect(g[`${P}cnbody`].inputs.strength).toBeLessThan(g[`${P}cnapply`].inputs.strength as number);
    expect(g['40'].inputs.positive).toEqual([`${P}cnbody`, 0]);
    expect(g[`${P}cndapply`]).toBeUndefined();
  });
  it('adds her figure’s depth (no head) as a second guide when the server has a depth node', () => {
    const g = addKeepScene(graph(), { width: 776, height: 1296, garment: { phrases: ['bikini top'], controlnet: 'u.safetensors', body: true, depth: 'DepthAnythingV2Preprocessor' } })!;
    expect(g[`${P}cndtype`].inputs.type).toBe('depth');
    expect(g[`${P}bodydepth`].inputs).toMatchObject({ source: [`${P}depth`, 0], mask: [`${P}body`, 0], resize_source: true });
    expect(g[`${P}cndapply`].inputs.positive).toEqual([`${P}cnbody`, 0]);
    expect(g['40'].inputs.positive).toEqual([`${P}cndapply`, 0]);
    expect(g['40'].inputs.negative).toEqual([`${P}cndapply`, 1]);
  });
  it('is skipped without an init image or with the hi-res pass', () => {
    expect(addKeepScene(structuredClone(sdxl) as ComfyGraph, { width: 776 })).toBeNull();
    const g = graph();
    g.x = { class_type: 'ImageScaleBy', inputs: {} };
    expect(addKeepScene(structuredClone(g), { width: 776 })).toBeNull();
    delete g.x;
    g['40'].inputs.latent_image = ['33', 0];
    expect(addKeepScene(g, { width: 776 })).toBeNull();
  });
});

describe('garmentLines', () => {
  it('defaults to the stronger outline and reads an override', () => {
    expect(garmentLines(undefined)).toEqual({ strength: 0.9, end: 0.65 });
    expect(garmentLines('0.75,0.65')).toEqual({ strength: 0.75, end: 0.65 });
    expect(garmentLines('junk')).toEqual({ strength: 0.9, end: 0.65 });
  });
});

describe('addCopyColours', () => {
  it('is the last change before SaveImage, reading the photo inside its person', () => {
    const kept = addKeepScene(graph(), { width: 776 })!;
    const saveId = Object.keys(kept).find((id) => kept[id].class_type === 'SaveImage')!;
    const before = kept[saveId].inputs.images;
    const g = addCopyColours(kept)!;
    expect(g[`${P}colours`].class_type).toBe('SiennaCopyColours');
    expect(g[`${P}colours`].inputs.image).toEqual(before);
    expect(g[`${P}colours`].inputs.photo).toEqual(kept[`${P}person`].inputs.image);
    expect(g[`${P}colours`].inputs.region).toEqual([`${P}new`, 0]);
    expect(g[`${P}colours`].inputs.photo_region).toEqual([`${P}oldgrow`, 0]);
    expect(g[saveId].inputs.images).toEqual([`${P}colours`, 0]);
  });
  it('matches each garment piece on its own for a source-locked copy only', () => {
    const kept = addKeepScene(graph(), { width: 776 })!;
    expect(addCopyColours(kept)![`${P}colours`].inputs).not.toHaveProperty('local');
    expect(addCopyColours(kept, { local: 1 })![`${P}colours`].inputs.local).toBe(1);
  });
  it('takes the photo’s light and shade only when asked (source-locked copies)', () => {
    const kept = addKeepScene(graph(), { width: 776 })!;
    expect(addCopyColours(kept)![`${P}colours`].inputs).not.toHaveProperty('shade');
    expect(addCopyColours(kept, { local: 1, shade: COPY_SHADE })![`${P}colours`].inputs).toMatchObject({ local: 1, shade: COPY_SHADE });
  });
  it('does nothing without a keep-scene redraw', () => {
    expect(addCopyColours(graph())).toBeNull();
  });
});

describe('addCoverUp', () => {
  it('redraws only where a nipple shows, as the top fabric, before SaveImage and the colour step', () => {
    const kept = addKeepScene(graph(), { width: 776 })!;
    const saveId = Object.keys(kept).find((id) => kept[id].class_type === 'SaveImage')!;
    const before = kept[saveId].inputs.images;
    const g = addCoverUp(kept, { top: 'tiny white micro string bikini top', threshold: 0.25 })!;
    expect(g[`${P}covmask`].class_type).toBe('SiennaCoverMask');
    expect(g[`${P}covmask`].inputs).toMatchObject({ image: before, threshold: 0.25, fill: '#f2f1ee', locate: true });
    // a second look at the covered photo, a larger patch at the breast's middle for anything still showing
    expect(g[`${P}covmask2`].inputs).toMatchObject({ image: [`${P}cover`, 0], locate: false, radius: COVER.secondRadius });
    expect(g[`${P}cover2`].inputs).toMatchObject({ destination: [`${P}cover`, 0], source: [`${P}covdec2`, 0] });
    expect(g[`${P}covenc`].inputs.pixels).toEqual([`${P}covmask`, 2]); // painted the top's colour first
    expect(g[`${P}covnoise`].inputs.mask).toEqual([`${P}covgrow`, 0]);
    expect(g[`${P}covks`].inputs).toMatchObject({ denoise: COVER.filledDenoise, positive: [`${P}covpos`, 0], negative: [`${P}covneg`, 0], model: kept['40'].inputs.model });
    expect(String(g[`${P}covpos`].inputs.text)).toMatch(/^tiny white micro string bikini top, \(thin smooth opaque fabric lying flat/);
    expect(String(g[`${P}covneg`].inputs.text)).toMatch(/nipple/);
    expect(g[`${P}cover`].inputs).toMatchObject({ destination: before, source: [`${P}covdec`, 0], mask: [`${P}covsoft`, 0] });
    expect(g[saveId].inputs.images).toEqual([`${P}cover2`, 0]);
    // the colour step then reads the covered photo
    expect(addCopyColours(g)![`${P}colours`].inputs.image).toEqual([`${P}cover2`, 0]);
  });
  it('reads the fill colour from the garment words, and redraws more without one', () => {
    expect(coverColour('hot pink matte plain dry string bikini')).toBe('#e0287a');
    expect(coverColour('tiny white micro string bikini top')).toBe('#f2f1ee');
    expect(coverColour('navy blue bandeau')).toBe('#1d2a4d');
    expect(coverColour('string bikini top')).toBe('');
    const g = addCoverUp(addKeepScene(graph(), { width: 776 })!, { top: 'string bikini top', threshold: 0.25 })!;
    expect(g[`${P}covmask`].inputs.fill).toBe('');
    expect(g[`${P}covks`].inputs.denoise).toBe(COVER.denoise);
  });
  it('does nothing without a keep-scene redraw', () => {
    expect(addCoverUp(graph(), { top: 'bikini top', threshold: 0.25 })).toBeNull();
  });
});

describe('two-pass copy (body first, garment second)', () => {
  const two = () => addKeepScene(graph(), { width: 776, height: 1296, softSeam: true, detail: true, garment: { phrases: ['bikini top', 'bikini bottom'], controlnet: 'u.safetensors', body: true, depth: 'DepthAnythingV2Preprocessor', twoPass: true } })!;
  it('draws her first without the photo garment outline', () => {
    const g = two();
    expect(g[`${P}cnapply`]).toBeUndefined();
    // her figure and depth still guide pass A, chained from the original conditioning
    expect(g[`${P}cnbody`].inputs.positive).toEqual(graph()['40'].inputs.positive);
    expect(g['40'].inputs.positive).toEqual([`${P}cndapply`, 0]);
    expect(g['40'].inputs.negative).toEqual([`${P}cndapply`, 1]);
  });
  it('then redraws only her garment, its outline moved onto her body', () => {
    const g = two();
    expect(g[`${P}gwarp`].class_type).toBe('SiennaWarpGarment');
    expect(g[`${P}gwarp`].inputs).toMatchObject({ mask: [`${P}gonher`, 0], photo_pose: [`${P}ppose`, 1], her_pose: [`${P}hpose`, 1] });
    expect(g[`${P}ppose`].class_type).toBe('DWPreprocessor');
    expect(g[`${P}hpose`].inputs.image).toEqual(g[`${P}benc`].inputs.pixels); // her pose read on pass A's result
    expect(g[`${P}hseg1`].inputs.text_input).toBe('bikini bottom');
    expect(g[`${P}bnoise`].inputs.mask).toEqual([`${P}bmask`, 0]);
    expect(g[`${P}bks`].inputs).toMatchObject({ denoise: GARMENT_PASS.denoise, positive: [`${P}bcn`, 0], negative: [`${P}bcn`, 1] });
    expect(g[`${P}bcn`].inputs).toMatchObject({ positive: [`${P}cndapply`, 0], image: [`${P}blines`, 0], strength: GARMENT_PASS.lines });
    // the detail pass keeps off the garment where it now sits, and works on the pass-B result
    expect(g[`${P}detkeep`].inputs.mask).toEqual([`${P}bmask`, 0]);
    expect(g[`${P}detup`].inputs.image).toEqual([`${P}bfix`, 0]);
  });
  it('is one pass when not asked for', () => {
    const g = addKeepScene(graph(), { width: 776, height: 1296, garment: { phrases: ['bikini top'], controlnet: 'u.safetensors' } })!;
    expect(g[`${P}cnapply`]).toBeDefined();
    expect(g[`${P}bks`]).toBeUndefined();
  });
});

describe('source-locked copy', () => {
  const locked = () => addKeepScene(graph(), { width: 800, height: 1296, garment: { phrases: ['bikini top'], controlnet: 'u.safetensors', body: true, depth: 'DepthAnythingV2Preprocessor', sourceLock: true, twoPass: true } })!;
  it('holds every guide to the photo firmly, letting go before the colour is set', () => {
    const g = locked();
    // the normal region: a tighter one put her edge on the blend seam (a glow of the water round her)
    expect(g[`${P}grow`].inputs.expand).toBe(Math.round(800 * KEEP_SCENE_GROW));
    expect(g[`${P}cnapply`].inputs).toMatchObject({ strength: SOURCE_LOCK.garment.strength, end_percent: SOURCE_LOCK.garment.end });
    expect(g[`${P}cnbody`].inputs).toMatchObject({ strength: SOURCE_LOCK.body.strength, end_percent: SOURCE_LOCK.body.end });
    expect(g[`${P}cndapply`].inputs).toMatchObject({ strength: SOURCE_LOCK.depth.strength, end_percent: SOURCE_LOCK.depth.end });
    expect(g[`${P}bodyblur`].inputs.sigma).toBe(SOURCE_LOCK.blurSigma);
  });
  it('starts from noise, not the photo’s colours (a blonde photo gave her ginger hair)', () => {
    const g = locked();
    const sampler = Object.values(g).find((n) => n.class_type === 'KSampler' && Array.isArray(n.inputs.latent_image) && n.inputs.latent_image[0] === `${P}noise`)!;
    expect(LOCK_COLOUR_PRIOR.enabled).toBe(false);
    expect(sampler.inputs.denoise).toBe(1);
    expect(g[`${P}prior`]).toBeUndefined();
  });
  it('holds the guides longer with the stronger body hold', async () => {
    const { SOURCE_LOCK_HOLD } = await import('./keep-scene');
    const g = addKeepScene(graph(), { width: 800, height: 1296, garment: { phrases: ['bikini top'], controlnet: 'u.safetensors', body: true, depth: 'DepthAnythingV2Preprocessor', sourceLock: true, hold: true } })!;
    expect(g[`${P}cnapply`].inputs).toMatchObject({ strength: SOURCE_LOCK_HOLD.garment.strength, end_percent: SOURCE_LOCK_HOLD.garment.end });
    expect(g[`${P}cnbody`].inputs).toMatchObject({ strength: SOURCE_LOCK_HOLD.body.strength, end_percent: SOURCE_LOCK_HOLD.body.end });
    expect(g[`${P}cndapply`].inputs).toMatchObject({ strength: SOURCE_LOCK_HOLD.depth.strength, end_percent: SOURCE_LOCK_HOLD.depth.end });
  });
  it('adds no silhouette outline (it drew a glowing edge round her)', () => {
    const g = locked();
    expect(g[`${P}silimg`]).toBeUndefined();
    expect(g[`${P}bodyonly`].inputs.destination).toEqual([`${P}bodylines`, 0]);
  });
  it('keeps the detail pass at its safe strength, off the garment', () => {
    const g = addKeepScene(graph(), { width: 800, height: 1296, softSeam: true, detail: true, garment: { phrases: ['bikini top'], controlnet: 'u.safetensors', body: true, sourceLock: true } })!;
    expect(g[`${P}detks`].inputs.denoise).toBe(LOCK_DETAIL_DENOISE);
    expect(LOCK_DETAIL_DENOISE).toBe(DETAIL.denoise);
    expect(g[`${P}detkeep`].inputs.mask).toEqual([`${P}gmask`, 0]);
  });
  it('never runs the two-pass garment redraw', () => {
    expect(locked()[`${P}bks`]).toBeUndefined();
  });
});

describe('addCopyColours with the garment outline', () => {
  it('reads the photo garment colour on the garment mask only', () => {
    const kept = addKeepScene(graph(), { width: 776, height: 1296, garment: { phrases: ['bikini top'], controlnet: 'u.safetensors' } })!;
    const g = addCopyColours(kept)!;
    expect(g[`${P}colours`].inputs.photo_region).toEqual([`${P}gmask`, 0]);
  });
});

describe('addKeepScene gap fill', () => {
  it('fills where the photo’s person was but Sienna isn’t, then the overlay pass reads that', () => {
    const g = addKeepScene(graph(), { width: 776, uiMask: true, uiPaint: true, gapFill: true, gapScene: 'pool, trees' })!;
    expect(g[`${P}gap`].inputs).toMatchObject({ destination: [`${P}oldgrow`, 0], source: [`${P}newgrow`, 0], operation: 'subtract' });
    expect(g[`${P}gapfill`].inputs.image).toEqual([`${P}paste`, 0]);
    expect(g[`${P}gapfill`].inputs.avoid).toEqual([`${P}new`, 0]);
    expect(g[`${P}gapks`].inputs.positive).toEqual([`${P}gappos`, 0]);
    expect(String(g[`${P}gapneg`].inputs.text)).toContain('thumb');
    expect(g[`${P}gappos`].inputs.clip).toBeTruthy();
    expect(g[`${P}uienc`].inputs.pixels).toEqual([`${P}gapfix`, 0]);
    expect(g[`${P}uifix`].inputs.destination).toEqual([`${P}gapfix`, 0]);
  });
  it('is off unless asked', () => {
    expect(addKeepScene(graph(), { width: 776 })![`${P}gapfill`]).toBeUndefined();
  });
});

describe('addKeepScene detail pass', () => {
  it('redraws only her, lightly at 1.5x, and the rest of the graph reads the result', () => {
    const g = addKeepScene(graph(), { width: 776, height: 1296, detail: true, softSeam: true })!;
    expect(g[`${P}detup`].inputs).toMatchObject({ width: 1168, height: 1944 });
    expect(g[`${P}detks`].inputs.denoise).toBe(0.3);
    expect(g[`${P}detmask0`].inputs.mask).toEqual([`${P}new`, 0]);
    expect(g[`${P}detdown`].inputs).toMatchObject({ width: 776, height: 1296 });
    const readers = Object.entries(g).filter(([id, n]) => !id.startsWith(P) && Object.values(n.inputs).some((v) => JSON.stringify(v) === JSON.stringify([`${P}detfix`, 0])));
    expect(readers.length).toBeGreaterThan(0);
  });
});

describe('detail pass keeps off the garment', () => {
  it('subtracts the garment (grown) from the detail mask', () => {
    const g = addKeepScene(graph(), { width: 776, height: 1296, detail: true, softSeam: true, garment: { phrases: ['bikini top'], controlnet: 'u.safetensors' } })!;
    expect(g[`${P}detmaskg`].inputs).toMatchObject({ source: [`${P}detkeep`, 0], operation: 'subtract' });
    expect(g[`${P}detmask`].inputs.mask).toEqual([`${P}detmaskg`, 0]);
  });
});

describe('hand check', () => {
  it('compares the photo with the image going into SaveImage', () => {
    const g = addCopyColours(addKeepScene(graph(), { width: 776 })!)!;
    const n = handCheckNode(g)!;
    expect(n.class_type).toBe('SiennaHandCheck');
    expect(n.inputs.photo).toEqual(g[`${P}person`].inputs.image);
    expect(n.inputs.image).toEqual([`${P}colours`, 0]);
    expect(handCheckNode(graph())).toBeNull();
  });
  it('reads a lost hand as not ok, and a check that could not run as no verdict', () => {
    expect(parseHandCheck([JSON.stringify({ available: true, photo: 2, copy: 1, ok: false })])).toEqual({ ok: false, photo: 2, copy: 1 });
    expect(parseHandCheck([JSON.stringify({ available: true, photo: 2, copy: 2, ok: true })])?.ok).toBe(true);
    expect(parseHandCheck([JSON.stringify({ available: false, reason: 'hand model not found' })])).toBeUndefined();
    expect(parseHandCheck(undefined)).toBeUndefined();
  });
});

describe('source-locked cut-outs', () => {
  it('traces the garment inside as well as its outline when the photo has cut-outs', () => {
    const g = addKeepScene(graph(), { width: 800, height: 1296, garment: { phrases: ['crop top'], controlnet: 'u.safetensors', body: true, sourceLock: true, pattern: true } })!;
    expect(g[`${P}patlines`].inputs.destination).toEqual([`${P}lines`, 0]);
    expect(g[`${P}cnapply`].inputs.image).toEqual([`${P}patlines`, 0]);
    const plain = addKeepScene(graph(), { width: 800, height: 1296, garment: { phrases: ['crop top'], controlnet: 'u.safetensors', body: true, sourceLock: true } })!;
    expect(plain[`${P}patlines`]).toBeUndefined();
    expect(plain[`${P}cnapply`].inputs.image).toEqual([`${P}lines`, 0]);
  });
});

describe('face pass on an upright face', () => {
  it('turns the picture before the face pass and every reader takes the turned-back picture', () => {
    const g = addCopyColours(addKeepScene(graph(), { width: 776 })!)!;
    const refineId = Object.keys(g).find((id) => g[id].class_type === 'FaceDetailer')!;
    const input = g[refineId].inputs.image;
    const readers = Object.keys(g).filter((id) => Object.values(g[id].inputs).some((v) => Array.isArray(v) && v[0] === refineId && v[1] === 0));
    expect(readers.length).toBeGreaterThan(0);
    const u = addFaceUpright(g, refineId)!;
    expect(u.fu_up).toMatchObject({ class_type: 'SiennaFaceUpright', inputs: { image: input } });
    expect(u[refineId].inputs.image).toEqual(['fu_up', 0]);
    expect(u.fu_back).toMatchObject({ class_type: 'SiennaFaceTurnBack', inputs: { original: input, upright: ['fu_up', 0], processed: [refineId, 0], plan: ['fu_up', 1] } });
    for (const id of readers) expect(Object.values(u[id].inputs)).toContainEqual(['fu_back', 0]);
    expect(addFaceUpright(u, refineId)).toBeNull(); // never twice
    expect(addFaceUpright(g, 'nope')).toBeNull();
  });
});
