import { handle, json } from '@/lib/server/http';
import { photoGpuView } from '@/lib/server/photo-gpu';

export const dynamic = 'force-dynamic';

/** The on-demand photo GPU's state, this session's and this month's cost. */
export const GET = handle(async () => json(await photoGpuView()));
