import { db } from './pg';

// Beta feedback (migration 009). Signed-in players only, so each entry can
// be followed up and one person can't flood it; a few per day at most.
export const FEEDBACK_PER_DAY = 3;
export const FEEDBACK_TEXT_MAX = 2000;
export const UNDERSTOOD_OPTIONS = ['yes', 'partly', 'no'] as const;
export type Understood = (typeof UNDERSTOOD_OPTIONS)[number];

export type FeedbackEntry = {
  id: number; user_id: number | null; page: string | null; understood_scoring: Understood | null; enjoyed: string | null; confused: string | null; created_at: string;
};

const clean = (v: unknown) => (typeof v === 'string' && v.trim() ? v.trim().slice(0, FEEDBACK_TEXT_MAX) : null);

export async function submitFeedback(userId: number, input: { page?: unknown; understood?: unknown; enjoyed?: unknown; confused?: unknown }) {
  const enjoyed = clean(input.enjoyed);
  const confused = clean(input.confused);
  const understood = UNDERSTOOD_OPTIONS.includes(input.understood as Understood) ? (input.understood as Understood) : null;
  if (!enjoyed && !confused && !understood) return { ok: false as const, status: 400, error: 'Tell us at least one thing.' };
  const since = new Date(Date.now() - 86_400_000).toISOString();
  const recent = (await db.prepare('SELECT COUNT(*) AS c FROM beta_feedback WHERE user_id = ? AND created_at >= ?').get(userId, since)) as { c: number };
  if (recent.c >= FEEDBACK_PER_DAY) return { ok: false as const, status: 429, error: "Thanks — you've sent plenty today. Try again tomorrow." };
  const page = typeof input.page === 'string' && input.page.startsWith('/') ? input.page.slice(0, 200) : null;
  await db.prepare('INSERT INTO beta_feedback (user_id, page, understood_scoring, enjoyed, confused, created_at) VALUES (?, ?, ?, ?, ?, ?)')
    .run(userId, page, understood, enjoyed, confused, new Date().toISOString());
  return { ok: true as const };
}

export async function getFeedback(limit = 200): Promise<(FeedbackEntry & { user_name: string | null; user_email: string | null })[]> {
  return (await db.prepare(`
    SELECT f.*, u.name AS user_name, u.email AS user_email
    FROM beta_feedback f LEFT JOIN users u ON u.id = f.user_id
    ORDER BY f.created_at DESC, f.id DESC LIMIT ?
  `).all(limit)) as any[];
}

export async function getFeedbackSummary() {
  const rows = (await db.prepare('SELECT understood_scoring AS k, COUNT(*) AS c FROM beta_feedback GROUP BY understood_scoring').all()) as { k: string | null; c: number }[];
  const by = Object.fromEntries(rows.map((r) => [r.k ?? 'unanswered', r.c]));
  return { total: rows.reduce((s, r) => s + r.c, 0), yes: by.yes ?? 0, partly: by.partly ?? 0, no: by.no ?? 0 };
}
