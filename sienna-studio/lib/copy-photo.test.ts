import { describe, expect, it } from 'vitest';
import { buildCopyGateGraph, cleanCaption, COPY_CAPTION_NODE, COPY_EXPOSURE_NODE, copyGarmentPhrases, copyPhotoEnabled, copyRequestText, copyUserText } from './copy-photo';

describe('copyUserText', () => {
  it('drops the copy instruction itself', () => {
    expect(copyUserText('Copy this photo')).toBe('');
    expect(copyUserText('copy this picture exactly as Sienna')).toBe('');
    expect(copyUserText('Sienna')).toBe('');
    expect(copyUserText('Recreate this pic')).toBe('');
    expect(copyUserText('make it exactly the same')).toBe('');
  });
  it('keeps the changes asked for', () => {
    expect(copyUserText('Copy this photo but in a red bikini')).toBe('in a red bikini');
    expect(copyUserText('Copy this photo exactly, with her hair in a ponytail')).toBe('her hair in a ponytail');
    expect(copyUserText('same as the photo, at sunset')).toBe('at sunset');
    expect(copyUserText('red bikini instead')).toBe('red bikini instead');
  });
});

describe('copyRequestText', () => {
  it('puts the owner’s changes first', () => {
    expect(copyRequestText(' purple string bikini,  hot tub ', '')).toBe('purple string bikini, hot tub');
    expect(copyRequestText('purple string bikini, hot tub', 'in a red bikini')).toBe('in a red bikini. Everything else as in this photo: purple string bikini, hot tub');
  });
});

describe('cleanCaption', () => {
  it('drops openers, tokens and hair colour', () => {
    expect(cleanCaption('</s><s>The image shows a blonde woman sitting in a hot tub.<pad>')).toBe('a woman sitting in a hot tub.');
    expect(cleanCaption('A woman in a hot tub. On the right side of the image, there is a menu bar with options such as "Made with Edits". The sky is blue.')).toBe('A woman in a hot tub. The sky is blue.');
  });
});

describe('buildCopyGateGraph', () => {
  it('checks nudity and captions the uploaded photo', () => {
    const g = buildCopyGateGraph('ref.png');
    expect(g['1'].inputs.image).toBe('ref.png');
    expect(g[COPY_EXPOSURE_NODE].class_type).toBe('SiennaExposureCheck');
    expect(g[COPY_EXPOSURE_NODE].inputs.images).toEqual(['1', 0]);
    expect(g[COPY_CAPTION_NODE].inputs.text).toEqual(['21', 2]);
  });
  it('is on unless switched off', () => {
    expect(copyPhotoEnabled(undefined)).toBe(true);
    expect(copyPhotoEnabled('off')).toBe(false);
  });
});

describe('copyGarmentPhrases', () => {
  it('names the pieces to cut out', () => {
    expect(copyGarmentPhrases('tiny purple string triangle bikini top, thin halter strings')).toEqual(['bikini top']);
    expect(copyGarmentPhrases('white tank top and denim shorts')).toEqual(['top', 'shorts']);
    expect(copyGarmentPhrases('red slip dress')).toEqual(['dress']);
    expect(copyGarmentPhrases('sunglasses, small stud earring')).toEqual([]);
  });
});
