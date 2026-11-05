import { describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

describe('gpuVramGb (Photo Swap needs 32 GB or more)', () => {
  it('knows the photo GPU types', async () => {
    const { gpuVramGb } = await import('./photo-gpu');
    expect(gpuVramGb('NVIDIA GeForce RTX 4090')).toBe(24);
    expect(gpuVramGb('NVIDIA GeForce RTX 5090')).toBe(32);
    for (const t of ['NVIDIA RTX A6000', 'NVIDIA A40', 'NVIDIA L40S', 'NVIDIA L40', 'NVIDIA RTX 6000 Ada Generation']) expect(gpuVramGb(t)).toBe(48);
    expect(gpuVramGb('NVIDIA A100 80GB PCIe')).toBe(80);
    expect(gpuVramGb('one of 6 GPU types')).toBeNull();
  });
});

describe('a booting photo GPU that a swap is waiting for', () => {
  it('is kept past 3 minutes while someone still asks for it, and stopped once nobody does', async () => {
    const fs = await import('node:fs/promises');
    const os = await import('node:os');
    const path = await import('node:path');
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'pgpu-'));
    vi.stubEnv('DATA_DIR', dir);
    vi.stubEnv('PHOTO_GPU', 'runpod');
    vi.stubEnv('PHOTO_RUNPOD_API_KEY', 'test');
    vi.stubEnv('PHOTO_GPU_VOLUME_ID', 'vol');
    vi.stubEnv('PHOTO_GPU_DATACENTER', 'EU-RO-1');
    vi.resetModules();
    const terminate = vi.fn(async () => ({}));
    vi.doMock('./video-gpu', async (orig) => ({ ...(await orig<typeof import('./video-gpu')>()), runpod: terminate }));
    const gpu = await import('./photo-gpu');
    const ago = (min: number) => new Date(Date.now() - min * 60_000).toISOString();
    const session = {
      podId: 'p1', name: 'sienna-photo-x', gpu: 'NVIDIA GeForce RTX 5090', rate: 1.19, url: 'https://p1-8188.proxy.runpod.net',
      status: 'starting', createdAt: ago(5), podCreatedAt: ago(5), lastActivityAt: ago(5), phase: 'booting the GPU', pods: 1, priorUsd: 0, attempts: [],
    };
    await fs.writeFile(path.join(dir, gpu.PHOTO_GPU_STATE_FILE), JSON.stringify({ session, ledger: [] }));
    // the swap asks again (its 503 retry): the boot counts as wanted
    const s = await gpu.ensurePhotoGpu({ minVramGb: 32, replaceIdle: true });
    expect(Date.now() - Date.parse(s.lastActivityAt)).toBeLessThan(5_000);
    const kept = await gpu.tickPhotoGpu(0, async () => false);
    expect(kept?.status).toBe('starting');
    // nobody asked for 2+ minutes: stopped
    const st = JSON.parse(await fs.readFile(path.join(dir, gpu.PHOTO_GPU_STATE_FILE), 'utf8'));
    st.session.lastActivityAt = ago(3);
    await fs.writeFile(path.join(dir, gpu.PHOTO_GPU_STATE_FILE), JSON.stringify(st));
    const stopped = await gpu.tickPhotoGpu(0, async () => false);
    expect(stopped?.status).not.toBe('starting');
    vi.unstubAllEnvs();
  });
});
