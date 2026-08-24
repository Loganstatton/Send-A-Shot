// Push alerting on top of the sync_runs/discovery_runs history this app
// already tracks (see app/admin/sync and app/admin/discovery) — those are
// pull-based (a human has to go look), which is fine day-to-day but means
// a genuinely broken daily cron could go unnoticed for a while. This emails
// every current admin when a run completes with status='failed'. Same
// "never blocks, never throws" discipline every other email in this app
// follows (see lib/email.ts) — a failed alert must never make the actual
// failure worse.

import { getAllUsers } from './db';
import { emailConfigured, sendEmail } from './email';

export async function notifyAdminsOfRunFailure(kind: string, detail: string): Promise<void> {
  if (!emailConfigured()) return;
  const admins = getAllUsers().filter((u) => u.role === 'admin');
  if (admins.length === 0) return;

  const html = `
    <p><strong>${kind} failed.</strong></p>
    <p style="white-space:pre-wrap;font-family:monospace;font-size:13px;">${detail}</p>
    <p style="color:#888;font-size:12px;">Automated alert from Send-A-Shot — see /admin/sync or /admin/discovery for run history.</p>
  `;
  await Promise.all(
    admins.map((admin) =>
      sendEmail({ to: admin.email, subject: `⚠ ${kind} failed`, html }).catch((err) => {
        console.error('[ops-alerts] failed to send failure alert', err);
      })
    )
  );
}
