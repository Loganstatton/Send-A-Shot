import { handle, json } from '@/lib/server/http';
import { listHistory } from '@/lib/server/store';

export const dynamic = 'force-dynamic';

export const GET = handle(async (req: Request) => {
  const url = new URL(req.url);
  let list = await listHistory();
  if (url.searchParams.get('favorites') === '1') list = list.filter((r) => r.favorite);
  const limit = Math.min(500, Number(url.searchParams.get('limit')) || 200);
  // The list view doesn't need the submitted graphs; keep the payload small.
  return json(list.slice(0, limit).map(({ submittedGraph, ...r }) => r));
});
