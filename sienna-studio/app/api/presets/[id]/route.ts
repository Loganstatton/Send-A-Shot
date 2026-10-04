import { presetSchema } from '@/lib/schemas';
import { handle, HttpError, json, parseBody } from '@/lib/server/http';
import { deletePreset, listPresets, savePreset } from '@/lib/server/store';

export const dynamic = 'force-dynamic';
type Ctx = { params: { id: string } };

export const PUT = handle(async (req: Request, { params }: Ctx) => {
  const existing = (await listPresets()).find((p) => p.id === params.id);
  if (!existing) throw new HttpError(404, 'Preset not found');
  const body = await parseBody(req, presetSchema);
  return json(await savePreset({ ...existing, ...body, id: existing.id }));
});

export const DELETE = handle(async (_req: Request, { params }: Ctx) => {
  await deletePreset(params.id);
  return json({ ok: true });
});
