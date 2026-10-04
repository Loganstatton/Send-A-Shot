import { presetSchema } from '@/lib/schemas';
import { handle, json, parseBody } from '@/lib/server/http';
import { listPresets, newId, savePreset } from '@/lib/server/store';

export const dynamic = 'force-dynamic';

export const GET = handle(async () => json(await listPresets()));

/** Create a custom preset (also used for "duplicate"). */
export const POST = handle(async (req: Request) => {
  const body = await parseBody(req, presetSchema);
  const preset = await savePreset({ ...body, id: newId('p_'), builtIn: false, updatedAt: new Date().toISOString() });
  return json(preset, 201);
});
