import { redirect } from 'next/navigation';
import { requireUser } from '@/lib/auth';

export const dynamic = 'force-dynamic';

export default async function OwnProfilePage() {
  const user = await requireUser();
  redirect(`/next/profile/${user.id}`);
}
