import { runDiagnostics } from '@/lib/server/diagnostics';
import { handle, json } from '@/lib/server/http';

export const dynamic = 'force-dynamic';

/** Full connection + workflow diagnostics. ?workflowId= (defaults to the default workflow). */
export const GET = handle(async (req: Request) => {
  const workflowId = new URL(req.url).searchParams.get('workflowId');
  return json(await runDiagnostics(workflowId));
});
