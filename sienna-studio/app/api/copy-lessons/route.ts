import { handle, json } from '@/lib/server/http';
import { clearLessons, readLessons } from '@/lib/server/copy-lessons';
import { LESSON_MAX_APPLIED, LESSON_MIN_COUNT } from '@/lib/copy-lessons';

export const dynamic = 'force-dynamic';

/** What Copy Photo has learned from its own mistakes (most frequent first), and how many times each was seen. */
export const GET = handle(async () => {
  const book = await readLessons();
  const lessons = Object.values(book.lessons).sort((a, b) => b.count - a.count);
  return json({ minCount: LESSON_MIN_COUNT, maxApplied: LESSON_MAX_APPLIED, lessons });
});

/** Forget every lesson (a lesson that turned out to hurt). */
export const DELETE = handle(async () => {
  await clearLessons();
  return json({ cleared: true });
});
