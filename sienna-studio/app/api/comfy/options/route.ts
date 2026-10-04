import { createBackend } from '@/lib/comfy/client';
import { handle, json } from '@/lib/server/http';
import { getComfyUrl, getSettings, getWorkflow } from '@/lib/server/store';
import type { ControlKey } from '@/lib/types';

export const dynamic = 'force-dynamic';

/**
 * Dropdown choices pulled live from ComfyUI's /object_info, for the node
 * classes the selected workflow actually binds (so Flux workflows list UNETs,
 * SDXL workflows list checkpoints, etc.).
 */
export const GET = handle(async (req: Request) => {
  const url = new URL(req.url);
  const settings = await getSettings();
  const wfId = url.searchParams.get('workflowId') || settings.defaultWorkflowId || '';
  const workflow = wfId ? await getWorkflow(wfId) : null;
  const backend = createBackend(await getComfyUrl());

  const fallback: Partial<Record<ControlKey, [string, string]>> = {
    checkpoint: ['CheckpointLoaderSimple', 'ckpt_name'],
    lora_name: ['LoraLoader', 'lora_name'],
    sampler: ['KSampler', 'sampler_name'],
    scheduler: ['KSampler', 'scheduler'],
    controlnet_model: ['ControlNetLoader', 'control_net_name'],
  };

  const out: Record<string, string[]> = {};
  const errors: string[] = [];
  await Promise.all(
    (Object.keys(fallback) as ControlKey[]).map(async (key) => {
      const ref = workflow?.bindings[key]?.[0];
      const node = ref ? workflow!.graph[ref.nodeId] : undefined;
      const [cls, input] = node && ref ? [node.class_type, ref.inputName] : fallback[key]!;
      try {
        out[key] = await backend.inputChoices(cls, input);
      } catch (e: any) {
        out[key] = [];
        errors.push(e.message);
      }
    }),
  );
  return json({ options: out, error: errors[0] ?? null, backend: backend.kind });
});
