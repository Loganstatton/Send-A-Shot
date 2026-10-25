import { parseWorkflowJson } from '@/lib/comfy/adapter';
import { handle, HttpError, json } from '@/lib/server/http';
import { bindingsSchema, characterPatchSchema, presetSchema, settingsPatchSchema } from '@/lib/schemas';
import { findHardBlocks } from '@/lib/guard';
import { adultContentAllowed, replaceConfig, SAFE_FILE_RE, writeImageFile } from '@/lib/server/store';
import type { ExportBundle } from '@/lib/types';

export const dynamic = 'force-dynamic';

/** Restore a bundle from /api/export. Replaces settings, profile, custom workflows and presets. */
export const POST = handle(async (req: Request) => {
  const bundle = (await req.json().catch(() => null)) as ExportBundle | null;
  if (!bundle || bundle.app !== 'sienna-studio' || bundle.version !== 1) throw new HttpError(400, 'Not a Sienna Studio export file');
  // Validate the pieces that feed into prompts / ComfyUI.
  // the same checks as saving each piece in the app (PUT /api/settings, /api/character, workflows, presets)
  const settings = settingsPatchSchema.parse(bundle.settings);
  if (settings.contentMode === 'adult' && !adultContentAllowed()) settings.contentMode = 'sfw';
  const character = characterPatchSchema.parse(bundle.character);
  const blocked = findHardBlocks([character.appearanceTraits, character.defaultRealismPrompt, character.defaultCameraStyle, character.triggerToken].filter(Boolean).join(' '));
  if (blocked.length) throw new HttpError(422, `Profile rejected: “${blocked[0].term}” — ${blocked[0].reason}`);
  if ((character.faceReference || character.secondaryReferences?.length) && !character.fictionalAttestation)
    throw new HttpError(422, 'The profile in this file has reference images but no confirmation that they depict the fictional character — not imported.');
  for (const wf of bundle.workflows ?? []) {
    if (!wf || typeof wf.id !== 'string' || !wf.id) throw new HttpError(400, 'A workflow in this file has no id');
    parseWorkflowJson(wf.graph);
    bindingsSchema.parse(wf.bindings);
  }
  const presets = (bundle.presets ?? []).map((pr) => presetSchema.passthrough().parse(pr));
  for (const [file, b64] of Object.entries(bundle.files ?? {})) {
    if (SAFE_FILE_RE.test(file)) await writeImageFile(file, Buffer.from(b64, 'base64'));
  }
  await replaceConfig({
    settings: settings as any,
    character: character as any,
    workflows: bundle.workflows ?? [],
    presets: presets as any,
  });
  return json({ ok: true, workflows: bundle.workflows?.length ?? 0, presets: bundle.presets?.length ?? 0 });
});
