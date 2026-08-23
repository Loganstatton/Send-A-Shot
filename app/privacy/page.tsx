export const metadata = { title: 'Privacy Policy' };

export default function PrivacyPage() {
  return (
    <div className="max-w-2xl mx-auto card space-y-4 text-sm leading-relaxed text-neutral-300">
      <h1 className="text-xl font-semibold text-neutral-100">Privacy Policy</h1>
      <p className="text-xs text-neutral-500">Beta version — last updated {new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' })}.</p>

      <section className="space-y-2">
        <h2 className="font-semibold text-neutral-100">What we collect</h2>
        <p>When you create an account, we store your name, email address, and a securely hashed password (we never store your password in plain text). We also store your activity within the app — trades, Watchlist entries, and balances — so the product works.</p>
      </section>

      <section className="space-y-2">
        <h2 className="font-semibold text-neutral-100">How we use it</h2>
        <p>Your account information and activity are used to run NEXT: to keep you logged in, show your portfolio and trade history, rank the Leaderboard, and send account-related emails (like email verification and password resets). We don't sell your personal information.</p>
      </section>

      <section className="space-y-2">
        <h2 className="font-semibold text-neutral-100">Third-party services</h2>
        <p>We use third-party services to power parts of the app — for example, sending transactional emails, and pulling public artist data from services like Soundcharts, Deezer, and YouTube. These services may process limited data (like your email address, for delivery) as needed to provide that function.</p>
      </section>

      <section className="space-y-2">
        <h2 className="font-semibold text-neutral-100">What's public</h2>
        <p>Your display name and trading activity used for the Leaderboard and public profile pages are visible to other NEXT users. Your email address is never shown publicly.</p>
      </section>

      <section className="space-y-2">
        <h2 className="font-semibold text-neutral-100">Your data, your control</h2>
        <p>You can edit your name and avatar at any time from Settings. You can permanently delete your account and its associated NEXT activity (holdings, trade history, Watchlist) from Settings as well — this can't be undone.</p>
      </section>

      <section className="space-y-2">
        <h2 className="font-semibold text-neutral-100">Beta status</h2>
        <p>NEXT is in active development, and this policy may be updated as the product changes. We'll keep this page current — check the "last updated" date above.</p>
      </section>

      <p className="text-xs text-neutral-500">See also our <a href="/terms" className="underline">Terms of Service</a>.</p>
    </div>
  );
}
