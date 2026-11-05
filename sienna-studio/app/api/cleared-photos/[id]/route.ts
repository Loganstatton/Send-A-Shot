import { handle, HttpError, json } from '@/lib/server/http';
import { confirmClearedAdult, deleteClearedPhoto } from '@/lib/server/store';

export const dynamic = 'force-dynamic';

type Ctx = { params: { id: string } };

export const DELETE = handle(async (_req: Request, { params }: Ctx) => {
  if (!(await deleteClearedPhoto(params.id))) throw new HttpError(404, 'That photo is not in the library.');
  return json({ ok: true });
});

/** { adult: true }: the owner confirms the model in an earlier entry is 18 or older. */
export const PATCH = handle(async (req: Request, { params }: Ctx) => {
  const body = await req.json().catch(() => null);
  if (body?.adult !== true) throw new HttpError(400, 'Send { "adult": true } to confirm she is 18 or older.');
  const item = await confirmClearedAdult(params.id);
  if (!item) throw new HttpError(404, 'That photo is not in the library.');
  return json(item);
});
