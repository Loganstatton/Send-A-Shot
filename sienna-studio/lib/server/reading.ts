import 'server-only';
import { cleanRead, type ReadResult } from '../ai-prompts';
import { packNote, type Interpretation } from '../interpret';
import { posePreset, presetFitsCamera } from '../pose-presets';
import { packFitsOutfit, packStrength, resolvePackConflicts, STYLE_PACKS, stylePacksFor, TINY_STRING_OUTFIT } from '../style-packs';
import { PROMPT_FIELD_KEYS, type PromptFields } from '../types';

/**
 * The AI reader's answer applied to an interpretation: fields, packs, adult mode, notes. Returns the pose preset to
 * use (null with a reference pose photo, or when the preset's viewpoint would override the camera asked for).
 * Shared by Create and Copy Photo (which reads the description written from the uploaded photo).
 */
export function applyAiReading(it: Interpretation, r: ReadResult, prompt: string, adultOk: boolean, guides: readonly string[], posePhoto: boolean): string | null {
  const c = cleanRead(r, stylePacksFor(adultOk ? 'adult' : 'sfw').map((p) => p.id), guides);
  it.fields = Object.fromEntries(PROMPT_FIELD_KEYS.map((k) => [k, (c[k as keyof typeof c] as string) ?? ''])) as unknown as PromptFields;
  // an outfit pack only when it fits the whole requested outfit (it must never replace a garment that was named)
  // conflicting packs never stack (the reader picked micro bikini + string swimsuit for a micro string bikini: D3)
  const picked = resolvePackConflicts(Object.fromEntries(c.packs.filter((id) => packFitsOutfit(id, c.outfit)).map((id) => [id, packStrength(id, prompt)])));
  it.packs = picked.packs;
  if (it.packs.string_swimsuit === STYLE_PACKS.find((p) => p.id === 'string_swimsuit')?.max && !it.fields.outfit.includes(TINY_STRING_OUTFIT))
    it.fields.outfit = [it.fields.outfit, TINY_STRING_OUTFIT].filter(Boolean).join(', ');
  if (Object.keys(it.packs).some((id) => STYLE_PACKS.find((p) => p.id === id)?.section === 'adult')) it.contentMode = 'adult';
  const pre = posePreset(c.posePreset);
  it.notes = [
    `Read by AI: ${c.understood}`,
    ...c.hard.map((h) => `May be hard for the image model: ${h}`),
    ...(Object.keys(it.packs).length ? [packNote(it.packs)] : []),
    ...(it.contentMode === 'adult' ? ['Adult mode.'] : []),
    ...(it.reference.mode !== 'none' ? [it.reference.why] : []),
  ];
  return posePhoto || !pre || !presetFitsCamera(pre, `${c.camera} ${c.framing} ${c.pose}`) ? null : pre.id;
}
