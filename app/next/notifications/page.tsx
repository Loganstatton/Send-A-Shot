import type { Metadata } from 'next';
import { requireUser } from '@/lib/auth';
import { getNotificationsForUser, maybeSendNotificationDigestEmail } from '@/lib/notifications';
import NotificationList from '@/components/next/NotificationList';

export const metadata: Metadata = { title: 'Notifications' };
export const dynamic = 'force-dynamic';

export default async function NotificationsPage() {
  const user = await requireUser();
  const notifications = getNotificationsForUser(user);

  // Best-effort digest email for whatever's new since the last one — see
  // maybeSendNotificationDigestEmail for why this runs here (on view)
  // rather than on a schedule this app has no job runner to drive.
  await maybeSendNotificationDigestEmail(user, notifications);

  return (
    <div className="flex flex-col gap-8">
      <div>
        <h1 className="font-display font-bold text-[34px] m-0 tracking-[-0.01em]">Notifications</h1>
        <p className="mt-1 mb-0 text-sm" style={{ color: 'var(--text-faint)' }}>
          Watchlist moves, new artists in your genres, and milestones — computed fresh every time, nothing stale.
        </p>
      </div>
      <NotificationList notifications={notifications} />
    </div>
  );
}
