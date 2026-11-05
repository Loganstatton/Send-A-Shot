import { describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

describe('pruneUnusedUploads', () => {
  it('removes old uploads no record uses and leftover .tmp files, never one in use or a fresh one', async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'sienna-store-'));
    process.env.DATA_DIR = dir;
    const store = await import('./store');
    const img = path.join(dir, 'images');
    await fs.mkdir(img, { recursive: true });
    for (const f of ['up_used.jpg', 'up_old.jpg', 'up_fresh.jpg', 'gen_result.png']) await fs.writeFile(path.join(img, f), Buffer.alloc(1000));
    await fs.writeFile(path.join(dir, 'history.json.1.2.tmp'), 'x'.repeat(500));
    await fs.writeFile(path.join(dir, 'history.json'), JSON.stringify([{ id: 'a', images: [{ file: 'gen_result.png' }], initImage: { file: 'up_used.jpg' } }]));
    const old = new Date(Date.now() - 3 * 3600_000);
    for (const f of ['up_used.jpg', 'up_old.jpg', 'gen_result.png']) await fs.utimes(path.join(img, f), old, old);
    await fs.utimes(path.join(dir, 'history.json.1.2.tmp'), old, old);
    const freed = await store.pruneUnusedUploads();
    expect(freed).toBe(1500);
    expect((await fs.readdir(img)).sort()).toEqual(['gen_result.png', 'up_fresh.jpg', 'up_used.jpg']);
    expect(await fs.readdir(dir)).not.toContain('history.json.1.2.tmp');
  });
});

describe('cleared photo library (Photo Swap)', () => {
  it('needs her name or handle and the consent tick; removing a photo deletes its file', async () => {
    vi.resetModules();
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'sienna-cleared-'));
    process.env.DATA_DIR = dir;
    const store = await import('./store');
    const image = await store.storeImage(Buffer.from([0xff, 0xd8, 0xff, 0x00]), 'image/jpeg', 'ref', 'Cleared photo');
    expect(() => store.addClearedPhoto(image, '  ', true, true)).toThrow(/name or handle/);
    expect(() => store.addClearedPhoto(image, 'mia', false, true)).toThrow(/agreed/);
    expect(() => store.addClearedPhoto(image, 'mia', true, false)).toThrow(/18 or older/);
    const item = await store.addClearedPhoto(image, '@mia.model', true, true);
    expect(item).toMatchObject({ model: '@mia.model', consent: true, adult: true });
    expect((await store.confirmClearedAdult(item.id))?.adult).toBe(true);
    expect((await store.listClearedPhotos()).map((c) => c.id)).toEqual([item.id]);
    expect((await store.getClearedPhoto(item.id))?.image.file).toBe(image.file);
    // never pruned as an unused upload
    expect(await fs.readdir(path.join(dir, 'images'))).toContain(image.file);
    expect(await store.deleteClearedPhoto(item.id)).toBe(true);
    expect(await store.listClearedPhotos()).toEqual([]);
    expect(await fs.readdir(path.join(dir, 'images'))).not.toContain(image.file);
    expect(await store.deleteClearedPhoto(item.id)).toBe(false);
  });
});
