import { getAdminUser } from '@/lib/auth';

// Read-only market checks accept an admin session or the shared CRON_SECRET (the scheduled workflow).
// Anything that changes the market (depth, halts) needs a signed-in admin: a person approves it.
export async function adminOrCron(req: Request): Promise<{ id: number | null } | null> {
  const admin = await getAdminUser();
  if (admin) return { id: admin.id };
  const secret = process.env.CRON_SECRET;
  return secret && req.headers.get('x-cron-secret') === secret ? { id: null } : null;
}
