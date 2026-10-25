import { promises as fs } from 'node:fs';
import path from 'node:path';
import { z } from 'zod';
import { parseWorkflowJson, validateBindings } from '@/lib/comfy/adapter';
import { handle, HttpError, json } from '@/lib/server/http';
import { bindingsSchema, characterPatchSchema, presetSchema, settingsPatchSchema, storedImageSchema } from '@/lib/schemas';
import { findHardBlocks } from '@/lib/guard';
import { adultContentAllowed, IMAGES_DIR, mimeFromBytes, newId, replaceConfig, SAFE_FILE_RE, writeImageFile } from '@/lib/server/store';
import type { ExportBundle } from '@/lib/types';

export const dynamic = 'force-dynamic';

/** Body references aren't editable through the profile form (they're added from approved photos), so the profile
 * schema doesn't take them; a backup carries them as they were. */
const bodyReferencesSchema = z
  .array(z.object({ image: storedImageSchema, recordId: z.string().max(64), lora: z.string().max(500), addedAt: z.string().max(40) }))
  .max(50)
  .optional();
const EXT_MIME: Record<string, string> = { png: 'image/png', jpg: 'image/jpeg', webp: 'image/webp' };

/** Restore a bundle from /api/export. Replaces settings, profile, custom workflows and presets. */
export const POST = handle(async (req: Request) => {
  const bundle = (await req.json().catch(() => null)) as ExportBundle | null;
  if (!bundle || bundle.app !== 'sienna-studio' || bundle.version !== 1) throw new HttpError(400, 'Not a Sienna Studio export file');
  // Validate the pieces that feed into prompts / ComfyUI.
  // the same checks as saving each piece in the app (PUT /api/settings, /api/character, workflows, presets)
  const settings = settingsPatchSchema.parse(bundle.settings);
  if (settings.contentMode === 'adult' && !adultContentAllowed()) settings.contentMode = 'sfw';
  const character = { ...characterPatchSchema.parse(bundle.character), bodyReferences: bodyReferencesSchema.parse((bundle.character as { bodyReferences?: unknown } | undefined)?.bodyReferences) };
  const blocked = findHardBlocks([character.appearanceTraits, character.defaultRealismPrompt, character.defaultCameraStyle, character.triggerToken].filter(Boolean).join(' '));
  if (blocked.length) throw new HttpError(422, `Profile rejected: “${blocked[0].term}” — ${blocked[0].reason}`);
  if ((character.faceReference || character.secondaryReferences?.length) && !character.fictionalAttestation)
    throw new HttpError(422, 'The profile in this file has reference images but no confirmation that they depict the fictional character — not imported.');
  // the same checks as saving a workflow in Library: an API-format graph (unwrapped), and bindings that point at nodes
  // and inputs it has
  const workflows = (bundle.workflows ?? []).map((wf) => {
    if (!wf || typeof wf.id !== 'string' || !wf.id) throw new HttpError(400, 'A workflow in this file has no id');
    const graph = parseWorkflowJson(wf.graph);
    const bindings = bindingsSchema.parse(wf.bindings);
    const problems = validateBindings(graph, bindings);
    if (problems.length) throw new HttpError(400, `Workflow “${wf.name ?? wf.id}”: invalid mapping: ${problems.join('; ')}`);
    return { ...wf, graph, bindings };
  });
  const presets = (bundle.presets ?? []).map((pr) => {
    const p = presetSchema.passthrough().parse(pr);
    return { ...p, id: p.id || newId('p_') };
  });
  // images only, and never over a file the studio already has (a gallery photo with the same name stays as it is;
  // re-importing your own backup finds the same files already there)
  let skipped = 0;
  for (const [file, b64] of Object.entries(bundle.files ?? {})) {
    if (!SAFE_FILE_RE.test(file) || typeof b64 !== 'string') continue;
    const bytes = Buffer.from(b64, 'base64');
    if (mimeFromBytes(bytes) !== EXT_MIME[file.split('.').pop()!.toLowerCase()]) {
      skipped++;
      continue;
    }
    const exists = await fs.stat(path.join(IMAGES_DIR, file)).then(() => true, () => false);
    if (!exists) await writeImageFile(file, bytes);
  }
  await replaceConfig({
    settings: settings as any,
    character: character as any,
    workflows,
    presets: presets as any,
  });
  return json({ ok: true, workflows: workflows.length, presets: presets.length, ...(skipped ? { skippedFiles: skipped } : {}) });
});
