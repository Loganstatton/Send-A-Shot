import { describe, expect, it } from 'vitest';
import { aiCost, cleanRead, NUDE_RE, readerSystem, type ReadResult } from './ai-prompts';
import { offeredGuides, posePreset, presetFitsCamera } from './pose-presets';
import { exposureWarning, failed, pickAttempt, type ExposureAttempt } from './exposure';

const base: ReadResult = {
  outfit: 'pink string bikini', pose: '', bodyPresentation: '', expression: '', setting: '', lighting: '', camera: '', framing: '',
  realism: '', extra: '', avoid: '', posePreset: '', packs: [], understood: '', hard: [],
};

describe('AI reader guard rails', () => {
  it('never sends nudity to the AI', () => {
    for (const t of ['completely nude on her bed', 'topless at the beach', 'wearing nothing at all']) expect(NUDE_RE.test(t)).toBe(true);
    for (const t of ['tiny string bikini with thong bottoms', 'white lace bra', 'gray pajama shorts']) expect(NUDE_RE.test(t)).toBe(false);
  });
  it('keeps only known packs (max two) and pose presets', () => {
    const r = cleanRead({ ...base, packs: ['string_swimsuit', 'made_up', 'natural_skin', 'monokini', 'string_swimsuit'], posePreset: 'cartwheel' }, ['string_swimsuit', 'natural_skin', 'monokini']);
    expect(r.packs).toEqual(['string_swimsuit', 'natural_skin']);
    expect(r.posePreset).toBe('');
    expect(cleanRead({ ...base, posePreset: 'lying_on_back' }, []).posePreset).toBe('lying_on_back');
  });
  it('offers adult packs only when adult mode is allowed, and never the nude or anatomy packs', () => {
    expect(readerSystem(false)).not.toContain('string_swimsuit');
    expect(readerSystem(true)).toContain('string_swimsuit');
    expect(readerSystem(true)).not.toMatch(/realistic_nudes|real_innie/);
  });
  it('prices calls (Opus 5.5: $4 / $20 per million)', () => {
    expect(aiCost('claude-opus-5-5', { input_tokens: 1_000_000, output_tokens: 0 })).toBeCloseTo(4);
    expect(aiCost('claude-opus-5-5', { input_tokens: 0, output_tokens: 100_000 })).toBeCloseTo(2);
  });
});

describe('AI check in the photo checks', () => {
  const a = (o: Partial<ExposureAttempt>): ExposureAttempt => ({ seed: 1, exposed: false, score: 0, images: [], faceOk: true, identity: 'verified', similarity: 0.8, ...o });
  it('a miss is redone; no verdict is not a miss', () => {
    expect(failed(a({ aiOk: false }))).toBe(true);
    expect(failed(a({}))).toBe(false);
  });
  it('keeps the photo the checker liked when all were redone', () => {
    const miss = a({ seed: 1, aiOk: false, aiScore: 3, aiMajors: 2, aiCompliance: 0.3, aiIssues: ['scene: no sofa', 'outfit: top is gray, not red'] });
    const better = a({ seed: 2, aiOk: false, aiScore: 6, aiMajors: 1, aiCompliance: 0.6, aiIssues: ['outfit: top is gray, not red'] });
    expect(pickAttempt([miss, better]).seed).toBe(2);
    const w = exposureWarning([miss, better], better)!;
    expect(w).toContain("didn't match your description");
    expect(w).toContain('Still not right in the kept photo: outfit: top is gray, not red');
  });
  it('a different woman is critical: kept only below photos of her', () => {
    const wrongFace = a({ seed: 1, faceOk: false, identity: 'mismatch', similarity: 0.69, aiOk: true, aiMajors: 0, aiCompliance: 1 });
    const twoMisses = a({ seed: 3, aiOk: false, aiMajors: 2, aiCompliance: 0.7 });
    expect(pickAttempt([wrongFace, twoMisses]).seed).toBe(3);
  });
  it('the whole description beats a closer face', () => {
    const closeFace = a({ seed: 1, similarity: 0.8, aiOk: false, aiMajors: 3, aiCompliance: 0.5 });
    const followsIt = a({ seed: 2, identity: 'likely', similarity: 0.72, aiOk: false, aiMajors: 1, aiCompliance: 0.85 });
    expect(pickAttempt([closeFace, followsIt]).seed).toBe(2);
  });
});

