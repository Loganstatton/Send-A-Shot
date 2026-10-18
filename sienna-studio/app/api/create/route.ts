import { applyClothingChanges, interpretPrompt } from '@/lib/interpret';
import { simpleCreateSchema } from '@/lib/schemas';
import { startGeneration } from '@/lib/server/generate';
import { availability, outfitEditEnabled, startOutfitEdit } from '@/lib/server/outfit-edit';
import { wakePhotoGpu } from '@/lib/server/photo-gpu-wake';
import { handle, json, parseBody } from '@/lib/server/http';
import { adultContentAllowed, getSettings, listHistory, patchRecord } from '@/lib/server/store';
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
  // A garment swap on a studio photo goes to Edit Outfit with the change in words: it redraws only the clothing
  // region with Qwen-Image-Edit. Live test: whole-photo img2img (0.5 and 0.62) kept a gray top gray when asked for
  // a red one, and at 0.5 also redrew her shorts.
  const changeOnly = source && it.changes.length && !Object.entries(it.fields).some(([k, v]) => k !== 'outfit' && k !== 'avoid' && v);
  // Off until the photo GPU can hold Qwen-Image-Edit: on the 24 GB RTX 4090 it ran out of memory loading the model
  // (live, 18 Oct). SIENNA_SIMPLE_TEXT_EDIT=true turns it on once the photo GPU has 32 GB or more.
  if (source && changeOnly && outfitEditEnabled() && process.env.SIENNA_SIMPLE_TEXT_EDIT === 'true') {
    await wakePhotoGpu(); // 503 "starting" while the photo GPU boots; the page retries
    const parts = new Set(it.changes.map((c) => c.part));
    const one = parts.size === 1 ? [...parts][0] : null;
    const scope = one === 'top' ? 'top' : one === 'bottom' ? 'bottom' : 'full';
    const description = scope === 'full' ? applyClothingChanges(source.fields.outfit, it.changes).replace(/^(she'?s|she is)?\s*wearing\s+/i, '') : it.changes.map((c) => c.to).join(' and ');
    const redraw = (await availability()).redrawMissing.length === 0;
    const rec = await startOutfitEdit({
      sourceId: source.id,
      imageIndex: Math.max(0, source.images.findIndex((i) => i.file === ref!.file)),
      reference: null,
      manualCrop: false,
      description,
      scope,
      footwear: 'keep',
      face: 'standard',
      seed: body.seed ?? -1,
      redraw,
      ...(it.fields.avoid ? { avoid: it.fields.avoid } : {}),
    });
    const simple = { prompt: body.prompt, notes: [...it.notes, `Only her ${scope === 'full' ? 'outfit' : scope} is redrawn (Edit Outfit); everything else stays as it was.`], reference: 'edit' as const };
    // the outfit as it now is (Edit Outfit's own text keeps the old garment for its records: "X (top), with the rest of …")
    const fields = { ...rec.fields, outfit: applyClothingChanges(source.fields.outfit, it.changes) };
    return json((await patchRecord(rec.id, { simple, fields })) ?? rec, 202);
  }
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
