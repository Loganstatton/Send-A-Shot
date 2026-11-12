import SettingsForm from '@/components/SettingsForm';
import { requireUser } from '@/lib/auth';
import { getGenreOptions, getGenrePrefs } from '@/lib/genre-prefs';

export const metadata = { title: 'Settings' };
export const dynamic = 'force-dynamic';

export default async function SettingsPage() {
  const user = await requireUser();
  const [genreOptions, genrePrefs] = await Promise.all([getGenreOptions(), getGenrePrefs(user.id)]);
  return <SettingsForm user={user} genreOptions={genreOptions} genrePrefs={genrePrefs} />;
}
