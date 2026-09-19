import fs from 'fs';
import path from 'path';
import { NextResponse } from 'next/server';
import { UPLOAD_DIR } from '@/lib/gallery/upload';

const CONTENT_TYPES: Record<string, string> = {
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.webp': 'image/webp',
};

export async function GET(_req: Request, { params }: { params: { path: string[] } }) {
  const relative = path.join(...params.path);
  const resolved = path.resolve(UPLOAD_DIR, relative);

  // Reject any path that escapes UPLOAD_DIR (e.g. via `..` segments).
  if (!resolved.startsWith(path.resolve(UPLOAD_DIR) + path.sep)) {
    return NextResponse.json({ error: 'Not found.' }, { status: 404 });
  }

  let buffer: Buffer;
  try {
    buffer = fs.readFileSync(resolved);
  } catch {
    return NextResponse.json({ error: 'Not found.' }, { status: 404 });
  }

  const ext = path.extname(resolved).toLowerCase();
  return new NextResponse(new Uint8Array(buffer), {
    headers: {
      'Content-Type': CONTENT_TYPES[ext] ?? 'application/octet-stream',
      'Cache-Control': 'public, max-age=31536000, immutable',
    },
  });
}
