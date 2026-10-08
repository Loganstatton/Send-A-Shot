import { z } from 'zod';
import { storedImageSchema } from '@/lib/schemas';
import { handle, HttpError, json, parseBody } from '@/lib/server/http';
import { poseCheckStatus, startPoseCheck } from '@/lib/server/pose';

export const dynamic = 'force-dynamic';

/** Start a pose check (skeleton preview + visible extent). Poll with GET ?promptId=. */
export const POST = handle(async (req: Request) => {
  const b = await parseBody(
    req,
    z.object({
      image: storedImageSchema,
      width: z.number().int().min(256).max(2048),
      height: z.number().int().min(256).max(2048),
      fit: z.enum(['crop', 'pad']).default('crop'),
      retarget: z.number().min(0).max(1).default(0),
    }),
  );
  return json(await startPoseCheck(b.image, b), 202);
});

export const GET = handle(async (req: Request) => {
  const promptId = new URL(req.url).searchParams.get('promptId') ?? '';
  if (!/^[\w.-]{1,128}$/.test(promptId)) throw new HttpError(400, 'Missing or invalid promptId');
  return json(await poseCheckStatus(promptId));
});
