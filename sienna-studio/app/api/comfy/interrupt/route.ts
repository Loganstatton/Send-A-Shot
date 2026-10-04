import { createBackend } from '@/lib/comfy/client';
import { handle, json } from '@/lib/server/http';
import { getComfyUrl } from '@/lib/server/store';

export const POST = handle(async () => {
  await createBackend(await getComfyUrl()).interrupt();
  return json({ ok: true });
});
