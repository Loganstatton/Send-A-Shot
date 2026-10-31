import { z } from 'zod';
import { MAX_MOTION_SECONDS, MAX_MOTION_TEXT } from '@/lib/video';
import { storedImageSchema } from '@/lib/schemas';
import { handle, json, parseBody } from '@/lib/server/http';
import { startVideo, videoAvailability } from '@/lib/server/video';

export const dynamic = 'force-dynamic';

/** Is Video Studio turned on, and does the GPU server have what each mode needs? */
export const GET = handle(async () => json(await videoAvailability()));

const storedVideoSchema = z.object({
  id: z.string().max(64),
  file: z.string().regex(/^mot_[a-z0-9]+\.mp4$/i),
  width: z.number().int().positive(),
  height: z.number().int().positive(),
  fps: z.number().positive(),
  frames: z.number().int().positive(),
  seconds: z.number().positive(),
  bytes: z.number().int().nonnegative(),
  createdAt: z.string(),
});

/** Queue a video made from a gallery photo. Returns the new history record; poll /api/history/:id/status. */
export const POST = handle(async (req: Request) => {
  const body = await parseBody(
    req,
    z.object({
      mode: z.enum(['animate', 'motion']),
      sourceId: z.string().min(1).max(64),
      imageIndex: z.number().int().min(0).max(7).default(0),
      seed: z.number().int().min(-1).max(2 ** 48).default(-1),
      quality: z.enum(['fast', 'quality', 'hybrid']).default('fast'),
      resolution: z.enum(['480p', '720p']).default('480p'),
      motion: z.string().trim().max(MAX_MOTION_TEXT).optional(),
      camera: z.enum(['still', 'push_in', 'orbit', 'handheld']).optional(),
      seconds: z.number().min(1).max(MAX_MOTION_SECONDS).optional(),
      drive: z.object({ video: storedVideoSchema, poster: storedImageSchema }).optional(),
      start: z.number().min(0).max(60).optional(),
      scene: z.string().trim().max(MAX_MOTION_TEXT).optional(),
      framing: z.enum(['still', 'small', 'walk', 'bend', 'turn', 'jump', 'athletic']).nullable().optional(),
      facing: z.enum(['camera', 'away']).optional(),
      background: z.enum(['photo', 'clip']).optional(),
      lockCamera: z.boolean().optional(),
    }),
  );
  return json(await startVideo(body), 202);
});
