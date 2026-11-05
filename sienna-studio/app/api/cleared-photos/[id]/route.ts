import { handle, HttpError, json } from '@/lib/server/http';
import { deleteClearedPhoto } from '@/lib/server/store';

export const dynamic = 'force-dynamic';

type Ctx = { params: { id: string } };

export const DELETE = handle(async (_req: Request, { params }: Ctx) => {
  if (!(await deleteClearedPhoto(params.id))) throw new HttpError(404, 'That photo is not in the library.');
  return json({ ok: true });
});
