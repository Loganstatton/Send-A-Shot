import { z } from 'zod';
import { NUDE_RE } from '@/lib/ai-prompts';
import { aiCheck } from '@/lib/server/ai';
import { handle, json, parseBody } from '@/lib/server/http';

export const dynamic = 'force-dynamic';

const schema = z.object({
  prompt: z.string().trim().min(1).max(8000),
  /** PNG or JPEG, base64 */
  image: z.string().min(100).max(20_000_000),
  effort: z.enum(['low', 'medium']).optional(),
  lean: z.boolean().optional(),
});

/**
 * Grades a saved photo against a description with the AI checker, without the GPU: used to compare checker
 * versions on photos that were already reviewed by eye. Counts toward the monthly AI budget like any check.
 */
export const POST = handle(async (req: Request) => {
  const body = await parseBody(req, schema);
  if (NUDE_RE.test(body.prompt)) return json({ error: 'Nude requests are never sent to the AI.' }, 400);
  const bytes = Buffer.from(body.image, 'base64');
  const mime = bytes[0] === 0xff ? 'image/jpeg' : 'image/png';
  return json(await aiCheck(body.prompt, bytes, mime, body.effort, body.lean));
});
