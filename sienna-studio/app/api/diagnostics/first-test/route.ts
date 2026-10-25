import { firstTestRequest } from '@/lib/server/diagnostics';
import { startGeneration } from '@/lib/server/generate';
import { handle, json } from '@/lib/server/http';

export const dynamic = 'force-dynamic';

/**
 * Queue the fixed first-real-generation test: Studio Neutral preset, Sienna
 * Lock on, LoRA 1.0, fixed seed, no pose, SFW, one portrait.
 * Body: { workflowId?: string }
 */
export const POST = handle(async (req: Request) => {
  const body = ((await req.json().catch(() => null)) ?? {}) as { workflowId?: unknown };
  return json(await startGeneration(await firstTestRequest(typeof body.workflowId === 'string' ? body.workflowId : null)), 202);
});
