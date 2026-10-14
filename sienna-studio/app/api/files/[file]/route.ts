import { createReadStream, promises as fs } from 'node:fs';
import { Readable } from 'node:stream';
import { storedFilePath } from '@/lib/server/store';

export const dynamic = 'force-dynamic';

const MIME: Record<string, string> = { png: 'image/png', jpg: 'image/jpeg', webp: 'image/webp', mp4: 'video/mp4' };

/**
 * Stored images and videos. Supports byte ranges (HTTP 206): iPhone Safari only plays <video> from servers that
 * answer Range requests, and it lets long videos start before the whole file has downloaded.
 */
export async function GET(req: Request, { params }: { params: { file: string } }) {
  const full = storedFilePath(params.file);
  if (!full) return new Response('Bad file name', { status: 400 });
  const stat = await fs.stat(full).catch(() => null);
  if (!stat?.isFile()) return new Response('Not found', { status: 404 });
  const ext = params.file.split('.').pop()!.toLowerCase();
  const headers: Record<string, string> = {
    'Content-Type': MIME[ext] ?? 'application/octet-stream',
    'Cache-Control': 'private, max-age=31536000, immutable',
    'Accept-Ranges': 'bytes',
  };
  const download = new URL(req.url).searchParams.get('download');
  if (download) headers['Content-Disposition'] = `attachment; filename="${download.replace(/[^\w.-]/g, '_') || params.file}"`;

  const range = /^bytes=(\d*)-(\d*)$/.exec(req.headers.get('range') ?? '');
  if (range && (range[1] || range[2])) {
    let start = range[1] ? Number(range[1]) : Math.max(0, stat.size - Number(range[2]));
    let end = range[1] && range[2] ? Number(range[2]) : stat.size - 1;
    end = Math.min(end, stat.size - 1);
    if (start > end || start >= stat.size) {
      return new Response(null, { status: 416, headers: { ...headers, 'Content-Range': `bytes */${stat.size}` } });
    }
    start = Math.max(0, start);
    const body = Readable.toWeb(createReadStream(full, { start, end })) as ReadableStream;
    return new Response(body, { status: 206, headers: { ...headers, 'Content-Range': `bytes ${start}-${end}/${stat.size}`, 'Content-Length': String(end - start + 1) } });
  }
  const body = Readable.toWeb(createReadStream(full)) as ReadableStream;
  return new Response(body, { headers: { ...headers, 'Content-Length': String(stat.size) } });
}
