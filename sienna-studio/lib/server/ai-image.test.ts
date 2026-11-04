import { describe, expect, it, vi } from 'vitest';
import sharp from 'sharp';

vi.mock('server-only', () => ({}));

describe('fitForAi', () => {
  it('shrinks a big screenshot under the API limit as a JPEG and leaves a small photo alone', async () => {
    const { fitForAi, AI_IMAGE_SIDE } = await import('./ai');
    // a noisy 2400x5200 PNG: several MB, like a phone screenshot
    const raw = (await import('node:crypto')).randomBytes(2400 * 5200 * 3);
    const big = await sharp(raw, { raw: { width: 2400, height: 5200, channels: 3 } }).png().toBuffer();
    expect(big.length).toBeGreaterThan(3_500_000);
    const out = await fitForAi(big, 'image/png');
    expect(out.mime).toBe('image/jpeg');
    const meta = await sharp(out.bytes).metadata();
    expect(Math.max(meta.width!, meta.height!)).toBe(AI_IMAGE_SIDE);
    expect(out.bytes.length * 4 / 3).toBeLessThan(10_000_000);
    const small = await sharp({ create: { width: 800, height: 1200, channels: 3, background: '#808080' } }).jpeg().toBuffer();
    expect((await fitForAi(small, 'image/jpeg')).bytes).toBe(small);
  });
});
