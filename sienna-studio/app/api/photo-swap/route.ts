import { z } from 'zod';
import { handle, json, parseBody } from '@/lib/server/http';
import { startPhotoSwap } from '@/lib/server/photo-swap';

export const dynamic = 'force-dynamic';

const schema = z.object({ clearedId: z.string().min(1).max(64), seed: z.number().int().optional(), test: z.object({ faceDenoise: z.number().min(0.2).max(0.75).optional() }).optional() });

/** Photo Swap: Sienna in place of the woman in a cleared photo. 503 while the photo GPU starts (the page retries). */
export const POST = handle(async (req: Request) => {
  const body = await parseBody(req, schema);
  return json(await startPhotoSwap({ clearedId: body.clearedId, seed: body.seed ?? -1, ...(body.test?.faceDenoise ? { faceDenoise: body.test.faceDenoise } : {}) }), 202);
});
