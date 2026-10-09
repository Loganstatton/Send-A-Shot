import { describe, expect, it } from 'vitest';
import {
  buildEditPrompt,
  buildOutfitEditGraph,
  defaultFootwear,
  EDIT_NODES,
  editSize,
  parseCropInfo,
  QWEN_EDIT_FILES,
  resultOutfitText,
} from './outfit-edit';
import production from '../workflows/examples/sienna-sdxl-production.json';

const ORIG = 'plain heather grey t-shirt and dark blue jeans, white sneakers';
const BIKINI =
  'a red two-piece string bikini: a triangle bikini top with thin halter straps tied behind the neck, and matching red low-rise bikini bottoms tied with strings at both hips';

describe('buildEditPrompt', () => {
  it('full swimwear edit keeps the replace-all wording validated on the GPU', () => {
    const p = buildEditPrompt({ scope: 'full', description: BIKINI, originalOutfit: ORIG, footwear: 'barefoot' });
    expect(p).toContain("Replace the woman's entire outfit in image 1 with the outfit shown in image 2.");
    expect(p).toContain(`Completely remove all of her original clothing and footwear (${ORIG}); none of it may remain.`);
    expect(p).toContain(`She now wears only ${BIKINI}, with bare legs and bare feet.`);
    expect(p).toContain('number of pieces, construction of the top and of the bottom, straps and ties, neckline, cut, leg line, fit, colour and how much skin is covered');
    expect(p).toContain('Do not add any other clothing.');
    expect(p).toContain('Ignore any shoes or sandals shown in image 2.');
    expect(p).toMatch(/body shape and proportions \(same leg length and limb thickness\), pose, expression, background, framing and lighting from image 1 unchanged\.$/);
  });

  it('keep footwear: shoes are excluded from removal and kept', () => {
    const p = buildEditPrompt({ scope: 'full', description: 'a green satin slip dress', originalOutfit: ORIG, footwear: 'keep' });
    expect(p).toContain('remove all of her original clothing (');
    expect(p).toContain('but not her footwear');
    expect(p).toContain('Keep her footwear from image 1 exactly as it is.');
    expect(p).not.toContain('bare feet');
  });

  it('footwear from the photo does not tell Qwen to ignore the photo shoes', () => {
    const p = buildEditPrompt({ scope: 'full', description: 'a linen suit', originalOutfit: ORIG, footwear: 'reference' });
    expect(p).toContain('with the footwear shown in image 2');
    expect(p).not.toContain('Ignore any shoes');
  });

  it('non-swim barefoot edit does not mention bare legs', () => {
    const p = buildEditPrompt({ scope: 'full', description: 'a long linen dress', originalOutfit: ORIG, footwear: 'barefoot' });
    expect(p).toContain('a long linen dress, and she is barefoot.');
    expect(p).not.toContain('bare legs');
  });

  it('top only keeps the lower half and names the old outfit', () => {
    const p = buildEditPrompt({ scope: 'top', description: 'a white bandeau bikini top', originalOutfit: ORIG, footwear: 'keep' });
    expect(p).toContain('Replace only the top (her upper-body garment)');
    expect(p).toContain(`In image 1 she wears ${ORIG}.`);
    expect(p).toContain('Keep her lower-body clothing from image 1 exactly as it is.');
    expect(p).toContain('Ignore every other garment shown in image 2');
  });

  it('bottom only keeps the top', () => {
    const p = buildEditPrompt({ scope: 'bottom', description: 'black high-waisted bikini bottoms', originalOutfit: '', footwear: 'barefoot' });
    expect(p).toContain('Replace only the bottom (her lower-body garment');
    expect(p).toContain('Keep her top from image 1 exactly as it is. She is barefoot.');
    expect(p).toContain('In image 1 she wears her current clothes.');
  });

  it('normalises whitespace and trailing punctuation', () => {
    const p = buildEditPrompt({ scope: 'full', description: '  a black   bikini.\n', originalOutfit: ORIG, footwear: 'barefoot' });
    expect(p).toContain('She now wears only a black bikini, with bare legs');
  });
});

