export const metadata = { title: 'Terms of Service' };

export default function TermsPage() {
  return (
    <div className="max-w-2xl mx-auto card space-y-4 text-sm leading-relaxed text-neutral-300">
      <h1 className="text-xl font-semibold text-neutral-100">Terms of Service</h1>
      <p className="text-xs text-neutral-500">Beta version — last updated {new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' })}.</p>

      <section className="space-y-2">
        <h2 className="font-semibold text-neutral-100">1. What NEXT is</h2>
        <p>NEXT is a paper-trading game. You use virtual NEXT Credits to "back" artists based on a NEXT Score and NEXT Price we generate from public and third-party data. Nothing on NEXT involves real money, and no trade on NEXT buys, sells, or represents any real ownership, security, or interest in any artist, their music, or their earnings.</p>
      </section>

      <section className="space-y-2">
        <h2 className="font-semibold text-neutral-100">2. No real money, no cash-out</h2>
        <p>NEXT Credits have no cash value, cannot be purchased with real money, and cannot be redeemed, withdrawn, transferred, or exchanged for real money, cryptocurrency, goods, or services under any circumstance. Any balance, gain, or "return" shown in the app is illustrative only.</p>
      </section>

      <section className="space-y-2">
        <h2 className="font-semibold text-neutral-100">3. Beta status</h2>
        <p>NEXT is under active development. Features, scoring methodology, pricing mechanics, and available artists may change, and your account data (including trade history and balances) may be reset without notice while the product is in beta.</p>
      </section>

      <section className="space-y-2">
        <h2 className="font-semibold text-neutral-100">4. Your account</h2>
        <p>You're responsible for keeping your login credentials secure and for all activity under your account. You must provide accurate information at signup and keep it reasonably current. We may suspend or terminate accounts that violate these terms, abuse the platform, or attempt to manipulate NEXT Price or the Leaderboard.</p>
      </section>

      <section className="space-y-2">
        <h2 className="font-semibold text-neutral-100">5. Artist data</h2>
        <p>NEXT Score, NEXT Price, and artist metrics are generated from a mix of internal research and third-party data sources (including but not limited to Soundcharts, Deezer, and YouTube). We don't guarantee this data is complete, accurate, or up to date, and NEXT Score is not investment advice, professional opinion, or a prediction of any artist's real-world commercial success.</p>
      </section>

      <section className="space-y-2">
        <h2 className="font-semibold text-neutral-100">6. No warranty</h2>
        <p>NEXT is provided "as is," without warranties of any kind. We don't guarantee the app will be uninterrupted, error-free, or permanently available.</p>
      </section>

      <section className="space-y-2">
        <h2 className="font-semibold text-neutral-100">7. Changes</h2>
        <p>We may update these terms as the product evolves. Continued use of NEXT after a change means you accept the updated terms.</p>
      </section>

      <p className="text-xs text-neutral-500">See also our <a href="/privacy" className="underline">Privacy Policy</a>.</p>
    </div>
  );
}
