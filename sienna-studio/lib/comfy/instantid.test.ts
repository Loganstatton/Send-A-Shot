import { describe, expect, it } from 'vitest';
import { addInstantIdFacePass, faceReferenceImage } from './instantid';
import type { ComfyGraph } from '../types';

const graph: ComfyGraph = {
  '2': { class_type: 'LoraLoader', inputs: {} },
  '10': { class_type: 'LoadImage', inputs: { image: 'ref.jpg' } },
  '11': { class_type: 'IPAdapterUnifiedLoader', inputs: { model: ['2', 0] } },
  '12': { class_type: 'IPAdapterAdvanced', inputs: { model: ['11', 0], ipadapter: ['11', 1], image: ['10', 0], weight: 0.35 } },
  '51': { class_type: 'FaceDetailer', inputs: { image: ['41', 0], model: ['12', 0], positive: ['3', 0], negative: ['4', 0], denoise: 0.4 } },
};

describe('InstantID on the face pass', () => {
  it('reads her face reference from the face pass IP-Adapter and puts InstantID between it and the face pass', () => {
    expect(faceReferenceImage(graph, '51')).toEqual(['10', 0]);
    const g = addInstantIdFacePass(graph, '51', { weight: 0.9 })!;
    expect(g.iid_apply).toMatchObject({ class_type: 'ApplyInstantIDAdvanced', inputs: { image: ['10', 0], model: ['12', 0], positive: ['3', 0], negative: ['4', 0], ip_weight: 0.9, cn_strength: 0 } });
    expect(g['51'].inputs).toMatchObject({ model: ['iid_apply', 0], positive: ['iid_apply', 1], negative: ['iid_apply', 2], denoise: 0.4 });
    expect(addInstantIdFacePass(g, '51')).toBeNull(); // never twice
    expect(graph['51'].inputs.model).toEqual(['12', 0]); // input untouched
  });
  it('does nothing without a face reference', () => {
    const plain: ComfyGraph = { ...graph, '51': { ...graph['51'], inputs: { ...graph['51'].inputs, model: ['2', 0] } } };
    expect(addInstantIdFacePass(plain, '51')).toBeNull();
  });
});
