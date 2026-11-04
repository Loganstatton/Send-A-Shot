import { describe, expect, it } from 'vitest';
import sharp from 'sharp';
import { appBarRows, trimAppBars } from './app-bars';

const picture = (w: number, h: number, paint: (x: number, y: number) => number) => {
  const a = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) a[y * w + x] = paint(x, y);
  return a;
};

describe('appBarRows', () => {
  it('finds a dark comment bar at the bottom, its box and writing included', () => {
    const l = picture(100, 200, (x, y) => (y >= 180 ? (y > 186 && y < 192 && x > 10 && x < 30 ? 230 : 15) : 140));
    expect(appBarRows(l, 100, 200)).toEqual({ top: 0, bottom: 20 });
  });
  it('leaves a dark night photo alone (no hard edge) and a photo without bars', () => {
    expect(appBarRows(picture(100, 200, (_x, y) => (y >= 180 ? 15 : 30)), 100, 200)).toEqual({ top: 0, bottom: 0 });
    expect(appBarRows(picture(100, 200, () => 140), 100, 200)).toEqual({ top: 0, bottom: 0 });
  });
  it('never cuts a dark half of the picture', () => {
    expect(appBarRows(picture(100, 200, (_x, y) => (y >= 100 ? 10 : 160)), 100, 200).bottom).toBe(0);
  });
});

describe('trimAppBars', () => {
  it('returns the photo cut above the bar', async () => {
    const w = 60, h = 120;
    const raw = Buffer.alloc(w * h * 3);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) raw.fill(y >= 108 ? 12 : 150, (y * w + x) * 3, (y * w + x) * 3 + 3);
    const png = await sharp(raw, { raw: { width: w, height: h, channels: 3 } }).png().toBuffer();
    const r = (await trimAppBars(png))!;
    expect(r.cut).toEqual({ top: 0, bottom: 12 });
    expect((await sharp(r.bytes).metadata()).height).toBe(108);
    expect(await trimAppBars(await sharp({ create: { width: 40, height: 40, channels: 3, background: '#888' } }).png().toBuffer())).toBeNull();
  });
});
