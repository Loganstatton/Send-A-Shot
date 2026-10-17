import { KIT_FILES, KitFile, kitFile } from '@/lib/server/video-gpu-kit';
import { kitTokenValid } from '@/lib/server/video-gpu';

export const dynamic = 'force-dynamic';

/**
 * Setup kit for the temporary video GPU. Not behind the login (the pod can't log in): it answers only to the one-time
 * token of the video GPU being started, and the kit holds no secrets.
 */
export async function GET(_req: Request, { params }: { params: { token: string; file: string } }) {
  if (!KIT_FILES.includes(params.file as KitFile)) return new Response('Not found', { status: 404 });
  if (!(await kitTokenValid(params.token))) return new Response('Not found', { status: 404 });
  const f = await kitFile(params.file as KitFile);
  return new Response(new Uint8Array(f.body), { headers: { 'Content-Type': f.type, 'Cache-Control': 'no-store' } });
}
