import { describe, expect, it } from 'vitest';
import { BODY_FRAME_NODE_ID, bodyFrameNodes, bodyFramingOk, hingeCheck, parseBodyFrame } from './body-frame';
import { matchPosePreset, presetOutfitPrompt, presetThongPack } from './pose-presets';

const joints = (present: number[]) => Array.from({ length: 14 }, (_, i) => (present.includes(i) ? [100 + i, 200 + i] : null));
const report = (present: number[], valid = true) => [JSON.stringify({ valid, joints: joints(present) })];

describe('full-body framing from her joints', () => {
  it('needs her head and an ankle in the picture', () => {
    expect(bodyFramingOk(true, parseBodyFrame(report([0, 1, 2, 5, 8, 9, 10, 11, 12, 13])))).toBe(true);
    expect(bodyFramingOk(true, parseBodyFrame(report([0, 1, 2, 5, 8, 11, 13])))).toBe(true); // one ankle hidden
    // cut off at the thighs (the position-test failures)
    expect(bodyFramingOk(true, parseBodyFrame(report([0, 1, 2, 5, 8, 11])))).toBe(false);
    expect(bodyFramingOk(true, parseBodyFrame(report([1, 2, 5, 8, 9, 10, 11, 12, 13])))).toBe(true); // face turned away: neck counts
    // cut off at the chin: the neck (shoulder midpoint) sits at the top edge with no room for a head
    const chin = joints([1, 2, 5, 8, 10, 11, 13]);
    chin[1] = [300, 12]; chin[8] = [280, 400]; chin[11] = [320, 400];
    expect(bodyFramingOk(true, parseBodyFrame([JSON.stringify({ valid: true, joints: chin })])) ).toBe(false);
  });
  it('gives no verdict when the body could not be judged, or framing was not full body', () => {
    expect(bodyFramingOk(true, parseBodyFrame(report([], false)))).toBeUndefined();
    expect(bodyFramingOk(true, parseBodyFrame(['not json']))).toBeUndefined();
    expect(bodyFramingOk(true, parseBodyFrame(undefined))).toBeUndefined();
    expect(bodyFramingOk(false, parseBodyFrame(report([0, 1])))).toBeUndefined();
  });
  it('measures the image that gets saved and publishes the result', () => {
    const g = { '9': { class_type: 'SaveImage', inputs: { images: ['8', 0] } } };
    const n = bodyFrameNodes(g, '9')!;
    expect(n.sienna_body_pose.inputs.image).toEqual(['8', 0]);
    expect(n.sienna_body_measure.inputs.pose_keypoint).toEqual(['sienna_body_pose', 1]);
    expect(n[BODY_FRAME_NODE_ID].class_type).toBe('SiennaTextOutput');
    expect(bodyFrameNodes({}, '9')).toBeNull();
  });
});

describe('pose preset from the Pose text', () => {
  const id = (t: string, full = false) => matchPosePreset(t, full)?.id;
  it('picks the position the text describes', () => {
    expect(id('lying on her back on the bed, legs together')).toBe('lying_on_back');
    expect(id('lying on her side, propped up on one elbow')).toBe('lying_on_side');
    expect(id('lying on her stomach, feet up')).toBe('lying_on_stomach');
    expect(id('kneeling upright on the bed, knees together')).toBe('kneeling_upright');
    expect(id('sitting cross-legged on the floor')).toBe('sitting_crosslegged');
    expect(id('standing with her arms crossed')).toBe('arms_crossed');
    expect(id('mirror selfie in the bathroom')).toBe('mirror_selfie');
    expect(id('standing beside the bed, arms relaxed', true)).toBe('standing_full_body');
    // live: the preset's arms-down skeleton overrode the hand-on-hip pose that was asked for
    expect(id('standing by the pool, one hand resting on her hip and the other brushing her hair back', true)).toBeUndefined();
    expect(id('standing naturally with one leg slightly forward', true)).toBeUndefined();
  });
  it('leaves other poses alone', () => {
    expect(id('standing beside the bed, arms relaxed', false)).toBeUndefined(); // not a full-body request
    expect(id('walking along the beach, standing tall', true)).toBeUndefined();
    expect(id('kneeling on all fours')).toBeUndefined();
    expect(id('sitting on the edge of the bed')).toBeUndefined();
    expect(id('')).toBeUndefined();
    expect(id('looking back over her shoulder')).toBeUndefined();
  });
});

