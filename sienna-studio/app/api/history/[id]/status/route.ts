import { refreshStatus } from '@/lib/server/generate';
import { handle, HttpError, json } from '@/lib/server/http';
import { refreshOutfitEdit } from '@/lib/server/outfit-edit';
import { getRecord } from '@/lib/server/store';
import { refreshVideo } from '@/lib/server/video';

export const dynamic = 'force-dynamic';

/** Poll target: checks ComfyUI and, when done, downloads outputs into the gallery. */
export const GET = handle(async (_req: Request, { params }: { params: { id: string } }) => {
  const found = await getRecord(params.id);
  const rec = found?.video ? await refreshVideo(params.id) : found?.outfitEdit ? await refreshOutfitEdit(params.id) : await refreshStatus(params.id);
  if (!rec) throw new HttpError(404, 'Not found');
  return json(rec);
});
