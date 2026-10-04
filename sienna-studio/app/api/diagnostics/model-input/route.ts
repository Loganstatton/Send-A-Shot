import { z } from 'zod';
import { handle, HttpError, json, parseBody } from '@/lib/server/http';
import { getWorkflow, saveWorkflow } from '@/lib/server/store';

export const dynamic = 'force-dynamic';

const schema = z.object({
  workflowId: z.string().max(100),
  nodeId: z.string().max(32),
  inputName: z.string().max(100),
  value: z.string().max(500),
});

/** Set the default value of a model-file input in a workflow template (e.g. the base checkpoint). */
export const POST = handle(async (req: Request) => {
  const { workflowId, nodeId, inputName, value } = await parseBody(req, schema);
  const wf = await getWorkflow(workflowId);
  if (!wf) throw new HttpError(404, 'Workflow not found');
  const node = wf.graph[nodeId];
  if (!node || typeof node.inputs[inputName] !== 'string') throw new HttpError(400, `${nodeId}.${inputName} is not a text/file input`);
  const graph = { ...wf.graph, [nodeId]: { ...node, inputs: { ...node.inputs, [inputName]: value } } };
  return json(await saveWorkflow({ ...wf, graph }));
});
