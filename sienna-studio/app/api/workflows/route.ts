import { autoDetectBindings, findOutputNodes, parseWorkflowJson } from '@/lib/comfy/adapter';
import { canPrune, MODULE_KEYS } from '@/lib/comfy/modules';
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
  const bindings = autoDetectBindings(graph);
  const wf = await saveWorkflow({
    id: newId('wf_'),
    name: (body.name || 'Untitled workflow').slice(0, 120),
    description: (body.description || '').slice(0, 1000),
    graph,
    bindings,
    // Image modules that can be cleanly removed are optional by default.
    optionalModules: MODULE_KEYS.filter((k) => canPrune(graph, bindings, k)),
    outputNodeIds: findOutputNodes(graph).length > 1 ? findOutputNodes(graph).slice(-1) : [],
    allowLoraInjection: true,
    builtIn: false,
    updatedAt: new Date().toISOString(),
  });
  return json(wf, 201);
});
