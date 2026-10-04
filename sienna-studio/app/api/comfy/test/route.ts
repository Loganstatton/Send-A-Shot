import { createBackend } from '@/lib/comfy/client';
import { handle, json } from '@/lib/server/http';
import { getComfyUrl } from '@/lib/server/store';

export const dynamic = 'force-dynamic';

/** Body: { url?: string } — test a URL before saving it, or the saved one. */
export const POST = handle(async (req: Request) => {
  const body = (await req.json().catch(() => ({}))) as { url?: string };
  const url = (body.url ?? '').trim() || (await getComfyUrl());
  if (url.toLowerCase() !== 'mock' && !/^https?:\/\//i.test(url)) {
    return json({ ok: false, error: 'URL must start with http:// or https://' }, 400);
  }
  const started = Date.now();
  const info = await createBackend(url).systemInfo();
  return json({ ...info, url, latencyMs: Date.now() - started });
});
