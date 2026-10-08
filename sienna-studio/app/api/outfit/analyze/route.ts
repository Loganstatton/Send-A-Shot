import { z } from 'zod';
import { storedImageSchema } from '@/lib/schemas';
import { handle, HttpError, json, parseBody } from '@/lib/server/http';
import { outfitAnalysisStatus, startOutfitAnalysis } from '@/lib/server/outfit';

export const dynamic = 'force-dynamic';

/** Start an outfit analysis (garment isolation + Florence-2 caption). Poll with GET ?promptId=. */
export const POST = handle(async (req: Request) => {
  const { image } = await parseBody(req, z.object({ image: storedImageSchema }));
  return json(await startOutfitAnalysis(image), 202);
});

export const GET = handle(async (req: Request) => {
  const promptId = new URL(req.url).searchParams.get('promptId') ?? '';
  if (!/^[\w.-]{1,128}$/.test(promptId)) throw new HttpError(400, 'Missing or invalid promptId');
  return json(await outfitAnalysisStatus(promptId));
});
