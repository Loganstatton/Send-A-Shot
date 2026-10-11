import 'server-only';
import fs from 'fs/promises';
import path from 'path';
import { storeImage } from './store';
import type { StoredImage } from '../types';

const cache = new Map<string, StoredImage>();

/** The preset's skeleton as a stored image (stored once per server start). */
export async function presetImage(id: string): Promise<StoredImage> {
  const hit = cache.get(id);
  if (hit) return hit;
  const candidates = [path.join(process.cwd(), 'public', 'pose-presets', `${id}.png`), path.join(process.cwd(), '..', 'public', 'pose-presets', `${id}.png`)];
  for (const file of candidates) {
    const bytes = await fs.readFile(file).catch(() => null);
    if (bytes) {
      const img = await storeImage(bytes, 'image/png', 'up', `Pose preset: ${id}`);
      cache.set(id, img);
      return img;
    }
  }
  throw new Error(`Pose preset ${id} is missing from public/pose-presets.`);
}