import { buildCorrection } from './corrections';
import { nextRetry, RETRY_BUDGET } from './exposure';

describe('retry budget (first live AI test: face redos used every try)', () => {
  const a = (o: Partial<ExposureAttempt>): ExposureAttempt => ({ seed: 1, exposed: false, score: 0, images: [], faceOk: true, ...o });
  it('face misses get at most two redos, then a correction can still happen', () => {
    const seq = [a({ faceOk: false, redoneFor: 'face' }), a({ faceOk: false, redoneFor: 'face' }), a({ faceOk: false })];
    expect(nextRetry(seq, 5)).toBeNull();
    const seq2 = [a({ faceOk: false, redoneFor: 'face' }), a({ faceOk: false, redoneFor: 'face' }), a({ aiOk: false })];
    expect(nextRetry(seq2, 5)).toBe('correction');
  });
  it('corrections get at most two redos; an exposed photo is always redone while attempts remain', () => {
    expect(RETRY_BUDGET).toEqual({ face: 2, correction: 2 });
    const seq = [a({ aiOk: false, redoneFor: 'correction' }), a({ aiOk: false, redoneFor: 'correction' }), a({ aiOk: false })];
    expect(nextRetry(seq, 5)).toBeNull();
    expect(nextRetry([a({}), a({ exposed: true })], 5)).toBe('safety');
    expect(nextRetry([a({}), a({}), a({}), a({}), a({ exposed: true })], 5)).toBeNull();
  });
  it('a photo the AI could not judge is not redone and is not a pass', () => {
    const unj = a({ aiStatus: 'unavailable', aiReason: 'the AI declined to assess it' });
    expect(nextRetry([unj], 5)).toBeNull();
    expect(exposureWarning([unj], unj)).toContain('Not checked against your description: the AI declined to assess it');
  });
  it('keeps the best photo, not the last', () => {
    const good = a({ seed: 1, aiOk: false, aiScore: 7, identity: 'verified', similarity: 0.8 });
    const worse = a({ seed: 2, aiOk: false, aiScore: 3, identity: 'likely', similarity: 0.71 });
    expect(pickAttempt([good, worse]).seed).toBe(1);
  });
});

describe('targeted corrections', () => {
  const prompts = { positive: 'standing in her kitchen, white crop top', negative: 'blurry' };
  it('turns the checker feedback into weighted fixes and negatives, keeping the original prompt', () => {
    const c = buildCorrection(
      [
        { aspect: 'outfit', problem: 'lace shorts became denim', major: true, emphasize: 'white lace shorts', avoid: 'denim shorts' },
        { aspect: 'scene', problem: 'pool a bit small', major: false, emphasize: 'big pool', avoid: '' },
      ],
      prompts,
    );
    expect(c.positive).toBe('(white lace shorts:1.25)');
    expect(c.negative).toBe('denim shorts');
    expect(c.newSeed).toBe(false); // outfit fix: keep the composition that was fine
    expect(c.summary).toEqual(['outfit: white lace shorts (not denim shorts)']);
  });
  it('a pose or anatomy problem needs a new composition and the anatomy negatives', () => {
    const c = buildCorrection(
      [
        { aspect: 'pose', problem: 'one hand on the mug', major: true, emphasize: 'both hands holding the white mug', avoid: 'one hand on the bed' },
        { aspect: 'anatomy', problem: 'extra finger', major: true, emphasize: 'hands with five fingers', avoid: 'extra fingers' },
      ],
      prompts,
    );
    expect(c.newSeed).toBe(true);
    expect(c.positive).toContain('(both hands holding the white mug:1.25)');
    expect(c.negative).toContain('fused fingers');
  });
});

