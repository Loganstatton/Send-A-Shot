import SettingsForm from '@/components/SettingsForm';
import { requireUser } from '@/lib/auth';

export const metadata = { title: 'Settings' };
export const dynamic = 'force-dynamic';

export default async function SettingsPage() {
  const user = await requireUser();
  return <SettingsForm user={user} />;
}
