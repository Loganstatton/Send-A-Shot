import { interpretPrompt } from '@/lib/interpret';
import { simpleCreateSchema } from '@/lib/schemas';
import { startGeneration } from '@/lib/server/generate';
import { handle, json, parseBody } from '@/lib/server/http';
import { adultContentAllowed, getSettings } from '@/lib/server/store';
import type { GenerateRequest } from '@/lib/types';

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
