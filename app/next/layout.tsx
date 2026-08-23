import { Bricolage_Grotesque, IBM_Plex_Sans, IBM_Plex_Mono } from 'next/font/google';
import './next-theme.css';
import { requireUser } from '@/lib/auth';
import NextHeader from '@/components/next/NextHeader';

// Self-hosted via next/font (no runtime <link> tag, no layout shift) —
// scoped to just the /next/* route group. Scout keeps the default globals.css
// font stack untouched.
const display = Bricolage_Grotesque({ subsets: ['latin'], weight: ['500', '600', '700', '800'], variable: '--font-display' });
const body = IBM_Plex_Sans({ subsets: ['latin'], weight: ['400', '500', '600'], variable: '--font-body' });
const mono = IBM_Plex_Mono({ subsets: ['latin'], weight: ['400', '500'], variable: '--font-mono' });

export default async function NextLayout({ children }: { children: React.ReactNode }) {
  const user = await requireUser();

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
      <NextHeader user={user} />
      <main style={{ maxWidth: 1280, margin: '0 auto', padding: '56px 48px 80px' }}>{children}</main>
    </div>
  );
}
