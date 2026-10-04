import { autoDetectBindings, findOutputNodes, parseWorkflowJson } from '@/lib/comfy/adapter';
import { handle, HttpError, json } from '@/lib/server/http';
import { listWorkflows, newId, saveWorkflow } from '@/lib/server/store';

export const dynamic = 'force-dynamic';

export const GET = handle(async () => json(await listWorkflows()));

/** Body: { name, description?, json: <API-format workflow> } — bindings are auto-detected. */
export const POST = handle(async (req: Request) => {
  const body = (await req.json().catch(() => null)) as { name?: string; description?: string; json?: unknown } | null;
  if (!body?.json) throw new HttpError(400, 'Missing workflow "json"');
  let graph;
  try {
    graph = parseWorkflowJson(body.json);
  } catch (e: any) {
    throw new HttpError(400, e.message);
  }
  const wf = await saveWorkflow({
    id: newId('wf_'),
    name: (body.name || 'Untitled workflow').slice(0, 120),
    description: (body.description || '').slice(0, 1000),
    graph,
    bindings: autoDetectBindings(graph),
    outputNodeIds: findOutputNodes(graph).length > 1 ? findOutputNodes(graph).slice(-1) : [],
    allowLoraInjection: true,
    builtIn: false,
    updatedAt: new Date().toISOString(),
  });
  return json(wf, 201);
});
