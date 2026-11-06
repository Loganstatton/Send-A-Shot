import { describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));
const ended = '2026-11-06T00:50:00.000Z';
vi.mock('./photo-gpu', async (orig) => ({
  ...(await orig<typeof import('./photo-gpu')>()),
  photoGpuEnabled: () => true,
  tickPhotoGpu: async () => ({ status: 'failed', endedAt: ended, error: 'the photo GPU no longer exists on RunPod' }),
  ensurePhotoGpu: async () => ({ status: 'starting' }),
}));
const patched: Record<string, any> = {};
const recs = [
  { id: 'gOld', status: 'running', promptId: 'p1', promptAt: '2026-11-06T00:45:00.000Z', createdAt: '2026-11-06T00:44:00.000Z', swap: { clearedId: 'c' }, outfitEdit: {} },
  { id: 'gNew', status: 'running', promptId: 'p2', promptAt: '2026-11-06T09:00:00.000Z', createdAt: '2026-11-06T09:00:00.000Z' },
  { id: 'gDone', status: 'done', promptId: 'p3', promptAt: '2026-11-06T00:40:00.000Z', createdAt: '2026-11-06T00:40:00.000Z' },
];
vi.mock('./store', async (orig) => ({
  ...(await orig<typeof import('./store')>()),
  listHistory: async () => recs,
  getRecord: async (id: string) => recs.find((r) => r.id === id) ?? null,
  patchRecord: async (id: string, p: any) => ((patched[id] = p), { ...recs.find((r) => r.id === id), ...p }),
}));
vi.mock('./outfit-edit', async (orig) => ({ ...(await orig<typeof import('./outfit-edit')>()), refreshOutfitEdit: async () => { throw new Error('connection refused'); } }));

describe('photo GPU housekeeping', () => {
  it('fails photos that were on a GPU that has since gone, not later ones or finished ones', async () => {
    const { photoGpuHousekeeping } = await import('./generate');
    await photoGpuHousekeeping();
    expect(patched.gOld?.status).toBe('error');
    expect(patched.gOld?.error).toMatch(/no longer exists on RunPod/);
    expect(patched.gNew?.error ?? '').not.toMatch(/stopped before this finished/);
    expect(patched.gDone).toBeUndefined();
  });
});
