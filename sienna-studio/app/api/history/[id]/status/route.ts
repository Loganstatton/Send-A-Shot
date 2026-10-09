import { refreshStatus } from '@/lib/server/generate';
import { handle, HttpError, json } from '@/lib/server/http';
import { refreshOutfitEdit } from '@/lib/server/outfit-edit';
import { getRecord } from '@/lib/server/store';

export const dynamic = 'force-dynamic';

/** Poll target: checks ComfyUI and, when done, downloads outputs into the gallery. */
export const GET = handle(async (_req: Request, { params }: { params: { id: string } }) => {
  const rec = (await getRecord(params.id))?.outfitEdit ? await refreshOutfitEdit(params.id) : await refreshStatus(params.id);
  if (!rec) throw new HttpError(404, 'Not found');
  return json(rec);
});
