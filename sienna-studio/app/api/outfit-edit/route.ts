import { z } from 'zod';
import { MAX_DESCRIPTION } from '@/lib/outfit-edit';
import { storedImageSchema } from '@/lib/schemas';
import { handle, json, parseBody } from '@/lib/server/http';
import { availability, startOutfitEdit } from '@/lib/server/outfit-edit';

export const dynamic = 'force-dynamic';

/** Is Edit Outfit turned on, and does the GPU server have what it needs? */
export const GET = handle(async () => json(await availability()));

/** Queue an outfit edit of an existing image. Returns the new history record; poll /api/history/:id/status. */
export const POST = handle(async (req: Request) => {
  const body = await parseBody(
    req,
    z.object({
      sourceId: z.string().min(1).max(64),
      imageIndex: z.number().int().min(0).max(7).default(0),
      reference: storedImageSchema,
      manualCrop: z.boolean().default(false),
      description: z.string().trim().min(3, 'Describe the clothing in the photo').max(MAX_DESCRIPTION),
      scope: z.enum(['full', 'top', 'bottom']).default('full'),
      footwear: z.enum(['keep', 'barefoot', 'reference']).default('keep'),
      face: z.enum(['off', 'standard', 'strong']).default('standard'),
      seed: z.number().int().min(-1).max(2 ** 48).default(-1),
      protect: z.object({ garmentOnly: z.boolean(), bodyRef: z.boolean(), bodyCheck: z.boolean() }).partial().optional(),
      redraw: z.boolean().optional(),
      avoid: z.string().max(300).optional(),
    }),
  );
  return json(await startOutfitEdit(body), 202);
});
