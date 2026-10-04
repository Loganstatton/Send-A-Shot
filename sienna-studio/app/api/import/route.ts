import { parseWorkflowJson } from '@/lib/comfy/adapter';
import { handle, HttpError, json } from '@/lib/server/http';
import { characterPatchSchema, settingsPatchSchema } from '@/lib/schemas';
import { replaceConfig, SAFE_FILE_RE, writeImageFile } from '@/lib/server/store';
import type { ExportBundle } from '@/lib/types';

export const dynamic = 'force-dynamic';

/** Restore a bundle from /api/export. Replaces settings, profile, custom workflows and presets. */
export const POST = handle(async (req: Request) => {
  const bundle = (await req.json().catch(() => null)) as ExportBundle | null;
  if (!bundle || bundle.app !== 'sienna-studio' || bundle.version !== 1) throw new HttpError(400, 'Not a Sienna Studio export file');
  // Validate the pieces that feed into prompts / ComfyUI.
  const settings = settingsPatchSchema.parse(bundle.settings);
  const character = characterPatchSchema.parse(bundle.character);
  for (const wf of bundle.workflows ?? []) parseWorkflowJson(wf.graph);
  for (const [file, b64] of Object.entries(bundle.files ?? {})) {
    if (SAFE_FILE_RE.test(file)) await writeImageFile(file, Buffer.from(b64, 'base64'));
  }
  await replaceConfig({
    settings: settings as any,
    character: character as any,
    workflows: bundle.workflows ?? [],
    presets: bundle.presets ?? [],
  });
  return json({ ok: true, workflows: bundle.workflows?.length ?? 0, presets: bundle.presets?.length ?? 0 });
});
