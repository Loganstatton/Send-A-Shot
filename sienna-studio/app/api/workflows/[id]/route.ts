import { parseWorkflowJson, validateBindings } from '@/lib/comfy/adapter';
import { workflowUpdateSchema } from '@/lib/schemas';
import { handle, HttpError, json, parseBody } from '@/lib/server/http';
import { deleteWorkflow, getWorkflow, saveWorkflow } from '@/lib/server/store';

export const dynamic = 'force-dynamic';
type Ctx = { params: { id: string } };

export const GET = handle(async (_req: Request, { params }: Ctx) => {
  const wf = await getWorkflow(params.id);
  if (!wf) throw new HttpError(404, 'Workflow not found');
  return json(wf);
});

export const PUT = handle(async (req: Request, { params }: Ctx) => {
  const wf = await getWorkflow(params.id);
  if (!wf) throw new HttpError(404, 'Workflow not found');
  const patch = await parseBody(req, workflowUpdateSchema);
  const graph = patch.graph ? parseWorkflowJson(patch.graph) : wf.graph;
  const next = { ...wf, ...patch, graph, bindings: (patch.bindings as typeof wf.bindings) ?? wf.bindings };
  const problems = validateBindings(next.graph, next.bindings);
  if (problems.length) throw new HttpError(400, `Invalid mapping: ${problems.join('; ')}`);
  return json(await saveWorkflow(next));
});

/** Deletes a custom workflow, or resets an edited built-in. */
export const DELETE = handle(async (_req: Request, { params }: Ctx) => {
  await deleteWorkflow(params.id);
  return json({ ok: true });
});
