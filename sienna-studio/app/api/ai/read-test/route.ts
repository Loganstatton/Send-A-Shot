import { z } from 'zod';
import { NUDE_RE } from '@/lib/ai-prompts';
import { aiRead } from '@/lib/server/ai';
import { handle, json, parseBody } from '@/lib/server/http';
import { adultContentAllowed } from '@/lib/server/store';

export const dynamic = 'force-dynamic';

const schema = z.object({ prompt: z.string().trim().min(1).max(8000), capUsd: z.number().positive().max(0.2).optional() });

/**
 * Benchmark only: the AI reading of a description, made once so the versions being compared start from identical
 * fields (the reader can word a description slightly differently each time). Counts toward the monthly AI budget.
 */
export const POST = handle(async (req: Request) => {
  const body = await parseBody(req, schema);
  if (NUDE_RE.test(body.prompt)) return json({ error: 'Nude requests are never sent to the AI.' }, 400);
  const reading = await aiRead(body.prompt, 'none', adultContentAllowed(), [], { maxTokens: 1500, capUsd: body.capUsd });
  return reading ? json({ reading }) : json({ error: 'The AI reading failed.' }, 502);
});
