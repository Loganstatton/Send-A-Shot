/**
 * Sienna LoRA versions that may be selected per generation for A/B testing
 * while Sienna Lock is on. The profile's LoRA stays the default; only files
 * listed here can override it, so the lock can't be pointed at an arbitrary LoRA.
 */
export interface SiennaModel {
  file: string;
  label: string;
  note: string;
}

export const SIENNA_MODELS: SiennaModel[] = [
  { file: 'sienna_v2.safetensors', label: 'v2', note: 'Approved face identity (default).' },
  {
    file: 'sienna_v3_3_s3750.safetensors',
    label: 'v3.3-3750 (A/B candidate)',
    note: 'v3 body consistency with a near-v2 face. Candidate only — not the default.',
  },
];

/**
 * LoRA used under Sienna Lock: the per-generation choice when it is an approved
 * Sienna model, otherwise the profile's LoRA. `ignored` is set when a choice
 * was given but isn't on the approved list.
 */
export function resolveLockedLora(profileLora: string, choice: string | undefined): { file: string; ignored?: string } {
  const pick = (choice || '').trim();
  if (!pick) return { file: profileLora.trim() };
  if (SIENNA_MODELS.some((m) => m.file === pick)) return { file: pick };
  return { file: profileLora.trim(), ignored: pick };
}
