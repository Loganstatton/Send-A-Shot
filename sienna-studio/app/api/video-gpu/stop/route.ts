import { handle, json } from '@/lib/server/http';
import { stopVideoGpu, videoGpuView } from '@/lib/server/video-gpu';

export const dynamic = 'force-dynamic';

/** Stop the on-demand video GPU now (the Video page's "Stop GPU" button). Queued videos that still need it fail. */
export const POST = handle(async () => {
  await stopVideoGpu('stopped by you');
  return json(await videoGpuView());
});
