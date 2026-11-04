/**
 * Copy Photo lessons: what the photo checker kept finding wrong in copies, remembered across requests and avoided in
 * every later copy (the owner, 1 Nov: "when it messes up you should also be teaching it"). No model is retrained: a
 * mistake seen in LESSON_MIN_COUNT or more separate copies becomes an Avoid phrase for the next ones, unless the new
 * photo's own description shows that thing.
 */

export type Lesson = { phrase: string; count: number; aspect: string; lastSeen: string };
export type LessonBook = { lessons: Record<string, Lesson> };

export const LESSON_MIN_COUNT = 3;
export const LESSON_MAX_APPLIED = 8;

/**
 * What the owner marked wrong in copies, applied to every copy from the start (no need to be seen three times), each
 * skipped like any lesson when the new photo's own description shows it. Hot tub, 4 Nov: "the top from my picture vs the
 * one it generates … Sienna has 6 fingers"; "this is what I mean by I want details … you're teaching the model so that
 * it learns what to do and what not to do next".
 */
export const OWNER_LESSONS: (Lesson & { always?: boolean })[] = [
  // no photo shows these, and the photo's own "fingers pinching a string" must not switch them off
  { phrase: 'six-fingered hand, extra fingers', aspect: 'anatomy', count: 99, lastSeen: '2026-11-04', always: true },
  { phrase: 'knotted centre front', aspect: 'clothing', count: 99, lastSeen: '2026-11-04' },
  { phrase: 'wide full-coverage cups', aspect: 'clothing', count: 99, lastSeen: '2026-11-04' },
  { phrase: 'thick bikini straps', aspect: 'clothing', count: 99, lastSeen: '2026-11-04' },
];

const STOP = new Set(['with', 'from', 'that', 'this', 'into', 'over', 'under', 'than', 'very', 'like', 'look', 'looks', 'photo', 'image']);

/** The avoid phrases of one checker fix, cleaned: lower case, no prompt weights, no "not …" clauses, short. */
export function lessonPhrases(avoid: string): string[] {
  return avoid
    .replace(/[()]/g, ' ')
    .replace(/:\s*\d+(\.\d+)?/g, ' ')
    .split(/[,;]|\bor\b|\band\b/i)
    .map((p) => p.trim().toLowerCase().replace(/\s+/g, ' ').replace(/^(a|an|the)\s+/, ''))
    .filter((p) => p.length >= 4 && p.length <= 60 && !/\bnot\b|\bno\b/.test(p));
}

/** The book with one finished copy's mistakes added: each phrase counts once per copy, however many tries showed it. */
export function addLessons(book: LessonBook, fixes: { aspect: string; major: boolean; avoid: string }[], now = new Date().toISOString()): LessonBook {
  const seen = new Map<string, string>();
  for (const f of fixes) if (f.major && f.avoid) for (const p of lessonPhrases(f.avoid)) if (!seen.has(p)) seen.set(p, f.aspect);
  const lessons = { ...book.lessons };
  for (const [phrase, aspect] of seen) {
    const old = lessons[phrase];
    lessons[phrase] = { phrase, aspect, count: (old?.count ?? 0) + 1, lastSeen: now };
  }
  return { lessons };
}

const words = (t: string) => new Set((t.toLowerCase().match(/[a-z]{4,}/g) ?? []).map((w) => w.replace(/s$/, '')).filter((w) => !STOP.has(w)));

/**
 * The lessons to apply to a new copy: seen in at least LESSON_MIN_COUNT copies, most frequent first, at most
 * LESSON_MAX_APPLIED, and never one the photo itself shows (half or more of its words in the photo's description:
 * a learned "sunglasses" or "closed-lip smile" stays out of a photo with sunglasses or a smile).
 */
export function lessonsFor(book: LessonBook, description: string): Lesson[] {
  const desc = words(description);
  const fits = (l: Lesson) => {
    const w = [...words(l.phrase)];
    return w.length > 0 && w.filter((x) => desc.has(x)).length / w.length < 0.5;
  };
  const owner = OWNER_LESSONS.filter((l) => l.always || fits(l)).map(({ always: _a, ...l }) => l);
  const ownPhrases = new Set(owner.map((l) => l.phrase));
  const learned = Object.values(book.lessons)
    .filter((l) => l.count >= LESSON_MIN_COUNT && !ownPhrases.has(l.phrase))
    .filter(fits)
    .sort((a, b) => b.count - a.count || b.lastSeen.localeCompare(a.lastSeen))
    .slice(0, LESSON_MAX_APPLIED);
  return [...owner, ...learned];
}
