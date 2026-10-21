import { createBackend } from '@/lib/comfy/client';
import { handle, HttpError } from '@/lib/server/http';
import { getComfyUrl, getRecord } from '@/lib/server/store';

export const dynamic = 'force-dynamic';
type Ctx = { params: { id: string; n: string } };

/**
 * One earlier attempt of a photo (the photo checks keep only the best one), fetched from the photo GPU while it is
 * still on. 410 once the GPU has switched off and its output is gone.
 */
export const GET = handle(async (_req: Request, { params }: Ctx) => {
  const rec = await getRecord(params.id);
  const a = rec?.exposureGuard?.attempts?.[Number(params.n)];
  if (!rec || !a?.images?.[0]) throw new HttpError(404, 'No such attempt');
  try {
    const { bytes, mime } = await createBackend(rec.backend === 'mock' ? 'mock' : await getComfyUrl()).fetchImage(a.images[0]);
    return new Response(new Uint8Array(bytes), { headers: { 'content-type': mime, 'cache-control': 'private, max-age=3600' } });
  } catch {
    throw new HttpError(410, 'That attempt is no longer on the photo GPU');
  }
});
