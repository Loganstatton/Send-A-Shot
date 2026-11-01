import { describe, expect, it } from 'vitest';
import { addLessons, lessonPhrases, lessonsFor, type LessonBook } from './copy-lessons';

describe('copy lessons', () => {
  it('cleans avoid phrases', () => {
    expect(lessonPhrases('(dangling loose strings:1.2), a thumb-like lump or extra strings, not yellow')).toEqual(['dangling loose strings', 'thumb-like lump', 'extra strings']);
  });
  it('counts a mistake once per copy and applies it after three copies', () => {
    let book: LessonBook = { lessons: {} };
    const fix = { aspect: 'unwanted', major: true, avoid: 'dangling loose strings' };
    book = addLessons(book, [fix, fix]);
    expect(book.lessons['dangling loose strings'].count).toBe(1);
    expect(lessonsFor(book, 'yellow bikini')).toEqual([]);
    book = addLessons(addLessons(book, [fix]), [fix]);
    expect(lessonsFor(book, 'yellow bikini').map((l) => l.phrase)).toEqual(['dangling loose strings']);
  });
  it('never applies a lesson the photo itself shows', () => {
    let book: LessonBook = { lessons: {} };
    for (let i = 0; i < 3; i++) book = addLessons(book, [{ aspect: 'artifacts', major: true, avoid: 'sunglasses' }]);
    expect(lessonsFor(book, 'dark tortoiseshell sunglasses, high bun')).toEqual([]);
    expect(lessonsFor(book, 'high bun')).toHaveLength(1);
  });
  it('ignores minor fixes', () => {
    const book = addLessons({ lessons: {} }, [{ aspect: 'pose', major: false, avoid: 'closed-lip smile' }]);
    expect(book.lessons).toEqual({});
  });
});
