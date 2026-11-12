import SettingsForm from '@/components/SettingsForm';
import { requireUser } from '@/lib/auth';
import { getGenreOptions, getGenrePrefs } from '@/lib/genre-prefs';
import { getMutedArtists } from '@/lib/db';

export const metadata = { title: 'Settings' };
export const dynamic = 'force-dynamic';

export default async function SettingsPage() {
  const user = await requireUser();
  const [genreOptions, genrePrefs, mutedArtists] = await Promise.all([getGenreOptions(), getGenrePrefs(user.id), getMutedArtists(user.id)]);
  return <SettingsForm user={user} genreOptions={genreOptions} genrePrefs={genrePrefs} mutedArtists={mutedArtists} />;
}
