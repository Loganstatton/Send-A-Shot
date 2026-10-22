import { handle, json } from '@/lib/server/http';
import { listHistory, patchRecord } from '@/lib/server/store';

export const dynamic = 'force-dynamic';

/** A photo still queued or running after this long is not coming back. */
const STALE_MS = 6 * 60 * 60 * 1000;

export const GET = handle(async (req: Request) => {
  const url = new URL(req.url);
  let list = await listHistory();
  // Photos left "queued" or "running" for hours never finish (the GPU session ended under them; three were stuck since
  // Oct 17–21). Mark them as stopped so they stop showing a spinner; nothing is deleted. Real jobs finish in minutes.
  const stale = list.filter((r) => (r.status === 'queued' || r.status === 'running') && Date.now() - Date.parse(r.createdAt) > STALE_MS);
  if (stale.length) {
    for (const r of stale) {
      await patchRecord(r.id, {
        status: 'error',
        error: 'This photo never finished — the GPU session ended before it was done. Nothing was lost; use “Make again” to try it once more.',
        completedAt: new Date().toISOString(),
      });
    }
    list = await listHistory();
  }
  if (url.searchParams.get('favorites') === '1') list = list.filter((r) => r.favorite);
  const limit = Math.min(500, Number(url.searchParams.get('limit')) || 200);
  // The list view doesn't need the submitted graphs; keep the payload small.
  return json(list.slice(0, limit).map(({ submittedGraph, ...r }) => r));
});
