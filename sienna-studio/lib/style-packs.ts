/**
 * Style packs: extra LoRAs stacked after Sienna's own LoRA, each with a dial.
 * All were licence-checked on Civitai (commercial image use allowed) and
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
  /** Added to the negative prompt when the pack is on (for packs that tend to show more than the outfit asks for). */
  negative?: string;
  /** Used only when the top check redoes a photo that showed a nipple: extra wording that keeps this pack's top over
   * her chest. The first attempt keeps the pack's full look. */
  coverage?: { positive?: string; negative?: string };
  /** 'adult': only offered and applied in adult content mode (which the server can switch off entirely). */
  section?: 'adult';
}

export const STYLE_PACKS: StylePack[] = [
  {
    id: 'micro_bikini',
    label: 'Micro bikini',
    hint: 'Shrinks bikinis toward a micro cut. 0.75–0.85 is the reliable range; higher can leave too little coverage. Adds a little shine — add Natural skin (0.3) if you want matte, real-looking skin.',
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
    // Shortened from the pack's own trigger (“…without-makeup and acne”), which made her look younger and slimmer.
    trigger: 'detailed natural skin texture',
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
  {
    id: 'string_swimsuit',
    label: 'String swimsuit',
    hint: 'Ultra-minimal string bikinis: tiny triangles on thin strings, string thong bottoms. More minimal than Micro bikini. Above 0.7 the bottoms become barely-there. With Micro bikini on too she looks fuller but coverage drops — lower this to about 0.5.',
    file: 'pack_305655.safetensors',
    trigger: 'string swimsuit',
    // on a retry: 3/3 hard seeds ended covered with this (a "nipples" negative made it worse)
    coverage: { positive: 'triangle cups fully covering her chest' },
    max: 0.7,
    default: 0.6,
    source: 'https://civitai.com/models/305655',
    section: 'adult',
  },
  {
    id: 'lace_bodysuit',
    label: 'Lace bodysuit',
    hint: 'High-cut lace bodysuits and leotards with structured cups and a crisp lace pattern (e.g. “white lace high-cut bodysuit with a plunging neckline”).',
    file: 'pack_1276176.safetensors',
    trigger: 'leotard, body',
    max: 0.8,
    default: 0.6,
    source: 'https://civitai.com/models/1276176',
    section: 'adult',
  },
  {
    id: 'wet_tshirt',
    label: 'Thin white shirt',
    hint: 'Thin cotton t-shirts that cling naturally with real folds and a slightly damp look — not see-through at these strengths (0.5+ turns sheer). Describe the shirt as usual (e.g. “thin white cotton t-shirt, denim shorts”).',
    file: 'pack_138252.safetensors',
    trigger: 'w3t, wet tshirt',
    max: 0.45,
    default: 0.4,
    source: 'https://civitai.com/models/138252',
    section: 'adult',
  },
  {
    id: 'belly_cutout_dress',
    label: 'Belly cut-out dress',
    hint: 'Dresses with an open cut-out from the chest to the navel. Describe the dress as usual (e.g. “black belly cut-out dress, short, thin straps”) — the pack also keeps the colour you ask for. Add “long” or “short”.',
    file: 'pack_733289.safetensors',
    trigger: 'belly cut-out dress',
    max: 0.8,
    default: 0.6,
    source: 'https://civitai.com/models/733289',
    section: 'adult',
  },
  {
    id: 'mesh_top',
    label: 'Shiny mesh top',
    hint: 'Metallic chain-mesh tops with a draped cowl or halter neckline (e.g. “silver shiny mesh top with deep neckline, low-rise jeans”). Add “backless” for an open back.',
    file: 'pack_883770.safetensors',
    trigger: 'shiny mesh top',
    max: 0.8,
    default: 0.6,
    source: 'https://civitai.com/models/883770',
    section: 'adult',
  },
  {
    id: 'underboob_shirt',
    label: 'Underboob shirt',
    hint: 'Short crop tees cut high so the underside of her bust shows (e.g. “white underboob shirt, cropped short-sleeve tee, denim shorts”).',
    file: 'pack_706722.safetensors',
    trigger: 'underboob shirt',
    // on a retry (it came out topless in 1 of 2 first tests; with these, 6 of 6 kept the shirt)
    coverage: { negative: 'nipples, topless' },
    max: 0.7,
    default: 0.6,
    source: 'https://civitai.com/models/706722',
    section: 'adult',
  },
  {
    id: 'monokini',
    label: 'Monokini',
    hint: 'One-piece slingshot swimsuits: a deep V to the navel and high-cut legs (e.g. “black plunging monokini, high-cut legs”). The narrow straps often miss her chest — the top check then redoes the photo with more coverage.',
    file: 'pack_385723.safetensors',
    trigger: 'monokini',
    // the straps are narrow for her bust; on a retry these kept them over her chest (3/3 at 0.3) without shrinking her
    coverage: { positive: '(wide straps covering her chest:1.4), (large round natural breasts:1.3)', negative: '(nipples, areola:1.6), exposed breasts' },
    max: 0.6,
    default: 0.5,
    source: 'https://civitai.com/models/385723',
    section: 'adult',
  },
  {
    id: 'lace_bandeau',
    label: 'Lace bandeau top',
    hint: 'Strapless lace tube tops. It tends to pair them with lace bottoms; for shorts or jeans, name them plainly — weighting them, e.g. “(denim shorts:1.2)”, turns the top into denim too.',
    file: 'pack_602417.safetensors',
    trigger: 'lace bandeau top',
    max: 0.8,
    default: 0.6,
    source: 'https://civitai.com/models/602417',
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

/** Retry-only coverage wording of the given packs (by id), joined. */
export function packCoverage(ids: string[]): { positive: string; negative: string } {
  const packs = STYLE_PACKS.filter((p) => ids.includes(p.id) && p.coverage);
  return {
    positive: packs.map((p) => p.coverage!.positive ?? '').filter(Boolean).join(', '),
    negative: packs.map((p) => p.coverage!.negative ?? '').filter(Boolean).join(', '),
  };
}

/** Negative prompt with the active packs' own negatives added. */
export function withPackNegatives(negative: string, active: ActiveStylePack[]): string {
  const extra = active.map((a) => a.pack.negative ?? '').filter((n) => n && !negative.includes(n));
  return extra.length ? `${negative}, ${extra.join(', ')}` : negative;
}

/** Positive prompt with the active packs' trigger words in front. */
export function withTriggers(positive: string, active: ActiveStylePack[]): string {
  const triggers = active.map((a) => a.pack.trigger).filter((t) => t && !positive.includes(t));
  return triggers.length ? `${triggers.join(', ')}, ${positive}` : positive;
}
