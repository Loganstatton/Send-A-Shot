import { applyClothingChanges, interpretPrompt } from '@/lib/interpret';
import { simpleCreateSchema } from '@/lib/schemas';
import { startGeneration } from '@/lib/server/generate';
import { handle, json, parseBody } from '@/lib/server/http';
import { adultContentAllowed, getSettings, listHistory } from '@/lib/server/store';
import { PROMPT_FIELD_KEYS, type GenerateRequest, type PromptFields } from '@/lib/types';

export const dynamic = 'force-dynamic';

/**
 * Simple Mode: one description (+ an optional reference photo) → a normal generation. The interpreter files the
 * description into the prompt fields; everything else is the studio's own defaults: Sienna Lock on (her LoRA, her
 * face reference in the face redraw, the face check), the default workflow and parameters, no hidden preset and no
 * style packs (the description decides the outfit). A pose preset is still picked from the pose wording, and the
 * on-demand GPU, its budget and the photo checks apply exactly as for the advanced screen.
 */
export const POST = handle(async (req: Request) => {
  const body = await parseBody(req, simpleCreateSchema);
  const settings = await getSettings();
  const ref = body.reference;
  const it = interpretPrompt(body.prompt, { hasReference: !!ref, adultAllowed: adultContentAllowed(), defaultMode: settings.contentMode });
  // Editing one of the studio's own photos: start from that photo's description and change only what is asked
  // ("change her top to a red tank top" alone would let img2img redraw her shorts too, and say nothing of the scene)
  const source = ref && it.reference.mode !== 'none' && it.reference.mode !== 'pose' ? (await listHistory()).find((r) => r.images?.some((i) => i.file === ref.file)) : undefined;
  if (source) {
    const merged = { ...source.fields } as PromptFields;
    for (const k of PROMPT_FIELD_KEYS) if (k !== 'avoid' && k !== 'outfit' && it.fields[k]) merged[k] = it.fields[k];
    merged.outfit = it.changes.length ? applyClothingChanges(source.fields.outfit, it.changes) : it.fields.outfit || source.fields.outfit;
    merged.avoid = [source.fields.avoid, it.fields.avoid].filter(Boolean).join(', ');
    it.fields = merged;
    if (source.contentMode === 'adult' && adultContentAllowed()) it.contentMode = 'adult';
    it.notes.push('Editing a studio photo: its original description is kept and only what you asked changes.');
  }
  const edit = it.reference.mode === 'edit' || it.reference.mode === 'edit+pose';
  const pose = it.reference.mode === 'pose' || it.reference.mode === 'edit+pose';
  const request: GenerateRequest = {
    presetId: null,
    workflowId: settings.defaultWorkflowId,
    siennaLock: true,
    contentMode: it.contentMode,
    fields: it.fields,
    params: {
      ...settings.defaultParams,
      seed: body.seed ?? -1,
      batchSize: 1,
      stylePacks: {},
      posePreset: null,
      ...(edit && it.reference.denoise !== null ? { denoise: it.reference.denoise } : { denoise: 1 }),
    },
    images: {
      initImage: ref && edit ? ref : null,
      poseImage: ref && pose ? ref : null,
      faceReferenceId: null, // Sienna Lock → her profile's face reference
      outfitImage: null,
      outfitGarmentImage: null,
    },
    simple: { prompt: body.prompt, notes: it.notes, reference: ref ? it.reference.mode : 'none' },
  };
  return json(await startGeneration(request), 202);
});
