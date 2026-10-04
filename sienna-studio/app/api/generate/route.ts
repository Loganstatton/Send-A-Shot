import { generateSchema } from '@/lib/schemas';
import { startGeneration } from '@/lib/server/generate';
import { handle, json, parseBody } from '@/lib/server/http';

export const dynamic = 'force-dynamic';

/** Queue a generation. Returns the history record immediately; poll /api/history/:id/status. */
export const POST = handle(async (req: Request) => {
  const body = await parseBody(req, generateSchema);
  return json(await startGeneration(body), 202);
});
