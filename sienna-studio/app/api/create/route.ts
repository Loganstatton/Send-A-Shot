import { applyClothingChanges, interpretPrompt, packNote } from '@/lib/interpret';
import { cleanRead, NUDE_RE } from '@/lib/ai-prompts';
import { offeredGuides, posePreset, presetFitsCamera } from '@/lib/pose-presets';
import { packsForDescription, packStrength, STYLE_PACKS, stylePacksFor, TINY_STRING_OUTFIT } from '@/lib/style-packs';
import { aiEnabled, aiRead } from '@/lib/server/ai';
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
 * face reference in the face redraw, the face check), the default workflow and parameters, no hidden preset; style
 * packs only when the description names what they draw (packsForDescription). A pose preset is still picked from the pose wording, and the
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
    // packs follow the merged description (the original photo's outfit may have switched one on)
    const before = packNote(it.packs);
    it.packs = packsForDescription(it.fields, it.contentMode);
    it.notes = it.notes.filter((n) => n !== before);
    if (Object.keys(it.packs).length) it.notes.push(packNote(it.packs));
  }
  // A photo from outside the studio only lends its pose: editing it in place kept the other woman's blonde hair and
  // even the app's on-screen icons and username (live, 18 Oct), and it must never turn someone else into the result.
  if (ref && !source && (it.reference.mode === 'edit' || it.reference.mode === 'edit+pose')) {
    it.notes = it.notes.filter((n) => n !== it.reference.why);
    it.reference = { mode: 'pose', denoise: null, why: 'Reference photo from outside the studio: only her pose is copied — face, hair, body and the picture itself are all Sienna’s.' };
    it.notes.push(it.reference.why);
  }
  // The AI reader (when ANTHROPIC_API_KEY is set): Claude files the description into short SDXL phrases, picks packs
  // and a pose preset. Never for nudity, never for edits of a studio photo (those merge the original's fields); any
  // failure keeps the rule-based reading above.
  const aiAllowed = aiEnabled() && !NUDE_RE.test(body.prompt);
  let aiPose: string | null = null;
  let aiRan = false;
  if (aiAllowed && !source) {
    const adultOk = adultContentAllowed();
    // pose guides (skeletons for the described position, hands, legs and camera height): the tested ones always, all
    // of them on request (testing) or with SIENNA_POSE_GUIDE=true
    const guides = offeredGuides(body.poseGuide ?? process.env.SIENNA_POSE_GUIDE === 'true');
    const r = await aiRead(body.prompt, it.reference.mode, adultOk, guides);
    if (r) {
      const c = cleanRead(r, stylePacksFor(adultOk ? 'adult' : 'sfw').map((p) => p.id), guides);
      it.fields = Object.fromEntries(PROMPT_FIELD_KEYS.map((k) => [k, (c[k as keyof typeof c] as string) ?? ''])) as unknown as PromptFields;
      it.packs = Object.fromEntries(c.packs.map((id) => [id, packStrength(id, body.prompt)]));
      if (it.packs.string_swimsuit === STYLE_PACKS.find((p) => p.id === 'string_swimsuit')?.max && !it.fields.outfit.includes(TINY_STRING_OUTFIT))
        it.fields.outfit = [it.fields.outfit, TINY_STRING_OUTFIT].filter(Boolean).join(', ');
      if (c.packs.some((id) => STYLE_PACKS.find((p) => p.id === id)?.section === 'adult')) it.contentMode = 'adult';
      // no preset with a reference pose photo, or with a camera angle the preset's viewpoint would override
      const pre = posePreset(c.posePreset);
      aiPose = (ref && (it.reference.mode === 'pose' || it.reference.mode === 'edit+pose')) || !pre || !presetFitsCamera(pre, `${c.camera} ${c.framing} ${c.pose}`) ? null : pre.id;
      aiRan = true;
      it.notes = [
        `Read by AI: ${c.understood}`,
        ...c.hard.map((h) => `May be hard for the image model: ${h}`),
        ...(Object.keys(it.packs).length ? [packNote(it.packs)] : []),
        ...(it.contentMode === 'adult' ? ['Adult mode.'] : []),
        ...(it.reference.mode !== 'none' ? [it.reference.why] : []),
      ];
    }
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
      stylePacks: it.packs,
      posePreset: aiPose,
      // the AI chose the pose preset (or none): don't let the keyword matcher pick another one
      ...(aiRan ? { autoPosePreset: false } : {}),
      ...(edit && it.reference.denoise !== null ? { denoise: it.reference.denoise } : { denoise: 1 }),
    },
    images: {
      initImage: ref && edit ? ref : null,
      poseImage: ref && pose ? ref : null,
      faceReferenceId: null, // Sienna Lock → her profile's face reference
      outfitImage: null,
      outfitGarmentImage: null,
    },
    simple: { prompt: body.prompt, notes: it.notes, reference: ref ? it.reference.mode : 'none', ai: {
        read: aiRan,
        check: aiAllowed,
        // testing switches, until each has passed a GPU test
        keepPerson: body.keepPerson ?? process.env.SIENNA_KEEP_PERSON === 'true',
        lean: body.leanCheck ?? process.env.SIENNA_AI_CHECK === 'lean',
      } },
  };
  return json(await startGeneration(request), 202);
});
