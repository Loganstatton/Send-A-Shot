import { handle, json } from '@/lib/server/http';
import { ingestDrivingVideo } from '@/lib/server/video';

export const dynamic = 'force-dynamic';
// normalising a long phone clip on a small server can take a while
export const maxDuration = 300;

/** Raw request body = the video file (any common phone format). Returns { video, poster }. */
export const POST = handle(async (req: Request) => json(await ingestDrivingVideo(req.body, Number(req.headers.get('content-length') || 0))));