import { pickFixes } from './corrections';
import { CAMERA_ANGLE_RE } from './pose-presets';

describe('live controlled test fixes (21 Oct)', () => {
  const i = (aspect: string, emphasize: string, major = true) => ({ aspect, problem: aspect, major, emphasize, avoid: '' });
  it('fixes don\'t pile up: latest first, earlier ones only for other aspects, at most 3', () => {
    const earlier = [[i('outfit', 'black bike shorts'), i('camera', 'low angle looking up')]];
    const latest = [i('camera', 'low camera angle near the floor'), i('pose', 'left hand holding the glass')];
    expect(pickFixes(latest, earlier).map((x) => x.emphasize)).toEqual(['low camera angle near the floor', 'left hand holding the glass', 'black bike shorts']);
    expect(pickFixes([i('a', '1'), i('b', '2'), i('c', '3'), i('d', '4')], []).length).toBe(3);
  });
  it('a camera angle keeps the pose presets away', () => {
    expect(CAMERA_ANGLE_RE.test('taken from a low angle, looking up at her, full body')).toBe(true);
    expect(CAMERA_ANGLE_RE.test('casual iPhone photo taken by a friend')).toBe(false);
  });
});

describe('broken anatomy loses a tie', () => {
  it('two photos with the same AI score: the one with a third hand is not kept', () => {
    const base = { exposed: false, score: 0, images: [], faceOk: true, identity: 'verified' as const, aiOk: false, aiScore: 3 };
    const thirdHand = { ...base, seed: 1, similarity: 0.78, aiFixes: [{ aspect: 'anatomy', problem: 'third hand', major: true, emphasize: '', avoid: '' }] };
    const wrongShirt = { ...base, seed: 2, similarity: 0.74, aiFixes: [{ aspect: 'outfit', problem: 'tee not shirt', major: true, emphasize: '', avoid: '' }] };
    expect(pickAttempt([thirdHand, wrongShirt]).seed).toBe(2);
  });
});

describe('anatomy is a critical failure', () => {
  const base = { exposed: false, score: 0, images: [], faceOk: true, aiOk: false };
  const anatomy = [{ aspect: 'anatomy', problem: 'extra arm', major: true, emphasize: 'two arms', avoid: 'extra arm' }];
  it('a better face and score never outweigh an extra arm', () => {
    const extraArm = { ...base, seed: 1, identity: 'verified' as const, similarity: 0.82, aiScore: 8, aiIssues: ['anatomy: extra arm'], aiFixes: anatomy };
    const wrongPose = { ...base, seed: 2, identity: 'likely' as const, similarity: 0.71, aiScore: 4, aiIssues: ['pose: standing, not sitting'], aiFixes: [{ ...anatomy[0], aspect: 'pose' }] };
    expect(pickAttempt([extraArm, wrongPose]).seed).toBe(2);
  });
  it('says so when every photo had a problem, anatomy first', () => {
    const one = { ...base, seed: 1, identity: 'verified' as const, similarity: 0.8, aiStatus: 'fail' as const, aiIssues: ['pose: standing', 'anatomy: extra arm'], aiFixes: anatomy };
    const two = { ...one, seed: 2 };
    const w = exposureWarning([one, two], two)!;
    expect(w).toContain('None of the 2 photos fully matched');
    expect(w).toContain('anatomy error');
    expect(w.indexOf('anatomy: extra arm')).toBeLessThan(w.indexOf('pose: standing'));
  });
});

