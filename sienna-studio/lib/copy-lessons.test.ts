import { describe, expect, it } from 'vitest';
import { addLessons, lessonPhrases, lessonsFor, OWNER_LESSONS, type LessonBook } from './copy-lessons';
const learned = (ls: { phrase: string }[]) => ls.map((l) => l.phrase).filter((p) => !OWNER_LESSONS.some((o) => o.phrase === p));

describe('copy lessons', () => {
  it('cleans avoid phrases', () => {
    expect(lessonPhrases('(dangling loose strings:1.2), a thumb-like lump or extra strings, not yellow')).toEqual(['dangling loose strings', 'thumb-like lump', 'extra strings']);
  });
  it('counts a mistake once per copy and applies it after three copies', () => {
    let book: LessonBook = { lessons: {} };
    const fix = { aspect: 'unwanted', major: true, avoid: 'dangling loose strings' };
    book = addLessons(book, [fix, fix]);
    expect(book.lessons['dangling loose strings'].count).toBe(1);
    expect(learned(lessonsFor(book, 'yellow bikini'))).toEqual([]);
    book = addLessons(addLessons(book, [fix]), [fix]);
    expect(learned(lessonsFor(book, 'yellow bikini'))).toEqual(['dangling loose strings']);
  });
  it('never applies a lesson the photo itself shows', () => {
    let book: LessonBook = { lessons: {} };
    for (let i = 0; i < 3; i++) book = addLessons(book, [{ aspect: 'artifacts', major: true, avoid: 'sunglasses' }]);
    expect(learned(lessonsFor(book, 'dark tortoiseshell sunglasses, high bun'))).toEqual([]);
    expect(learned(lessonsFor(book, 'high bun'))).toHaveLength(1);
  });
  it('ignores minor fixes', () => {
    const book = addLessons({ lessons: {} }, [{ aspect: 'pose', major: false, avoid: 'closed-lip smile' }]);
    expect(book.lessons).toEqual({});
  });
  it('applies the owner’s lessons from the start, unless the photo shows that thing; fingers always', () => {
    const plain = lessonsFor({ lessons: {} }, 'yellow micro bikini, thin strings, fingers pinching a string').map((l) => l.phrase);
    expect(plain).toEqual(expect.arrayContaining(['six-fingered hand, extra fingers', 'knotted centre front', 'thick bikini straps']));
    const knotted = lessonsFor({ lessons: {} }, 'bikini top knotted at the centre front').map((l) => l.phrase);
    expect(knotted).not.toContain('knotted centre front');
    expect(knotted).toContain('six-fingered hand, extra fingers');
  });
});