describe('defaults and result text', () => {
  it('suggests barefoot only for whole-outfit swimwear', () => {
    expect(defaultFootwear('full', 'black bandeau bikini')).toBe('barefoot');
    expect(defaultFootwear('full', 'orange one-piece swimsuit')).toBe('barefoot');
    expect(defaultFootwear('top', 'bikini top')).toBe('keep');
    expect(defaultFootwear('full', 'linen trousers')).toBe('keep');
  });
  it('records what she wears after the edit', () => {
    expect(resultOutfitText('full', 'a red bikini.', ORIG)).toBe('a red bikini');
    expect(resultOutfitText('top', 'a white crop top', ORIG)).toBe(`a white crop top (top), with the rest of the earlier outfit: ${ORIG}`);
  });
});

describe('editSize', () => {
  it('keeps a ~1 MP source exactly (no Kontext stretch)', () => {
    expect(editSize(832, 1216)).toEqual({ width: 832, height: 1216 });
  });
  it('scales large sources to ~1 MP with the same aspect', () => {
    const s = editSize(1248, 1824);
    expect(s.width % 16).toBe(0);
    expect(s.height % 16).toBe(0);
    expect(Math.abs(s.width / s.height - 1248 / 1824)).toBeLessThan(0.01);
    expect(s.width * s.height).toBeLessThan(1.1e6);
  });
});

describe('buildOutfitEditGraph', () => {
  const fd = (production as any)['51'].inputs;
  const detailerInputs = Object.fromEntries(Object.entries(fd).filter(([, v]) => !Array.isArray(v)));
  const base = {
    sourceName: 'sienna/src.png',
    sourceSize: { width: 832, height: 1216 },
    referenceName: 'sienna/ref.png',
    autoCrop: true,
    prompt: 'PROMPT',
    seed: 777,
    faceRestore: {
      denoise: 0.45,
      checkpoint: 'RealVisXL_V5.0_fp16.safetensors',
      lora: { name: 'sienna_v2.safetensors', strength: 0.8, clipStrength: 1 },
      positive: 'POS',
      negative: 'NEG',
      detailerInputs,
    },
  };

  it('Qwen part matches the graph used in the GPU tests', () => {
    const g = buildOutfitEditGraph(base);
    expect(g.q_unet.inputs.unet_name).toBe(QWEN_EDIT_FILES.unet);
    expect(g.q_clip.inputs).toMatchObject({ clip_name: QWEN_EDIT_FILES.clip, type: 'qwen_image' });
    expect(g.q_shift.inputs.shift).toBe(3);
    expect(g.q_cfgnorm.inputs.strength).toBe(1);
    expect(g.q_sample.inputs).toMatchObject({ seed: 777, steps: 20, cfg: 2.5, sampler_name: 'euler', scheduler: 'simple', denoise: 1 });
    expect(g.q_pos.inputs).toMatchObject({ image1: ['src_scale', 0], image2: ['ref_crop', 0], prompt: 'PROMPT' });
    expect(g.q_neg.inputs.prompt).toBe('');
    // working size = source aspect; output = exact source size
    expect(g.src_scale.inputs).toMatchObject({ width: 832, height: 1216 });
    expect(g.q_resize.inputs).toMatchObject({ width: 832, height: 1216 });
  });

  it('face restore reuses the production FaceDetailer settings with the chosen denoise', () => {
    const g = buildOutfitEditGraph(base);
    const d = g.fr_detail.inputs;
    for (const k of ['guide_size', 'max_size', 'steps', 'cfg', 'sampler_name', 'scheduler', 'feather', 'bbox_threshold', 'bbox_dilation', 'bbox_crop_factor']) {
      expect(d[k]).toEqual(fd[k]);
    }
    expect(d.denoise).toBe(0.45);
    expect(d.image).toEqual(['q_resize', 0]);
    expect(d.model).toEqual(['fr_lora', 0]);
    expect(g.fr_lora.inputs).toMatchObject({ lora_name: 'sienna_v2.safetensors', strength_model: 0.8, strength_clip: 1 });
    expect(g[EDIT_NODES.final].inputs.images).toEqual(['fr_detail', 0]);
  });

  it('every link points at an existing node', () => {
    for (const variant of [base, { ...base, autoCrop: false, faceRestore: null }]) {
      const g = buildOutfitEditGraph(variant);
      for (const [id, n] of Object.entries(g)) {
        for (const v of Object.values(n.inputs)) {
          if (Array.isArray(v) && typeof v[0] === 'string' && typeof v[1] === 'number') expect(g[v[0]], `${id} → ${v[0]}`).toBeDefined();
        }
      }
    }
  });

  it('manual crop and face restore off: no crop nodes, final = resized Qwen output', () => {
    const g = buildOutfitEditGraph({ ...base, autoCrop: false, faceRestore: null });
    expect(g.ref_crop).toBeUndefined();
    expect(g[EDIT_NODES.crop]).toBeUndefined();
    expect(g.q_pos.inputs.image2).toEqual(['ref', 0]);
    expect(g.fr_detail).toBeUndefined();
    expect(g[EDIT_NODES.final].inputs.images).toEqual(['q_resize', 0]);
  });
});