describe('pose guides', () => {
  it('are offered to the reader only when on', () => {
    expect(readerSystem(false)).not.toContain('sitting_edge_hands_chest');
    expect(readerSystem(false, offeredGuides(true))).toContain('sitting_edge_hands_chest');
    expect(cleanRead({ ...base, posePreset: 'standing_low_angle' }, []).posePreset).toBe('');
    expect(cleanRead({ ...base, posePreset: 'standing_low_angle' }, [], offeredGuides(true)).posePreset).toBe('standing_low_angle');
    expect(offeredGuides(false)).toEqual([]);
    // an experimental guide is not offered when only the everyday ones are
    expect(cleanRead({ ...base, posePreset: 'leaning_counter_foot_up' }, [], ['standing_low_angle']).posePreset).toBe('');
  });
  it('the low-angle skeleton only with a low angle; eye-level ones never with a camera angle', () => {
    const low = posePreset('standing_low_angle')!;
    const edge = posePreset('sitting_edge_hands_chest')!;
    expect(presetFitsCamera(low, 'photo taken from a low angle, looking up at her')).toBe(true);
    expect(presetFitsCamera(low, 'casual phone photo')).toBe(false);
    expect(presetFitsCamera(edge, 'casual phone photo')).toBe(true);
    expect(presetFitsCamera(edge, 'shot from above')).toBe(false);
  });
});

import { gradeCheck, type CheckResult } from './ai-prompts';
import { placeCorrection } from './exposure';

describe('requirement-by-requirement check', () => {
  const req = (category: CheckResult['requirements'][number]['category'], requirement: string, status: 'met' | 'minor' | 'major' | 'unsure') => ({ category, requirement, status, observed: 'x', emphasize: status === 'met' ? '' : requirement, avoid: '' });
  it('fails on any wrong or missing requirement, whatever the rest', () => {
    const g = gradeCheck({ cannot_judge: false, cannot_judge_reason: '', realism: 9, requirements: [req('clothing', 'fitted black turtleneck', 'major'), req('lighting', 'golden-hour light', 'met'), req('camera', 'low angle', 'met'), req('identity', 'looks like Sienna', 'met')] });
    expect(g.status).toBe('fail');
    expect(g.majors).toBe(1);
    expect(g.issues[0]).toMatchObject({ aspect: 'outfit', major: true });
    expect(g.compliance).toBeCloseTo(0.75);
  });
  it('passes with only small differences; unconfirmed requirements are listed, never counted as met', () => {
    const g = gradeCheck({ cannot_judge: false, cannot_judge_reason: '', realism: 8, requirements: [req('position', 'mug at her chest', 'minor'), req('background', 'white sheets', 'met'), req('lighting', 'morning light from the window', 'unsure')] });
    expect(g.status).toBe('pass');
    expect(g.compliance).toBeCloseTo(0.75);
    expect(g.unsure).toEqual(['morning light from the window']);
    expect(g.issues).toHaveLength(1);
    expect(g.issues[0].major).toBe(false);
  });
  it('maps anatomy so a broken body stays a critical failure', () => {
    const g = gradeCheck({ cannot_judge: false, cannot_judge_reason: '', realism: 8, requirements: [req('anatomy', 'correct anatomy', 'major')] });
    expect(g.issues[0].aspect).toBe('anatomy');
  });
});

describe('corrections go after the outfit', () => {
  const base = 'full body head to toe, standing, ( black fitted turtleneck:1.1), ( beige wide-leg trousers:1.1), living room, warm golden-hour light';
  const anchor = '( black fitted turtleneck:1.1), ( beige wide-leg trousers:1.1)';
  it('right after the outfit, the rest of the request in place', () => {
    const p = placeCorrection(base, '(gray sofa:1.25)', anchor);
    expect(p).toBe('full body head to toe, standing, ( black fitted turtleneck:1.1), ( beige wide-leg trousers:1.1), (gray sofa:1.25), living room, warm golden-hour light');
  });
  it('in front when the prompt has no outfit; never twice', () => {
    expect(placeCorrection('standing, beach', '(red towel:1.25)', '')).toBe('(red towel:1.25), standing, beach');
    expect(placeCorrection(base, '', anchor)).toBe(base);
  });
});

import { fidelity, keepPersonFor, regressions } from './exposure';
import { addKeepPerson, stripKeepPerson } from './comfy/keep-person';

