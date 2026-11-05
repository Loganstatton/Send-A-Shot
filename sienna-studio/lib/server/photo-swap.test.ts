import { describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));
const ensure = vi.fn();
vi.mock('./photo-gpu', () => ({ ensurePhotoGpu: ensure, photoGpuEnabled: () => true, photoGpuReady: async () => false, touchPhotoGpu: async () => {} }));
vi.mock('./store', async (orig) => ({
  ...(await orig<typeof import('./store')>()),
  getClearedPhoto: async (id: string) =>
    id === 'c1' ? { id: 'c1', model: '@mia', consent: true, adult: true, consentedAt: '', image: { id: 'i', file: 'ref_x.jpg', createdAt: '' } }
    : id === 'c0' ? { id: 'c0', model: '@old', consent: true, consentedAt: '', image: { id: 'i', file: 'ref_y.jpg', createdAt: '' } }
    : null,
  listHistory: async () => [],
}));

describe('Photo Swap', () => {
  it('swaps only photos in the cleared library, before asking for a GPU', async () => {
    const { startPhotoSwap } = await import('./photo-swap');
    await expect(startPhotoSwap({ clearedId: 'not-cleared', seed: 1 })).rejects.toMatchObject({ status: 404 });
    // an entry without the 18+ confirmation is never swapped
    await expect(startPhotoSwap({ clearedId: 'c0', seed: 1 })).rejects.toMatchObject({ status: 403 });
    expect(ensure).not.toHaveBeenCalled();
  });
  it('asks for a 32 GB GPU and waits while it starts', async () => {
    ensure.mockResolvedValueOnce({ status: 'starting', gpu: 'NVIDIA RTX A6000' });
    const { startPhotoSwap } = await import('./photo-swap');
    const store = await import('./store');
    vi.spyOn(store, 'getCharacter').mockResolvedValue({ age: 24, faceReference: { id: 'f', file: 'ref_f.jpg', createdAt: '' } } as any);
    await expect(startPhotoSwap({ clearedId: 'c1', seed: 1 })).rejects.toMatchObject({ status: 503 });
    expect(ensure).toHaveBeenCalledWith({ minVramGb: 32, replaceIdle: true });
  });
  it('asks for her face from the reference only, and keeps everything else', async () => {
    const { SWAP_PROMPT, SWAP_NEGATIVE } = await import('./photo-swap');
    expect(SWAP_PROMPT).toMatch(/nothing of the face in Picture 1/);
    expect(SWAP_PROMPT).toMatch(/her clothing exactly as it is/);
    expect(SWAP_PROMPT).not.toMatch(/strings|straps|bikini/);
    expect(SWAP_NEGATIVE).toMatch(/sunglasses/);
    expect(SWAP_PROMPT).toMatch(/her long dark-brown hair colour/);
    expect(SWAP_PROMPT).toMatch(/hair falls behind her shoulders/);
    expect(SWAP_PROMPT).toMatch(/where her arms and hands are/);
  });
  it('puts the photo texture back with a fine grain', async () => {
    const { TEXTURE_CLASS, SWAP_GRAIN } = await import('./photo-swap');
    expect(TEXTURE_CLASS).toBe('SiennaPhotoTexture');
    expect(SWAP_GRAIN).toBeGreaterThan(0);
    expect(SWAP_GRAIN).toBeLessThan(0.02);
  });
});