describe('bent-over hinge check', () => {
  const frame = (pts: Record<number, [number, number]>) =>
    parseBodyFrame([JSON.stringify({ valid: true, joints: Array.from({ length: 14 }, (_, i) => pts[i] ?? null) })]);
  // the bent_over_rear preset's own skeleton (scripts/make_pose_presets.py, after its 1.3x scaling)
  const t = (x: number, y: number): [number, number] => [Math.round((x - 380) * 1.3 + 416), Math.round((y - 528) * 1.3 + 330)];
  const bent = { 0: t(200, 800), 1: t(262, 680), 2: t(322, 712), 5: t(232, 626), 3: t(318, 858), 4: t(322, 1000), 6: t(214, 772), 7: t(210, 916),
    8: t(548, 556), 11: t(470, 528), 9: t(522, 812), 12: t(440, 800), 10: t(540, 1092), 13: t(458, 1084) };

  it('passes the preset skeleton and a shallower hinge', () => {
    expect(hingeCheck(frame(bent))).toEqual({ ok: true });
    // torso level with the hips (a 90° bend)
    expect(hingeCheck(frame({ ...bent, 1: [300, 330] }))?.ok).toBe(true);
  });
  it('fails standing upright', () => {
    const r = hingeCheck(frame({ 1: [416, 265], 8: [370, 640], 11: [462, 640], 9: [366, 880], 12: [466, 880], 10: [370, 1105], 13: [462, 1105] }))!;
    expect(r).toEqual({ ok: false, reason: 'her torso is upright, not bent at the waist' });
  });
  it('fails a squat (thighs folded toward horizontal), even leaning forward', () => {
    // a deep forward lean in a squat: torso level with the hips, so only the thighs give it away
    const r = hingeCheck(frame({ 1: [250, 720], 8: [450, 700], 11: [470, 700], 9: [300, 720], 12: [320, 725], 10: [330, 950], 13: [350, 955] }))!;
    expect(r).toEqual({ ok: false, reason: 'her thighs fold forward like a squat or a kneel' });
    // a more upright squat fails on the torso already
    expect(hingeCheck(frame({ 1: [300, 600], 8: [450, 700], 11: [470, 700], 9: [300, 720], 12: [320, 725], 10: [330, 950], 13: [350, 955] }))!.ok).toBe(false);
  });
  it('fails kneeling bent forward (shins flat on the floor)', () => {
    const r = hingeCheck(frame({ 1: [250, 700], 8: [450, 650], 11: [460, 650], 9: [455, 950], 12: [465, 955], 10: [700, 980], 13: [710, 985] }))!;
    expect(r).toEqual({ ok: false, reason: 'her shins lie flat, as in a kneel' });
  });
  it('gives no verdict without the joints it needs', () => {
    expect(hingeCheck(frame({ 1: [300, 300] }))).toBeUndefined();
    expect(hingeCheck(parseBodyFrame([JSON.stringify({ valid: false })]))).toBeUndefined();
    expect(hingeCheck(null)).toBeUndefined();
  });
});

describe('bent-over preset from the Pose text', () => {
  const id = (t: string, full = false) => matchPosePreset(t, full)?.id;
  it('picks it for a waist bend seen from behind', () => {
    expect(id('seen from behind, bending over at the waist')).toBe('bent_over_rear');
    expect(id('rear view, bent over picking up a shell')).toBe('bent_over_rear');
    expect(id('her back to the camera, bending forward at the hips', true)).toBe('bent_over_rear');
    expect(id('from behind, hip hinge, hands on her knees')).toBe('bent_over_rear');
    expect(id('facing away from the camera, leaning forward over the railing')).toBe('bent_over_rear');
  });
  it('leaves other bends and rear poses alone', () => {
    expect(id('bending over toward the camera, smiling')).toBeUndefined(); // front-facing
    expect(id('standing from behind, knees slightly bent', true)).not.toBe('bent_over_rear'); // knees, not the waist
    expect(id('seen from behind, walking along the beach')).toBeUndefined();
    expect(id('looking back over her shoulder')).toBeUndefined();
    expect(id('kneeling upright on the bed, knees together')).toBe('kneeling_upright');
    expect(id('lying on her back on the bed')).toBe('lying_on_back');
  });
});