describe('best photo: categories, importance, what a correction broke', () => {
  type C = { category: string; requirement: string; status: 'met' | 'minor' | 'major' | 'unsure'; observed: string };
  const c = (category: string, requirement: string, status: C['status']): C => ({ category, requirement, status, observed: '' });
  const base = { exposed: false, score: 0, images: [{ filename: 'x.png', subfolder: 'sienna', type: 'output', nodeId: '42' }], faceOk: true, identity: 'likely' as const, aiOk: false };
  // the living-room test (22 Oct), as the checker graded it
  const emptyRoom = { ...base, seed: 1, similarity: 0.718, aiChecklist: [
    c('identity', 'looks like Sienna', 'met'), c('clothing', 'fitted black turtleneck', 'met'), c('clothing', 'beige wide-leg trousers', 'met'), c('clothing', 'white sneakers', 'met'),
    c('background', 'living room', 'major'), c('background', 'gray sofa', 'major'), c('background', 'wooden coffee table', 'major'), c('background', 'large windows', 'minor'),
    c('camera', 'low angle', 'met'), c('camera', 'full body', 'met'), c('lighting', 'golden-hour sunlight', 'major'), c('lighting', 'long shadows', 'major'),
    c('anatomy', 'correct anatomy', 'met'), c('unwanted', 'nothing unrequested', 'met')] };
  const grayClothes = { ...base, seed: 1, similarity: 0.735, basedOn: 0, aiChecklist: [
    c('identity', 'looks like Sienna', 'met'), c('clothing', 'fitted black turtleneck', 'major'), c('clothing', 'beige trousers', 'major'), c('clothing', 'wide-leg', 'minor'), c('clothing', 'white sneakers', 'met'),
    c('background', 'living room', 'met'), c('background', 'gray sofa', 'met'), c('background', 'wooden coffee table', 'met'), c('background', 'large windows', 'met'),
    c('camera', 'low angle', 'minor'), c('camera', 'full body', 'met'), c('lighting', 'golden-hour sunlight', 'minor'), c('lighting', 'long shadows', 'major'),
    c('anatomy', 'correct anatomy', 'met'), c('unwanted', 'nothing unrequested', 'minor')] };
  const swapped = { ...base, seed: 1, similarity: 0.716, basedOn: 1, aiChecklist: [
    c('identity', 'looks like Sienna', 'met'), c('clothing', 'fitted black turtleneck', 'major'), c('clothing', 'beige wide-leg trousers', 'major'), c('clothing', 'white sneakers', 'met'),
    c('background', 'living room', 'met'), c('background', 'gray sofa', 'met'), c('background', 'wooden coffee table', 'major'), c('background', 'large windows', 'met'),
    c('camera', 'low angle', 'minor'), c('camera', 'full body', 'met'), c('lighting', 'golden-hour sunlight', 'met'), c('lighting', 'long shadows', 'met'),
    c('anatomy', 'correct anatomy', 'met'), c('unwanted', 'nothing unrequested', 'minor')] };
  it('keeps the right outfit in the empty room over the corrections that broke the outfit', () => {
    const all = [emptyRoom, grayClothes, swapped];
    expect(regressions(swapped, all)).toEqual(['clothing', 'background']); // the outfit from the first photo, the table from the second
    expect(regressions(emptyRoom, all)).toEqual([]);
    expect(pickAttempt(all)).toBe(emptyRoom);
  });
  it('an empty room is still a serious miss: a photo with the room right and nothing broken wins', () => {
    const roomFixed = { ...emptyRoom, basedOn: 0, aiChecklist: emptyRoom.aiChecklist.map((x) => (x.category === 'background' ? { ...x, status: 'met' as const } : x)) };
    expect(fidelity(roomFixed)!).toBeGreaterThan(fidelity(emptyRoom)!);
    expect(pickAttempt([emptyRoom, roomFixed])).toBe(roomFixed);
  });
  it('keeps her pixel for pixel only when nothing about her is wrong', () => {
    expect(keepPersonFor(emptyRoom)).toBe(true);
    expect(keepPersonFor(grayClothes)).toBe(false);
    expect(keepPersonFor({ ...emptyRoom, identity: 'mismatch' })).toBe(false);
    expect(keepPersonFor({ ...emptyRoom, aiChecklist: emptyRoom.aiChecklist.map((x) => (x.category === 'camera' ? { ...x, status: 'major' as const } : x)) })).toBe(false);
  });
});

