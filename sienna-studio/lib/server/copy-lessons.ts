import 'server-only';
import fs from 'node:fs/promises';
import path from 'node:path';
import { addLessons, type LessonBook } from '../copy-lessons';
import { DATA_DIR } from './store';

/** Copy Photo lessons on disk (see lib/copy-lessons.ts). Every failure here is ignored: lessons never block a copy. */
const FILE = path.join(DATA_DIR, 'copy-lessons.json');
let lock: Promise<unknown> = Promise.resolve();

export async function readLessons(): Promise<LessonBook> {
  try {
    const j = JSON.parse(await fs.readFile(FILE, 'utf8'));
    return j && typeof j.lessons === 'object' ? j : { lessons: {} };
  } catch {
    return { lessons: {} };
  }
}

export function recordLessons(fixes: { aspect: string; major: boolean; avoid: string }[]): Promise<void> {
  if (!fixes.some((f) => f.major && f.avoid)) return Promise.resolve();
  const run = lock.then(async () => {
    try {
      const book = addLessons(await readLessons(), fixes);
      await fs.mkdir(DATA_DIR, { recursive: true });
      const tmp = `${FILE}.${process.pid}.tmp`;
      await fs.writeFile(tmp, JSON.stringify(book, null, 1));
      await fs.rename(tmp, FILE);
    } catch (e: any) {
      console.warn(`[copy-lessons] not saved: ${e?.message ?? e}`);
    }
  });
  lock = run.catch(() => {});
  return run;
}

export async function clearLessons(): Promise<void> {
  await fs.rm(FILE, { force: true });
}
