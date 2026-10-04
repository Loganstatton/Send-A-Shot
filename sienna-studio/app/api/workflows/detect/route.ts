import { autoDetectBindings, parseWorkflowJson } from '@/lib/comfy/adapter';
import { handle, HttpError, json } from '@/lib/server/http';

/** Body: { json } → { bindings } — preview auto-detection without saving. */
export const POST = handle(async (req: Request) => {
  const body = (await req.json().catch(() => null)) as { json?: unknown } | null;
  try {
    const graph = parseWorkflowJson(body?.json);
    return json({ bindings: autoDetectBindings(graph) });
  } catch (e: any) {
    throw new HttpError(400, e.message);
  }
});