describe('keep-person graph', () => {
  const g = {
    '1': { class_type: 'CheckpointLoaderSimple', inputs: { ckpt_name: 'x' } },
    '33': { class_type: 'EmptyLatentImage', inputs: { width: 832, height: 1216, batch_size: 1 } },
    '40': { class_type: 'KSampler', inputs: { model: ['1', 0], latent_image: ['33', 0], denoise: 1, seed: 5 } },
    '41': { class_type: 'VAEDecode', inputs: { samples: ['40', 0], vae: ['1', 2] } },
    '51': { class_type: 'FaceDetailer', inputs: { image: ['41', 0] } },
    '42': { class_type: 'SaveImage', inputs: { images: ['51', 0] } },
  };
  it('redraws only the background from the earlier photo and pastes her back; reversible', () => {
    const k = addKeepPerson(g, { filename: 'a_00001_.png', subfolder: 'sienna' })!;
    expect(k.kp_load.inputs.image).toBe('sienna/a_00001_.png [output]');
    expect(k['40'].inputs.latent_image).toEqual(['kp_noise', 0]);
    expect(k['40'].inputs.denoise).toBeCloseTo(0.9);
    expect(k.kp_noise.inputs.mask).toEqual(['kp_background', 0]);
    // the face touch-up is skipped: the save takes the pasted image directly
    expect(k['51']).toBeUndefined();
    expect(k['42'].inputs.images).toEqual(['kp_paste', 0]);
    expect(k.kp_paste.inputs).toMatchObject({ destination: ['41', 0], source: ['kp_load', 0], mask: ['kp_grow', 0] });
    expect(stripKeepPerson(k)).toEqual(g);
  });
  it('a correction never costs more than its reserved maximum', async () => {
    const { maxCallCost } = await import('./ai-prompts');
    const max = maxCallCost('x'.repeat(3000), [{ type: 'text', text: 'y'.repeat(600) }, { type: 'image' }], 1500);
    // 3,600 chars / 3 + 1,600 image + 50 = 2,850 tokens x 1.25 x $4/M + 1,500 x $20/M
    expect(max).toBeCloseTo((2850 * 1.25 * 4 + 1500 * 20) / 1e6, 5);
  });
  it('no plain first pass: no keep-person', () => {
    expect(addKeepPerson({ '9': { class_type: 'SaveImage', inputs: {} } }, { filename: 'a.png' })).toBeNull();
  });
});

describe('image redraw graph', () => {
  it('starts from the uploaded image, masked, without touch-ups', async () => {
    const { addImageRedraw } = await import('./comfy/keep-person');
    const g = {
      '1': { class_type: 'CheckpointLoaderSimple', inputs: { ckpt_name: 'x' } },
      '33': { class_type: 'EmptyLatentImage', inputs: { width: 832, height: 1216, batch_size: 1 } },
      '40': { class_type: 'KSampler', inputs: { model: ['1', 0], latent_image: ['33', 0], denoise: 1, seed: 5 } },
      '41': { class_type: 'VAEDecode', inputs: { samples: ['40', 0], vae: ['1', 2] } },
      '51': { class_type: 'FaceDetailer', inputs: { image: ['41', 0] } },
      '42': { class_type: 'SaveImage', inputs: { images: ['51', 0] } },
    };
    const r = addImageRedraw(g, 'sienna/init.png', 0.7, 'sienna/mask.png')!;
    expect(r['40'].inputs).toMatchObject({ latent_image: ['rd_noise', 0], denoise: 0.7 });
    expect(r.rd_mask.inputs).toMatchObject({ image: 'sienna/mask.png', channel: 'red' });
    expect(r['42'].inputs.images).toEqual(['41', 0]);
    expect(r['51']).toBeUndefined();
    expect(addImageRedraw(g, 'sienna/init.png', 0.15)!['40'].inputs.latent_image).toEqual(['rd_encode', 0]);
  });
});