describe('parseCropInfo', () => {
  it('reads the node output', () => {
    expect(parseCropInfo('{"mode": "cropped", "cut": 0.21}')).toEqual({ mode: 'cropped', cut: 0.21 });
    expect(parseCropInfo('{"mode": "no-face", "cut": 0.0}')?.mode).toBe('no-face');
    expect(parseCropInfo('garbage')).toBeNull();
    expect(parseCropInfo(undefined)).toBeNull();
  });
});

// ── Experimental body protection ─────────────────────────────────────────────
import { bodyCheckWarnings, expectedPieces, legsHidden, NO_PROTECT, parseBodyReport } from './outfit-edit';

describe('body protection prompt', () => {
  const base = { scope: 'full' as const, description: BIKINI, originalOutfit: ORIG, footwear: 'barefoot' as const };
  it('is unchanged with protection off (the GPU-validated wording)', () => {
    expect(buildEditPrompt({ ...base, protect: NO_PROTECT })).toBe(buildEditPrompt(base));
  });
  it('tells the editor not to copy the clothing model’s body', () => {
    const p = buildEditPrompt({ ...base, protect: { ...NO_PROTECT, garmentOnly: true } });
    expect(p).toContain('do not copy the body shape, figure, proportions, height or skin tone of the person in image 2');
    expect(p).not.toContain('Image 3');
  });
  it('with body references, names image 3 as her body', () => {
    const p = buildEditPrompt({ ...base, protect: { ...NO_PROTECT, bodyRef: true } });
    expect(p).toContain('Image 3 is only a body reference');
    expect(p).toContain('Take nothing else from image 3: the background, lighting, framing and pose come from image 1');
    expect(p).toMatch(/must stay exactly as in image 1 and image 3/);
  });
});

describe('expected pieces and hidden legs', () => {
  it('derives the pieces the isolation must find', () => {
    expect(expectedPieces('full', BIKINI)).toEqual(['upper', 'lower']);
    expect(expectedPieces('full', 'an orange one-piece swimsuit')).toEqual(['upper', 'lower']);
    expect(expectedPieces('full', 'a white linen shirt and black trousers')).toEqual(['upper', 'lower']);
    expect(expectedPieces('top', 'anything')).toEqual(['upper']);
    expect(expectedPieces('bottom', 'anything')).toEqual(['lower']);
  });
  it('knows when a skirt or dress hides the legs', () => {
    expect(legsHidden('an emerald satin midi skirt', ORIG)).toBe(true);
    expect(legsHidden(BIKINI, ORIG)).toBe(false);
  });
});

