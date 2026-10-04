// Prompt safety + identity guard. Pure functions, used by the browser (live
// warnings) and re-run on the server (authoritative) before anything is sent
// to ComfyUI.

export interface GuardHit {
  term: string;
  reason: string;
}

// ── Hard blocks (always on, cannot be disabled) ─────────────────────────────

/** Anything that suggests a minor. Sienna is an adult and content must stay clearly adult. */
const MINOR_PATTERNS: RegExp[] = [
  /\bchild(ren|ish|like|-like)?\b/i,
  /\bkids?\b/i,
  /\bminors?\b/i,
  /\bunder\s*-?\s*age(d)?\b/i,
  /\b(pre)?teen(s|age|aged|ager|agers)?\b/i,
  /\bschool\s*girls?\b/i,
  /\b(high|middle|elementary|primary|junior)\s*school(er)?\b/i,
  /\blolita\b|\bloli\b|\bshota\b/i,
  /\b(little|young)\s+(girl|boy)s?\b/i,
  /\bbaby\s*-?\s*face(d)?\b/i,
  /\byoung\s*-?\s*looking\b|\blooks?\s+young(er)?\b/i,
  /\bbarely\s+legal\b|\bjailbait\b/i,
  /\b(infant|toddler|tween|juvenile|pubescent|prepubescent)s?\b/i,
  /\b(1[0-7]|[1-9])\s*-?\s*(years?|yrs?|yo)\b(\s*-?\s*old)?/i,
  /\baged?\s+(1[0-7]|[1-9])\b/i,
];

/** Attempts to borrow a real person's likeness. */
const REAL_PERSON_PATTERNS: RegExp[] = [
  /\blook\s*-?\s*alike\b/i,
  /\b(famous|real|real-life|well-known)\s+(actress|actor|model|person|influencer|singer|streamer|celebrity)\b/i,
  /\bresembl(e|es|ing|ance)\b/i,
  /\bin\s+the\s+likeness\s+of\b/i,
  /\bcelebrit(y|ies)\b/i,
  /\bdeep\s*-?\s*fake\b/i,
  /\bface\s*-?\s*swap(ped|ping)?\b/i,
];

export function findHardBlocks(text: string): GuardHit[] {
  const hits: GuardHit[] = [];
  for (const re of MINOR_PATTERNS) {
    const m = text.match(re);
    if (m) hits.push({ term: m[0], reason: 'Content must depict adults only.' });
  }
  for (const re of REAL_PERSON_PATTERNS) {
    const m = text.match(re);
    if (m) hits.push({ term: m[0], reason: 'Sienna is fictional — prompts cannot reference real people’s likeness.' });
  }
  return hits;
}

// ── Identity lock (only when Sienna Lock is ON) ─────────────────────────────

const HAIR_COLORS =
  'blonde|blond|brunette|redhead|ginger|auburn|platinum|silver|grey|gray|white|black|brown|dark|light|red|pink|blue|green|purple|copper|strawberry|ash|honey|chestnut|jet|raven|bleached|dyed|highlighted|ombre|balayage';
const EYE_COLORS = 'blue|green|brown|hazel|grey|gray|amber|dark|light|black|violet|red|heterochromatic';

interface LockRule {
  category: string;
  re: RegExp;
}

// NOTE: patterns are built with string concatenation, not template literals —
// Next's SWC minifier has mangled a trailing \b inside template literals.
const LOCK_RULES: LockRule[] = [
  { category: 'hair colour', re: new RegExp('\\b(' + HAIR_COLORS + ')([\\s-]+(' + HAIR_COLORS + '))*[\\s-]+(haired|hair(ed)?)\\b', 'gi') },
  { category: 'hair colour', re: /\b(blonde|blond|brunette|redhead|ginger)\b/gi },
  { category: 'hair colour', re: /\b(hair\s*colou?r|dyed\s+hair|hair\s+dye)\b/gi },
  { category: 'eye colour', re: new RegExp('\\b(' + EYE_COLORS + ')([\\s-]+(' + EYE_COLORS + '))*[\\s-]+eyed?s?\\b', 'gi') },
  { category: 'eye colour', re: /\b(eye\s*colou?r|colou?red\s+contacts)\b/gi },
  { category: 'skin tone / ethnicity', re: /\b(pale|tanned|tan|dark|olive|fair|brown|black|white|porcelain|ebony)(\s*-|\s)\s*skin(ned)?\b/gi },
  {
    category: 'skin tone / ethnicity',
    re: /\b(asian|african|latina|latino|hispanic|caucasian|european|indian|arab|middle\s*eastern|nordic|scandinavian|east\s*asian|south\s*asian)\b/gi,
  },
  { category: 'freckles', re: /\b(no|without|remove(d)?)\s+freckles\b|\bfreckle\s*-?\s*free\b|\bheavy\s+freckles\b/gi },
  { category: 'face shape', re: /\b(different|new|another|changed?)\s+(face|person|woman|girl|identity|nose|jaw(line)?|chin)\b/gi },
  { category: 'face shape', re: /\b(round|square|heart|long|diamond)\s*-?\s*shaped\s+face\b|\bface\s+shape\b/gi },
  { category: 'face shape', re: /\b(nose\s+job|rhinoplasty|lip\s+fillers?|facial\s+surgery)\b/gi },
  { category: 'age', re: /\b(older|elderly|middle\s*-?\s*aged|mature\s+woman|wrinkles|wrinkled|aged\s+up|grey\s*ing|graying)\b/gi },
  { category: 'age', re: /\b([2-9]\d)\s*-?\s*(years?|yrs?|yo)\b(\s*-?\s*old)?/gi },
];

export interface LockResult {
  text: string;
  removed: { term: string; category: string }[];
}

/** Strip identity-altering phrases from a free-text field. */
export function applyIdentityLock(text: string, extraTerms: string[] = []): LockResult {
  const removed: LockResult['removed'] = [];
  let out = text;
  const rules: LockRule[] = [
    ...LOCK_RULES,
    ...extraTerms
      .map((t) => t.trim())
      .filter(Boolean)
      .map((t) => ({ category: 'custom locked term', re: new RegExp('\\b' + escapeRegExp(t) + '\\b', 'gi') })),
  ];
  for (const rule of rules) {
    out = out.replace(rule.re, (m) => {
      removed.push({ term: m.trim(), category: rule.category });
      return '';
    });
  }
  return { text: tidy(out), removed };
}

function escapeRegExp(s: string) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** Clean up punctuation left behind after removing phrases. */
export function tidy(s: string): string {
  return s
    .replace(/\s+/g, ' ')
    .replace(/\s+([,.;])/g, '$1')
    .replace(/([,;])\s*([,;])+/g, '$1')
    .replace(/^[\s,;.]+|[\s,;]+$/g, '')
    .replace(/\b(with|and|a|an|the)\s*,/gi, ',')
    .replace(/,\s*,/g, ',')
    .trim();
}
