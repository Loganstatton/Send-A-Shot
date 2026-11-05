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
