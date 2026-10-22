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
  /** Added to the end of the Outfit field when the pack is on (wording works much better there than up front). */
  outfit?: string;
  /** Used only when the top check redoes a photo that showed a nipple: extra wording that keeps this pack's top over
   * her chest. The first attempt keeps the pack's full look. */
  coverage?: { positive?: string; negative?: string };
  /** 'adult': only offered and applied in adult content mode (which the server can switch off entirely). */
  section?: 'adult';
  /** Only applied when the outfit has no top: with a dress or top on, the pack undressed her (and the top check
   * missed it). */
  nudeOnly?: boolean;
  /** The pack turns her away from the camera (used only by the experimental pose-aware face check). */
  rearPose?: boolean;
}

export const STYLE_PACKS: StylePack[] = [
  {
    id: 'micro_bikini',
    label: 'Micro bikini',
    hint: 'Tiny micro triangle bikinis — it adds the micro wording to your outfit, so “black micro bikini” is enough. 0.85 gives the smallest cups; the top check redoes any photo where they miss. Adds a little shine — add Natural skin (0.3) for matte skin.',
    file: 'pack_143602.safetensors',
    trigger: 'microbikini',
    // The approved micro look came from this outfit wording. Up front (with the trigger) it barely worked — the cups
    // stayed regular-sized. The top check redoes any photo where the tiny cups miss.
    outfit: 'tiny micro triangle bikini, very small triangle cups on thin string halter ties, tiny string bottoms tied at the hips',
    negative: 'sports bra, wide cups, padded cups, thick straps, full coverage',
    max: 0.9,
    default: 0.85,
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
  {
    id: 'all_fours',
    label: 'Kneeling from behind',
    hint: 'Kneeling with her back arched, seen from behind, looking back over her shoulder. Her face is turned away, so the face check often keeps the closest match instead of a perfect one.',
    file: 'pack_530095.safetensors',
    trigger: 'all fours, arching4s',
    max: 0.9,
    default: 0.8,
    source: 'https://civitai.com/models/530095',
    section: 'adult',
    rearPose: true,
  },
  {
    id: 'sink_selfie',
    label: 'Sink selfie (from behind)',
    hint: 'Mirror selfie from behind, sitting on the bathroom sink and looking back. Above 0.6 it enlarges her hips, so it is capped there.',
    file: 'pack_2406389.safetensors',
    trigger: 'Bo0ty_s3lfie_p0se',
    max: 0.6,
    default: 0.5,
    source: 'https://civitai.com/models/2406389',
    section: 'adult',
    rearPose: true,
  },
  {
    id: 'real_innie',
    label: 'Natural anatomy (innie)',
    hint: 'More natural, detailed intimate anatomy in nude shots. In testing her face, bust and skin stayed the same; above 0.6 is untested.',
    file: 'pack_1385637.safetensors',
    trigger: 'innie',
    max: 0.6,
    default: 0.5,
    source: 'https://civitai.com/models/1385637',
    section: 'adult',
  },
  {
    id: 'realistic_nudes',
    label: 'Realistic nude body',
    hint: 'More photographic nude skin and body detail, for nude shots only — it is skipped when the outfit has a top or dress. At 0.6 it lowered her face match (avg 0.78) and once made her bust larger and lower, so it defaults lower; turn it down if she looks off.',
    file: 'pack_1838378.safetensors',
    trigger: 'r39lb00bs',
    max: 0.6,
    default: 0.4,
    source: 'https://civitai.com/models/1838378',
    section: 'adult',
    nudeOnly: true,
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

/** Outfit text with the active packs' outfit wording added (once). */
/** Garment shapes the user named that a pack's own outfit wording would contradict (the user's words win). */
const OWN_SHAPE_RE = /\b(high[- ]waist(ed)?|boy ?shorts?|full[- ]coverage|bandeau|underwire|sports|halter|one[- ]piece|balconette|scoop|bralette|briefs)\b/i;

export function withPackOutfit(outfit: string, active: ActiveStylePack[]): string {
  if (OWN_SHAPE_RE.test(outfit)) return outfit;
  const extra = active.map((a) => a.pack.outfit ?? '').filter((o) => o && !outfit.includes(o));
  return extra.length ? [outfit.trim().replace(/[,.\s]+$/, ''), ...extra].filter(Boolean).join(', ') : outfit;
}

/** Outfit items that mean "no clothes at all". */
const NUDE_ITEM_RE = /^(?:(?:completely|fully|totally|entirely)\s+)?(?:nude|naked|unclothed)$|^(?:wearing nothing|nothing on|no clothes|no clothing)$/i;
/** Items allowed alongside nudity: jewellery and the like, nothing that covers her body. */
const ACCESSORY_ITEM_RE = /^(?:(?:a|an|thin|small|big|large|delicate|dainty|simple|gold|silver|pearl|diamond|layered|hoop|stud|her)\s+)*(?:necklace|pendant|chain|earrings?|hoops?|studs|bracelets?|bangles?|rings?|anklet|watch|jewelry|jewellery|glasses|sunglasses|hair clip|hair tie|scrunchie)s?$/i;
/** Any clothing, covering or garment word anywhere in the request. */
const CLOTHING_RE =
  /\b(bikinis?|bra|bralette|top|shirt|t-shirt|tee|tank|blouse|swimsuit|swimwear|monokini|one-piece|bodysuit|leotard|dress|gown|nightgown|nightie|slip|teddy|babydoll|sweater|hoodie|jacket|coat|blazer|robe|kimono|towel|corset|bustier|camisole|cami|crop|lingerie|underwear|panties|thong|g-string|briefs|boyshorts|knickers|garter|stockings|tights|pantyhose|fishnets?|socks|leggings|skirt|shorts|pants|trousers|jeans|overalls|apron|uniform|costume|outfit|clothes|clothing|clothed|dressed|wearing|lace|mesh|sheer|latex|leather|silk|satin|harness|pasties|tape|heels|shoes|boots|sneakers|sandals|scarf|sheet|blanket|covered|covering|topless|bottomless|half-naked|partially|semi-nude|see-through)\b/i;

/**
 * Whether a nude-only pack may run. Fail-closed: adult mode only, the Outfit must explicitly ask for no clothes
 * ("completely nude", "naked", …) with nothing but jewellery beside it, and no clothing or covering word may appear
 * in the outfit (including other packs' outfit wording), pose, body or extra fields. An empty outfit is not nude.
 */
export function nudeOnlyAllowed(
  contentMode: 'sfw' | 'adult',
  fields: { outfit?: string; pose?: string; bodyPresentation?: string; extra?: string },
): boolean {
  if (contentMode !== 'adult') return false;
  const items = (fields.outfit ?? '')
    .split(/,|;|\band\b|\bwith\b|\+/i)
    .map((s) => s.trim().replace(/[.!]+$/, ''))
    .filter(Boolean);
  if (!items.some((i) => NUDE_ITEM_RE.test(i))) return false;
  if (!items.every((i) => NUDE_ITEM_RE.test(i) || ACCESSORY_ITEM_RE.test(i))) return false;
  const rest = [fields.pose, fields.bodyPresentation, fields.extra].filter(Boolean).join(' ');
  return !CLOTHING_RE.test(rest);
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

/**
 * Simple Mode: packs switched on by the description itself, at their default strengths. Matched on the interpreted
 * fields (so "no lingerie" — already moved to Avoid — doesn't switch anything on), adult packs only in adult mode,
 * the nude-only pack only when nudeOnlyAllowed says so, at most STYLE_PACK_STACK_LIMIT packs (first match wins, in
 * this order). Real-photo look and Natural anatomy are left to the Advanced screen: "real photo" is in most
 * descriptions and that pack changes outfits; the anatomy pack is a deliberate choice.
 */
const AUTO_PACKS: [string, RegExp][] = [
  ['monokini', /\b(monokini|slingshot (swimsuit|bikini|one-piece))\b/i],
  ['string_swimsuit', /\bstring\s+(thong\s+)?(bikini|swimsuit)\b|\bstring thong bottoms?\b/i],
  ['micro_bikini', /\bmicro[- ]?(triangle\s+)?bikini\b/i],
  ['lace_bodysuit', /\b(lace\s+)?(high-cut\s+)?(bodysuit|leotard)\b/i],
  ['french_lace', /\bfrench lace\b|\blace\s+(lingerie|bra|bralette|panties|underwear|teddy)\b|\blingerie\b[^.]{0,40}\blace\b/i],
  ['belly_cutout_dress', /\b(belly\s+)?cut-?out dress\b|\bbelly cut-?out\b/i],
  ['mesh_top', /\b(shiny|metallic|chain(-?mail)?|chain-mesh)\s+(mesh\s+)?top\b|\bmesh top\b/i],
  ['underboob_shirt', /\bunderboob\b/i],
  ['lace_bandeau', /\b(lace\s+)?bandeau top\b|\blace bandeau\b/i],
  ['wet_tshirt', /\b(thin|wet|damp|clingy|clinging)\s+(white\s+)?(cotton\s+)?(t-shirt|tshirt|tee|shirt)\b/i],
  ['all_fours', /\bon all fours\b|\bon (her )?hands and knees\b/i],
  ['sink_selfie', /\bsink selfie\b|\b(sitting|sat|perched) on the (bathroom )?(sink|vanity|counter by the sink)\b/i],
  ['realistic_nudes', /\b(nude|naked)\b/i],
  ['natural_skin', /\b(natural|matte|textured|real) skin( texture)?\b|\bvisible pores\b|\bno makeup\b/i],
];

/**
 * Garments a request can name that an outfit pack would replace. The micro-bikini pack draws a whole bikini: "a white
 * micro bikini top and light gray pajama shorts" came out in white bikini bottoms 4 times of 4 (Oct 18). A pack is
 * used only when it fits the whole requested outfit.
 */
const BOTTOMS_RE = /\b(shorts|pants|trousers|jeans|sweatpants|joggers|leggings|skirt|sarong)\b/i;
const TOPS_RE = /\b(t-?shirt|tee|tank top|tank|camisole|cami|sweater|jumper|hoodie|sweatshirt|shirt|blouse|crop top|cardigan|jacket|blazer|turtleneck)\b/i;
const PACK_REPLACES: Record<string, RegExp[]> = {
  micro_bikini: [BOTTOMS_RE, TOPS_RE, /\bdress\b/i],
  string_swimsuit: [BOTTOMS_RE, TOPS_RE, /\bdress\b/i],
  monokini: [BOTTOMS_RE, TOPS_RE, /\bdress\b/i, /\bbikini\b/i],
  lace_bodysuit: [TOPS_RE, /\bdress\b/i, /\bbikini\b/i],
  belly_cutout_dress: [BOTTOMS_RE, TOPS_RE, /\bbikini\b/i],
  wet_tshirt: [/\b(tank top|tank|camisole|sweater|hoodie|blouse|bikini top|bra|bralette)\b/i],
  mesh_top: [/\b(t-?shirt|tee|tank top|sweater|hoodie|blouse|bikini top)\b/i],
  underboob_shirt: [/\b(tank top|sweater|hoodie|blouse|bikini top|bra)\b/i],
  lace_bandeau: [/\b(t-?shirt|tee|tank top|sweater|hoodie|blouse|bikini top|bra)\b/i],
};

/** The pack fits the requested outfit: it doesn't replace a garment the request names. Packs that draw no outfit always fit. */
export function packFitsOutfit(id: string, outfit: string): boolean {
  const rules = PACK_REPLACES[id];
  if (!rules || !outfit.trim()) return true;
  // garments that belong to the pack's own look don't count ("bikini top" for a bikini pack)
  const named = outfit.replace(/\b(bikini|swimsuit|swim|string|thong|micro)\s+(top|bottoms?|briefs)\b/gi, '');
  return !rules.some((re) => re.test(named));
}

const TINY_RE = /\b(tiny|micro|minimal|barely[- ]there|itsy|teeny)\b/i;
/** Shape wording added to the outfit for a tiny string bikini (the pack's own look: small triangles on thin strings). */
export const TINY_STRING_OUTFIT = 'very small triangle cups on thin strings, string thong bottoms';

/** A pack's strength for a description: its tested default, or its max for a tiny / micro string bikini. */
export function packStrength(id: string, text: string): number {
  const pack = STYLE_PACKS.find((p) => p.id === id);
  if (!pack) return 0;
  return id === 'string_swimsuit' && TINY_RE.test(text) ? pack.max : pack.default;
}

export function packsForDescription(
  fields: { outfit?: string; pose?: string; bodyPresentation?: string; extra?: string },
  contentMode: 'sfw' | 'adult',
): Record<string, number> {
  const text = Object.entries(fields as Record<string, string | undefined>)
    .filter(([k, v]) => k !== 'avoid' && v)
    .map(([, v]) => v)
    .join('. ');
  const offered = new Set(stylePacksFor(contentMode).map((p) => p.id));
  const out: Record<string, number> = {};
  for (const [id, re] of AUTO_PACKS) {
    if (Object.keys(out).length >= STYLE_PACK_STACK_LIMIT) break;
    const pack = STYLE_PACKS.find((p) => p.id === id);
    if (!pack || !offered.has(id) || !re.test(text)) continue;
    // "completely nude on her bed" → "completely nude": the place and pose aren't outfit items (the check stays strict)
    const outfit = (fields.outfit ?? '').replace(/^\s*(she'?s|she is|she|her)\s+/i, '').replace(/\s+\b(on|in|at|by|near|lying|sitting|standing|kneeling|posing)\b.*$/i, '');
    if (pack.nudeOnly && !nudeOnlyAllowed(contentMode, { ...fields, outfit })) continue;
    if (!packFitsOutfit(id, fields.outfit ?? '')) continue;
    // a string bikini already has the string swimsuit pack; the micro pack on top lowers coverage (see its hint)
    if (id === 'micro_bikini' && out.string_swimsuit) continue;
    if (id === 'french_lace' && out.lace_bodysuit) continue;
    // "tiny / micro string bikini": the 0.6 default came out with regular-size cups (live, 18 Oct); the pack's max
    // is the barely-there look it was tested at
    out[id] = packStrength(id, text);
  }
  return out;
}
