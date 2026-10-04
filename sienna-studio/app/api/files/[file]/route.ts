import { readImage, SAFE_FILE_RE } from '@/lib/server/store';

export const dynamic = 'force-dynamic';

export async function GET(req: Request, { params }: { params: { file: string } }) {
  if (!SAFE_FILE_RE.test(params.file)) return new Response('Bad file name', { status: 400 });
  try {
    const { bytes, mime } = await readImage(params.file);
    const download = new URL(req.url).searchParams.get('download');
    const headers: Record<string, string> = {
      'Content-Type': mime,
      'Cache-Control': 'private, max-age=31536000, immutable',
      'Content-Length': String(bytes.length),
    };
    if (download) headers['Content-Disposition'] = `attachment; filename="${download.replace(/[^\w.-]/g, '_') || params.file}"`;
    return new Response(new Uint8Array(bytes), { headers });
  } catch {
    return new Response('Not found', { status: 404 });
  }
}