describe('graph with body protection', () => {
  const fr = (production as any)['51'].inputs;
  const base = {
    sourceName: 'sienna/src.png', sourceSize: { width: 832, height: 1216 }, referenceName: 'sienna/ref.png', autoCrop: true,
    prompt: 'P', seed: 1, faceRestore: null, bodyRefNames: ['sienna/b1.png', 'sienna/b2.png', 'sienna/b3.png'],
  };
  const linksOk = (g: Record<string, { inputs: Record<string, unknown> }>) => {
    for (const [id, n] of Object.entries(g))
      for (const v of Object.values(n.inputs))
        if (Array.isArray(v) && typeof v[0] === 'string' && typeof v[1] === 'number') expect(g[v[0]], `${id} → ${v[0]}`).toBeDefined();
  };
  it('off: identical to the validated graph (no extra nodes)', () => {
    expect(buildOutfitEditGraph({ ...base, protect: NO_PROTECT })).toEqual(buildOutfitEditGraph({ ...base, bodyRefNames: undefined }));
  });
  it('clothing only: garment isolation feeds image 2, with pose, person and face masks', () => {
    const g = buildOutfitEditGraph({ ...base, protect: { ...NO_PROTECT, garmentOnly: true }, expect: ['upper', 'lower'], dropFeet: true });
    expect(g.ref_crop.class_type).toBe('SiennaGarmentOnly');
    expect(g.ref_crop.inputs).toMatchObject({ expect: 'upper,lower', drop_feet: true, person_mask: ['ref_person', 0], face_mask: ['ref_face', 0], pose_keypoint: ['ref_pose', 1] });
    expect(g.q_pos.inputs.image2).toEqual(['ref_crop', 0]);
    expect(g.body_sheet).toBeUndefined();
    linksOk(g);
  });
  it('body references: stitched sheet is image 3 of both encoders', () => {
    const g = buildOutfitEditGraph({ ...base, protect: { ...NO_PROTECT, bodyRef: true } });
    expect(g.body_sheet.inputs).toMatchObject({ image1: ['body_ref_1', 0], image3: ['body_ref_3', 0], mask1: ['bref1_person', 0], mask3: ['bref3_person', 0] });
    expect(g.q_pos.inputs.image3).toEqual(['body_sheet', 0]);
    expect(g.q_neg.inputs.image3).toEqual(['body_sheet', 0]);
    linksOk(g);
  });
  it('body check: measures source, result and each reference; flags passed through', () => {
    const g = buildOutfitEditGraph({ ...base, faceRestore: { denoise: 0.3, checkpoint: 'c', lora: null, positive: 'p', negative: 'n', detailerInputs: Object.fromEntries(Object.entries(fr).filter(([, v]) => !Array.isArray(v))) },
      protect: { ...NO_PROTECT, bodyCheck: true }, footwearChanged: true, legsHidden: false });
    expect(g.body_check.inputs).toMatchObject({ source: ['m_src', 0], result: ['m_res', 0], ref1: ['m_bref1', 0], ref3: ['m_bref3', 0], footwear_changed: true, legs_hidden: false, result_image: ['fr_detail', 0] });
    expect(g.m_res.inputs.image).toEqual(['fr_detail', 0]);
    expect(g.q_pos.inputs.image3).toBeUndefined();          // check alone doesn't feed references to the editor
    linksOk(g);
  });
});

describe('body check report', () => {
  it('parses and phrases warnings honestly', () => {
    const r = parseBodyReport(JSON.stringify({ status: 'warn', flags: [{ part: 'thigh (right) length', change: -0.13, basis: 'source', tol: 0.06, severity: 'likely' }, { part: 'waist width', change: 0.05, basis: '3 references', tol: 0.1, severity: 'possible' }], checked: [], skipped: [], scene: { diff: 57, changed: true } }));
    const w = bodyCheckWarnings(r);
    expect(w[0]).toMatch(/replaced the whole scene/);
    expect(w[1]).toContain('likely thigh (right) length −13% (vs the original)');
    expect(w[1]).toContain('possibly waist width +5% (outside the range of her 3 references)');
    expect(bodyCheckWarnings(parseBodyReport(JSON.stringify({ status: 'insufficient', flags: [], checked: [], skipped: [{ part: 'all', why: 'x' }] })))).toEqual([]);
    expect(parseBodyReport('nope')).toBeNull();
  });
});
