import { handle, json } from '@/lib/server/http';
import { pruneUnusedUploads } from '@/lib/server/store';

export const dynamic = 'force-dynamic';

/** Free disk space now: uploaded photos and driving videos no record, setting or cleared photo uses (older than an hour),
 * and leftover .tmp files. The same clean-up the app runs by itself when a write finds the disk full. */
export const POST = handle(async () => json({ freedBytes: await pruneUnusedUploads() }));
