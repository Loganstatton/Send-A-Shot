export const metadata = { title: 'Privacy Policy' };

// A fixed revision date — change it whenever the text changes. (It used
// to print today's date, so it looked freshly updated every day.)
const LAST_UPDATED = 'November 12, 2026';

export default function PrivacyPage() {
  return (
    <div className="max-w-2xl mx-auto card space-y-4 text-sm leading-relaxed text-neutral-300">
      <h1 className="text-xl font-semibold text-neutral-100">Privacy Policy</h1>
      <p className="text-xs text-neutral-400">Beta version — last updated {LAST_UPDATED}.</p>

      <section className="space-y-2">
        <h2 className="font-semibold text-neutral-100">What we collect</h2>
        <p>When you create an account, we store your name, email address, and a securely hashed password (we never store your password in plain text). We also store your activity within the app — trades, Watchlist entries, balances, leagues you join, genres you pick, previews you play, and feedback or reports you send — so the product works.</p>
        <p>We record usage events (for example, which pages were opened) to understand what people use and improve NEXT. When you sign up we note which part of NEXT you signed up from (for example, a league invite) — not who shared it with you.</p>
        <p>To protect accounts from password guessing, we keep a short-lived record of login attempts. The email address and network address in it are stored only as one-way hashes and deleted after about a day.</p>
      </section>

      <section className="space-y-2">
        <h2 className="font-semibold text-neutral-100">How we use it</h2>
        <p>Your account information and activity are used to run NEXT: to keep you logged in, show your portfolio and trade history, rank the Leaderboard, and send account-related emails (like email verification and password resets). We don't sell your personal information.</p>
      </section>

      <section className="space-y-2">
        <h2 className="font-semibold text-neutral-100">Third-party services</h2>
        <p>We use third-party services to power parts of the app — for example, sending transactional emails, and pulling public artist data from free sources like Wikidata and Wikimedia Commons. These services may process limited data (like your email address, for delivery) as needed to provide that function.</p>
      </section>

      <section className="space-y-2">
        <h2 className="font-semibold text-neutral-100">YouTube API Services</h2>
        <p>NEXT uses YouTube API Services to show official artist videos and to help discover artists. By using this feature of NEXT, you are also bound by the <a href="https://www.youtube.com/t/terms" className="underline" target="_blank" rel="noreferrer">YouTube Terms of Service</a>. Google's use of information it receives is governed by the <a href="https://policies.google.com/privacy" className="underline" target="_blank" rel="noreferrer">Google Privacy Policy</a>.</p>
      </section>

      <section className="space-y-2">
        <h2 className="font-semibold text-neutral-100">What's public</h2>
        <p>Your display name, your public profile (Founding Believer records, track record, discovery reputation, Leaderboard standing) and the proof pages you share are visible to anyone, including people who aren&apos;t signed in. Your positions are shown only if you turn that on in Settings. League standings are visible only to that league&apos;s members. Your email address is never shown publicly.</p>
      </section>

      <section className="space-y-2">
        <h2 className="font-semibold text-neutral-100">Your data, your control</h2>
        <p>You can edit your name and avatar at any time from Settings. You can permanently delete your account and its associated NEXT activity (holdings, trade history, Watchlist) from Settings as well — this can't be undone.</p>
      </section>

      <section className="space-y-2">
        <h2 className="font-semibold text-neutral-100">Beta status</h2>
        <p>NEXT is in active development, and this policy may be updated as the product changes. We'll keep this page current — check the "last updated" date above.</p>
      </section>

      <p className="text-xs text-neutral-400">See also our <a href="/terms" className="underline">Terms of Service</a>.</p>
    </div>
  );
}