describe('garment wording for the bent-over preset', () => {
  it('spells out a thong and pushes away fuller bottoms', () => {
    const p = presetOutfitPrompt('bent_over_rear', 'sage green string thong bikini')!;
    expect(p.positive.startsWith('(wearing sage green string thong bikini:1.3)')).toBe(true);
    expect(p.positive).toContain('thin string back');
    expect(p.negative).toContain('(full coverage bottoms:1.4), (briefs:1.3)');
  });
  it('keeps a dress a dress, with a hanging skirt', () => {
    const p = presetOutfitPrompt('bent_over_rear', 'light floral sundress')!;
    expect(p.positive).toContain('skirt hangs down from her hips with gravity');
    expect(p.negative).toContain('(swimsuit:1.4), (bikini:1.4), (bodysuit:1.4)');
  });
  it('closes the shorts and keeps her barefoot unless shoes are asked for', () => {
    const p = presetOutfitPrompt('bent_over_rear', 'denim shorts and a white tank top')!;
    expect(p.positive).toContain('shorts fully covering her buttocks');
    expect(p.negative).toContain('(cut-out shorts:1.3)');
    expect(p.positive).toContain('barefoot');
    expect(p.negative).toContain('(sandals:1.3)');
    const shoes = presetOutfitPrompt('bent_over_rear', 'sundress and white sneakers')!;
    expect(shoes.positive).not.toContain('barefoot');
    expect(shoes.negative).not.toContain('sandals');
  });
  it('rules out extra people for every outfit, and leaves other presets alone', () => {
    expect(presetOutfitPrompt('bent_over_rear', 'red bikini')!.negative).toContain('(second person:1.3)');
    expect(presetOutfitPrompt('standing_full_body', 'red bikini')).toBeNull();
    expect(presetOutfitPrompt(null, 'red bikini')).toBeNull();
    expect(presetOutfitPrompt('bent_over_rear', '')).toBeNull();
  });
});

describe('bent-over thong add-on, coverage and scene', () => {
  it('asks for the String swimsuit add-on only for a clothed string thong in this preset', () => {
    expect(presetThongPack('bent_over_rear', 'sage green string thong bikini')).toBe(true);
    expect(presetThongPack('bent_over_rear', 'black g-string bikini')).toBe(true);
    expect(presetThongPack('bent_over_rear', 'light floral sundress')).toBe(false);
    expect(presetThongPack('bent_over_rear', 'nude, thong tan lines')).toBe(false);
    expect(presetThongPack('standing_full_body', 'string thong bikini')).toBe(false);
  });
  it('keeps a clothed outfit covered, but not a nude request', () => {
    expect(presetOutfitPrompt('bent_over_rear', 'string thong bikini')!.negative).toContain('(exposed genitals:1.5)');
    expect(presetOutfitPrompt('bent_over_rear', 'nude')!.negative).not.toContain('exposed genitals');
  });
  it('repeats the setting with a sharp, deep-focus background', () => {
    const p = presetOutfitPrompt('bent_over_rear', 'string thong bikini', "sunny beach with wet sand at the water's edge")!;
    expect(p.positive).toContain("(sunny beach with wet sand at the water's edge:1.2)");
    expect(p.positive).toContain('deep depth of field');
    expect(p.negative).toContain('(blurry background:1.3), (bokeh:1.3)');
    expect(presetOutfitPrompt('bent_over_rear', 'string thong bikini')!.positive).not.toContain('depth of field');
  });
});
