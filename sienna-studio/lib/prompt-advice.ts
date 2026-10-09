/**
 * Plain-language warnings about a prompt that will weaken the outfit description. From a live case: a 380-word
 * prompt with the outfit 55 words in, nine mentions of "skin" and "no wide bikini cups" came out as a beige
 * full-cup bikini instead of a black micro bikini.
 */
import { splitAvoid } from './outfit-edit';

export interface PromptAdvice {
  id: 'long' | 'buried' | 'outfit-long' | 'negation' | 'skin' | 'avoid-conflict' | 'size-conflict' | 'colours';
  text: string;
}

/** Rough CLIP token count (SDXL reads 75 tokens per chunk; punctuation and word pieces count). */
export function approxTokens(text: string): number {
  const words = text.match(/[A-Za-z0-9']+/g) ?? [];
  const punct = text.match(/[,.;:!?()]/g) ?? [];
  return Math.round(words.length * 1.3 + punct.length);
}

const COLOURS = ['black', 'white', 'red', 'blue', 'green', 'yellow', 'pink', 'purple', 'orange', 'brown', 'beige', 'nude', 'grey', 'gray', 'gold', 'silver', 'navy', 'cream', 'tan'];
const SMALL_RE = /\b(micro|tiny|minimal|minimalist|barely|skimpy|thong|string|small)\b/i;
const LARGE_RE = /\b(full[- ]coverage|wide|large|big|thick|high[- ]waisted|modest|padded)\b/i;
const NEGATION_RE = /\b(?:no|without)\s+([a-z][a-z -]{2,40}?)(?=[,.;]|\band\b|$)/gi;

export interface AdviceInput {
  /** The whole positive prompt as sent (Create), or the edit description (Edit Outfit). */
  positive: string;
  outfit: string;
  avoid?: string;
  /** Edit Outfit moves "no …" sentences to the negative prompt automatically. */
  negationsMoved?: boolean;
}

export function promptAdvice({ positive, outfit, avoid = '', negationsMoved = false }: AdviceInput): PromptAdvice[] {
  const out: PromptAdvice[] = [];
  const tokens = approxTokens(positive);
  if (tokens > 225) {
    out.push({
      id: 'long',
      text: `The prompt is about ${tokens} tokens. The image model reads 75 at a time and pays most attention to the start — details past ~225 barely count. Shorten the realism / extra text.`,
    });
  }
  const o = outfit.trim();
  if (o) {
    const at = positive.toLowerCase().indexOf(o.slice(0, 40).toLowerCase());
    const before = at > 0 ? approxTokens(positive.slice(0, at)) : 0;
    if (before > 60) {
      out.push({ id: 'buried', text: `The outfit starts about ${before} tokens into the prompt — after the framing and pose. Shorten those so the outfit sits near the start.` });
    }
    const words = o.split(/\s+/).length;
    if (words > 45) {
      out.push({
        id: 'outfit-long',
        text: `The outfit description is ${words} words. Put the few words that define the shape first (e.g. “black micro string bikini, tiny triangle cups, thin string straps”) and cut the rest.`,
      });
    }
    const small = o.match(SMALL_RE)?.[0];
    const large = o.replace(/\b(?:no|without)\s+[^,.;]+/gi, '').match(LARGE_RE)?.[0];
    if (small && large) out.push({ id: 'size-conflict', text: `The outfit says both “${small}” and “${large}” — the model will average them. Keep one.` });
    const colours = [...new Set(COLOURS.filter((c) => new RegExp(`\\b${c}\\b`, 'i').test(o.replace(/\b(?:no|without)\s+[^,.;]+/gi, ''))))];
    if (colours.length >= 3) out.push({ id: 'colours', text: `The outfit mentions ${colours.join(', ')} — say which piece is which colour, or the colours will mix.` });
  }
  const negs = [...positive.matchAll(NEGATION_RE)].map((m) => m[1].trim()).filter((x) => !/^(more|less|longer|one)\b/i.test(x));
  if (negs.length) {
    out.push({
      id: 'negation',
      text: negationsMoved
        ? `“No …” phrases (${negs.slice(0, 3).join(', ')}) are moved to the editor's Avoid list automatically.`
        : `“No ${negs[0]}” reads as “${negs[0]}” to the image model. Move ${negs.length > 1 ? 'these' : 'it'} to Avoid (${negs.slice(0, 4).join(', ')}).`,
    });
  }
  const skin = (positive.match(/\bskin\b/gi) ?? []).length;
  if (skin >= 4 && o) {
    out.push({ id: 'skin', text: `“Skin” appears ${skin} times. The model can tint fabric skin-coloured (beige, nude) — use fewer skin words, or add “beige fabric, nude-coloured fabric” to Avoid.` });
  }
  const clash = splitAvoid(avoid).filter((a) => a.length > 2 && new RegExp(`\\b${a.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i').test(positive.replace(NEGATION_RE, '')));
  if (clash.length) out.push({ id: 'avoid-conflict', text: `“${clash[0]}” is both requested and in Avoid — remove it from one of them.` });
  return out;
}
