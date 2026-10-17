import { handle, json } from '@/lib/server/http';
import { photoGpuView, stopPhotoGpu } from '@/lib/server/photo-gpu';

export const dynamic = 'force-dynamic';

/** Stop the photo GPU now ("Stop GPU"). Photos still waiting for it fail. */
export const POST = handle(async () => {
  await stopPhotoGpu('stopped by you');
  return json(await photoGpuView());
});
