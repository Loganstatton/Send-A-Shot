import { Bricolage_Grotesque, IBM_Plex_Sans, IBM_Plex_Mono } from 'next/font/google';
import './next-theme.css';
import { getSessionUser } from '@/lib/auth';
import { getArtistsClaimedByUser } from '@/lib/db';
import { NEXT_STARTING_CREDITS_CENTS } from '@/lib/next-market';
import { getNotificationsForUser } from '@/lib/notifications';
import NextHeader from '@/components/next/NextHeader';
import NextOnboarding from '@/components/next/NextOnboarding';
import { ViewerProvider } from '@/lib/viewer-context';
import { getGenreOptions } from '@/lib/genre-prefs';

// Self-hosted via next/font (no runtime <link> tag, no layout shift) —
// scoped to just the /next/* route group. Scout keeps the default globals.css
// font stack untouched.
const display = Bricolage_Grotesque({ subsets: ['latin'], weight: ['500', '600', '700', '800'], variable: '--font-display' });
const body = IBM_Plex_Sans({ subsets: ['latin'], weight: ['400', '500', '600'], variable: '--font-body' });
const mono = IBM_Plex_Mono({ subsets: ['latin'], weight: ['400', '500'], variable: '--font-mono' });

export default async function NextLayout({ children }: { children: React.ReactNode }) {
  // Signed-out visitors can browse Discover, artist pages, the leaderboard,
  // profiles and shared early-proof cards; every other NEXT page checks for
  // a session itself (requireUser) and sends them to log in.
  const user = await getSessionUser();
  const unreadNotifications = user ? (await getNotificationsForUser(user)).filter((n) => !n.read).length : 0;
  const hasClaimedArtist = user ? (await getArtistsClaimedByUser(user.id)).length > 0 : false;
  const showOnboarding = !!user && !user.next_onboarded_at;
  const genreOptions = showOnboarding ? await getGenreOptions() : [];

  return (
    <div
      className={`next-theme next-fullbleed ${display.variable} ${body.variable} ${mono.variable}`}
      style={{
        fontFamily: 'var(--font-body)',
        minHeight: '100vh',
        background:
          'radial-gradient(1100px 520px at 14% -8%, var(--ember-dim), transparent 60%),' +
          'radial-gradient(900px 460px at 96% 6%, oklch(70% 0.14 150 / 0.06), transparent 55%),' +
          'var(--bg)',
      }}
    >
      <NextHeader user={user} unreadNotifications={unreadNotifications} hasClaimedArtist={hasClaimedArtist} />
      {showOnboarding && <NextOnboarding startingCreditsCents={NEXT_STARTING_CREDITS_CENTS} genreOptions={genreOptions} />}
      <ViewerProvider guest={!user}>
        <main className="max-w-[1280px] mx-auto px-5 sm:px-8 md:px-12 py-8 sm:py-14">{children}</main>
      </ViewerProvider>
    </div>
  );
}
