import { aiSpend } from '@/lib/server/ai';
import { handle, json } from '@/lib/server/http';

export const dynamic = 'force-dynamic';

/** AI reader/checker status: on or off, model, this month's spend and the cap. */
export const GET = handle(async () => json(await aiSpend()));
