import { recordPatchSchema } from '@/lib/schemas';
import { handle, HttpError, json, parseBody } from '@/lib/server/http';
import { deleteRecord, getRecord, patchRecord } from '@/lib/server/store';

export const dynamic = 'force-dynamic';
type Ctx = { params: { id: string } };

export const GET = handle(async (_req: Request, { params }: Ctx) => {
  const rec = await getRecord(params.id);
  if (!rec) throw new HttpError(404, 'Not found');
  return json(rec);
});

export const PATCH = handle(async (req: Request, { params }: Ctx) => {
  const patch = await parseBody(req, recordPatchSchema);
  const rec = await patchRecord(params.id, patch);
  if (!rec) throw new HttpError(404, 'Not found');
  return json(rec);
});

export const DELETE = handle(async (_req: Request, { params }: Ctx) => {
  await deleteRecord(params.id);
  return json({ ok: true });
});
