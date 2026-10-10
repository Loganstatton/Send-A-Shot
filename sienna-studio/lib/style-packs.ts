/**
 * Style packs: extra LoRAs stacked after Sienna's own LoRA, each with a dial.
 * All three were licence-checked on Civitai (commercial image use allowed) and
 * tested with Sienna on the RTX 4090 pod — see the max/default notes below.
 */

export interface StylePack {
  id: string;
  label: string;
  hint: string;
  /** File in ComfyUI's models/loras folder. */
  file: string;
  /** Added to the start of the positive prompt when the pack is on. */
  trigger: string;
  max: number;
  default: number;
  source: string;
  /** 'adult': only offered and applied in adult content mode (which the server can switch off entirely). */
  section?: 'adult';
}

export const STYLE_PACKS: StylePack[] = [
  {
    id: 'micro_bikini',
    label: 'Micro bikini',
    hint: 'Shrinks bikinis toward a micro cut. 0.75–0.85 is the reliable range; higher gives a fuller bust and can leave too little coverage. It also makes skin shiny — pair it with Natural skin (0.3) for matte, real-looking skin.',
    file: 'pack_143602.safetensors',
    trigger: 'microbikini',
    max: 0.9,
    default: 0.75,
    source: 'https://civitai.com/models/143602',
  },
  {
    id: 'real_photo',
    label: 'Real-photo look',
    hint: 'Natural light and believable rooms, like a real phone photo. Makes skin glossy — with Micro bikini, use Natural skin instead. Above 0.6 it starts changing the outfit.',
    file: 'pack_1368634.safetensors',
    trigger: 'IGMODEL',
    max: 0.6,
    default: 0.4,
    source: 'https://civitai.com/models/1368634',
  },
  {
    id: 'natural_skin',
    label: 'Natural skin',
    hint: 'Matte skin with pores and freckles — removes the shiny, plastic look. 0.3 works well; above 0.4 her face starts to change.',
    file: 'pack_248951.safetensors',
    trigger: 'Detailed natural skin and blemishes without-makeup and acne',
    max: 0.4,
    default: 0.3,
    source: 'https://civitai.com/models/248951',
  },
  {
    id: 'french_lace',
    label: 'French lace lingerie',
    hint: 'Finer lace: floral pattern, scalloped edges, thin straps. Describe the lingerie as usual (e.g. “white lace bra and panties”). 0.6 is enough — higher looks the same.',
    file: 'pack_2903117.safetensors',
    trigger: 'french_lace_lingerie, delicate lace lingerie',
    max: 0.8,
    default: 0.6,
    source: 'https://civitai.com/models/2903117',
    section: 'adult',
  },
];

/** Stacking more than this many packs visibly changes Sienna's face (and pose) in testing. */
export const STYLE_PACK_STACK_LIMIT = 2;

export interface ActiveStylePack {
  pack: StylePack;
  strength: number;
}

/** Packs offered in a content mode: adult-section packs only in adult mode. */
export function stylePacksFor(contentMode: 'sfw' | 'adult'): StylePack[] {
  return STYLE_PACKS.filter((p) => p.section !== 'adult' || contentMode === 'adult');
}

/** Packs switched on (strength > 0), clamped to each pack's max, in catalogue order. Unknown ids are ignored. */
export function activeStylePacks(values: Record<string, number> | undefined, contentMode: 'sfw' | 'adult' = 'sfw'): ActiveStylePack[] {
  if (!values) return [];
  return stylePacksFor(contentMode).flatMap((pack) => {
    const v = Number(values[pack.id]);
    if (!Number.isFinite(v) || v <= 0) return [];
    return [{ pack, strength: Math.round(Math.min(pack.max, v) * 100) / 100 }];
  });
}

/** Positive prompt with the active packs' trigger words in front. */
export function withTriggers(positive: string, active: ActiveStylePack[]): string {
  const triggers = active.map((a) => a.pack.trigger).filter((t) => t && !positive.includes(t));
  return triggers.length ? `${triggers.join(', ')}, ${positive}` : positive;
}
