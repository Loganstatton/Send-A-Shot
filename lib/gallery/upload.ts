import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { DATA_DIR } from '../data-dir';

// Images are written to a persistent disk directory and served through
// /api/gallery/uploads/[...path] (see that route) rather than into
// Next.js's `public/` — `public/` is baked into the build output, so
// anything written there at runtime wouldn't survive a redeploy. DATA_DIR
// already points at the same persistent disk the SQLite files use.
export const UPLOAD_DIR = path.join(DATA_DIR, 'gallery-uploads');

const MIME_EXT: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
};
const MAX_BYTES = 8 * 1024 * 1024; // 8MB

export type SavedUpload = { url: string; bytes: number };

// Accepts a `data:image/...;base64,...` URL (what a plain <input
// type="file"> + FileReader produces client-side, no extra upload library
// needed) and writes it to disk under an optional subdirectory.
export function saveBase64Image(dataUrl: string, subdir: string): SavedUpload {
  const match = /^data:(image\/(?:jpeg|png|webp));base64,(.+)$/.exec(dataUrl);
  if (!match) throw new Error('Unsupported image format. Use JPEG, PNG, or WebP.');
  const [, mime, base64] = match;
  const buffer = Buffer.from(base64, 'base64');
  if (buffer.length > MAX_BYTES) throw new Error('Image is too large (8MB max).');

  const dir = path.join(UPLOAD_DIR, subdir);
  fs.mkdirSync(dir, { recursive: true });
  const filename = `${Date.now()}-${crypto.randomBytes(6).toString('hex')}.${MIME_EXT[mime]}`;
  fs.writeFileSync(path.join(dir, filename), buffer);

  return { url: `/api/gallery/uploads/${subdir}/${filename}`, bytes: buffer.length };
}
