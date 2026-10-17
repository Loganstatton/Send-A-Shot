import { handle, HttpError, json } from '@/lib/server/http';
import { ensurePhotoGpu, photoGpuView } from '@/lib/server/photo-gpu';

export const dynamic = 'force-dynamic';

/** Start the photo GPU ahead of time ("Start GPU"), so the first photo doesn't wait. */
export const POST = handle(async () => {
  try {
    await ensurePhotoGpu();
  } catch (e: any) {
    throw new HttpError(e?.status === 402 ? 402 : 503, e.message);
  }
  return json(await photoGpuView());
});
