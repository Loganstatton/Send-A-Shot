import { NextResponse } from 'next/server';
import { getAdminUser } from '@/lib/auth';
import { logAdminAction } from '@/lib/audit';
import { sendEmail } from '@/lib/email';

export const dynamic = 'force-dynamic';

// Sends a test email to the signed-in admin's own address — the end-to-end
// check that the provider key, sending domain and from-address all work.
export async function POST() {
  const admin = await getAdminUser();
  if (!admin) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  const result = await sendEmail({
    to: admin.email,
    subject: 'NEXT test email',
    html: '<p>This is a test from the NEXT admin Email page. If you can read it, verification and password-reset emails will arrive too.</p>',
    kind: 'test',
    userId: admin.id,
  });
  await logAdminAction(admin.id, 'email_test_sent', { type: 'email', id: result.ok ? 'sent' : 'failed' });
  return result.ok ? NextResponse.json({ ok: true }) : NextResponse.json({ error: result.error }, { status: 502 });
}
