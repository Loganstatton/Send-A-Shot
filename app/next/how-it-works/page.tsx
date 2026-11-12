import Link from 'next/link';
import type { Metadata } from 'next';
import { SCORE_LABELS, SCORE_WEIGHTS, ScoreInputs } from '@/lib/types';
import { formatCents } from '@/lib/format';
import {
  NEXT_MIN_PRICE_CENTS, NEXT_STARTING_CREDITS_CENTS, SCOUT_GAP_EXPLAINER, nextBasePriceCents, priceImpactPct,
} from '@/lib/next-market';
import { TRADE_RATE_LIMIT_PER_MINUTE } from '@/lib/db';
import { getFoundingBelieverTier } from '@/lib/founding-believer';
import { STREAK_MIN } from '@/lib/challenges';
import { EARLY_DISCOVERY_RANK_THRESHOLD } from '@/lib/scout-score';

export const metadata: Metadata = {
  title: 'How NEXT works',
  description: 'How the NEXT Score, NEXT Price, Founding Believer records and leaderboards are calculated — and what NEXT does not measure yet.',
};

// Every number on this page is computed from the same constants the app
// itself uses (score weights, pricing formula, impact rate, tier bands), so
// the explanation can't drift from what the code actually does.
const CATEGORIES = Object.keys(SCORE_WEIGHTS) as (keyof ScoreInputs)[];
const IMPACT_EXAMPLE_CENTS = 100_000; // $1,000

function Section({ id, title, children }: { id: string; title: string; children: React.ReactNode }) {
  return (
    <section id={id} aria-labelledby={`${id}-title`} className="next-card p-6 sm:p-7 flex flex-col gap-3 scroll-mt-6">
      <h2 id={`${id}-title`} className="font-display font-bold text-xl m-0">{title}</h2>
      <div className="flex flex-col gap-3 text-[14.5px] leading-relaxed" style={{ color: 'var(--text-muted)' }}>{children}</div>
    </section>
  );
}

export default function HowItWorksPage() {
  const tierBands = [1, 2, 11, 51].map((rank) => ({ rank, tier: getFoundingBelieverTier(rank) }));
  const tierRange = ['#1', '#2–10', '#11–50', '#51 and later'];

  return (
    <div className="flex flex-col gap-6 max-w-[780px] mx-auto">
      <div className="flex flex-col gap-3">
        <h1 className="font-display font-bold text-[32px] sm:text-[38px] leading-[1.1] tracking-[-0.01em] m-0">How NEXT works</h1>
        <p className="m-0 text-base leading-relaxed" style={{ color: 'var(--text-muted)' }}>
          NEXT is a free game about finding emerging artists early. This page explains exactly how every number in it is
          worked out — and what it doesn&apos;t measure.
        </p>
        <nav aria-label="On this page" className="flex flex-wrap gap-2 text-[13px]">
          {[['score', 'NEXT Score'], ['price', 'NEXT Price'], ['gap', 'Scouts vs. market'], ['proof', 'Founding Believer'], ['ranks', 'Leaderboards'], ['challenges', 'Challenges'], ['fair', 'Fair play'], ['limits', "What NEXT doesn't measure"]].map(([id, label]) => (
            <a key={id} href={`#${id}`} className="next-pill">{label}</a>
          ))}
        </nav>
      </div>

      <Section id="credits" title="Virtual credits, not money">
        <p className="m-0">
          Every account starts with <strong style={{ color: 'var(--text)' }}>{formatCents(NEXT_STARTING_CREDITS_CENTS)}</strong> in
          NEXT Credits. Credits are virtual: they can&apos;t be bought, sold, transferred or cashed out, and they have no monetary
          value. Backing an artist on NEXT doesn&apos;t give you any share of their music, royalties or earnings, and nothing on
          NEXT is investment advice.
        </p>
      </Section>

      <Section id="score" title="NEXT Score — our Scouts' rating">
        <p className="m-0">
          The NEXT Score (0–100) is a <strong style={{ color: 'var(--text)' }}>human rating</strong>. A Scout rates each artist from 0 to 10 in
          eight categories; the Score is the weighted total. It is not calculated automatically from streaming or social
          data.
        </p>
        <div className="overflow-x-auto">
          <table className="w-full text-sm" style={{ borderCollapse: 'collapse' }}>
            <caption className="sr-only">Score categories and their weights</caption>
            <thead>
              <tr className="text-left" style={{ color: 'var(--text-faint)' }}>
                <th scope="col" className="font-normal pb-2">Category</th>
                <th scope="col" className="font-normal pb-2 text-right">Weight</th>
              </tr>
            </thead>
            <tbody>
              {CATEGORIES.map((c) => (
                <tr key={c} style={{ borderTop: '1px solid var(--border-soft)' }}>
                  <td className="py-2" style={{ color: 'var(--text)' }}>{SCORE_LABELS[c]}</td>
                  <td className="py-2 text-right num">{SCORE_WEIGHTS[c]}%</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="m-0">
          Example: an artist rated 8/10 in every category scores 80. Ratings are revisited as an artist develops, and each
          artist&apos;s page charts its Score history so you can see when it changed. &ldquo;Audience Growth Velocity&rdquo; and
          &ldquo;Engagement Quality&rdquo; are the Scout&apos;s judgment of those things too, not live measurements.
        </p>
      </Section>

      <Section id="price" title="NEXT Price — what players are paying">
        <p className="m-0">
          When an artist joins NEXT, their starting price is set from their Score — between {formatCents(nextBasePriceCents(0))} and{' '}
          {formatCents(nextBasePriceCents(100))}, curved so stronger Scores start higher (a Score of 80 starts at{' '}
          {formatCents(nextBasePriceCents(80))}). After that, <strong style={{ color: 'var(--text)' }}>only trades move the price</strong>.
        </p>
        <p className="m-0">
          Every {formatCents(IMPACT_EXAMPLE_CENTS)} of credits spent backing an artist moves their price up about{' '}
          {(priceImpactPct(IMPACT_EXAMPLE_CENTS) * 100).toFixed(1)}%; selling moves it down the same way. The price never goes
          below {formatCents(NEXT_MIN_PRICE_CENTS)}.
        </p>
        <p className="m-0">
          You pay the average of the price before and after your own trade, not the lower starting price. That means you
          can&apos;t profit just by moving the price yourself: buying and immediately selling always costs a little, like a
          spread.
        </p>
      </Section>

      <Section id="gap" title="Scouts vs. market">
        <p className="m-0">{SCOUT_GAP_EXPLAINER}</p>
        <p className="m-0">
          You&apos;ll see this as &ldquo;Scouts rate higher&rdquo; (the Score is ahead of what the price implies),
          &ldquo;Market ahead of Scouts&rdquo; (the price is ahead of the Score) or &ldquo;In line&rdquo;. Gaps smaller than a few points
          aren&apos;t shown.
        </p>
      </Section>

      <Section id="proof" title="Founding Believer — your proof you were early">
        <p className="m-0">
          The first time you back an artist, NEXT permanently records your backer number, the date and time, and the
          artist&apos;s Score and Price at that moment. That record never changes afterwards — not if you sell, not if the
          artist changes, and not by anyone at NEXT. You can share it as a public link with its own preview card.
        </p>
        <ul className="m-0 pl-5 flex flex-col gap-1">
          {tierBands.map(({ tier }, i) => (
            <li key={tier.key}><strong style={{ color: 'var(--text)' }}>{tier.label}</strong> — backer {tierRange[i]}</li>
          ))}
        </ul>
        <p className="m-0">
          Each player&apos;s profile shows a <strong style={{ color: 'var(--text)' }}>track record</strong> built from these records: how
          many of their picks are priced higher on NEXT now than when they backed them, the typical (median) price change, and how
          many people backed those artists afterwards. It&apos;s measured on NEXT only, not in the real world.
        </p>
      </Section>

      <Section id="ranks" title="Leaderboards">
        <p className="m-0">
          <strong style={{ color: 'var(--text)' }}>Top Scouts</strong> ranks players by the return on their virtual portfolio
          (credits plus what their holdings would actually sell for right now, not the quoted price), with ties broken by how
          many artists they&apos;ve backed. Players who haven&apos;t backed anyone aren&apos;t ranked.
        </p>
        <p className="m-0">
          <strong style={{ color: 'var(--text)' }}>Top Discoverers</strong> ranks players by artists they suggested that our Scouts
          then added to NEXT — finding someone before they were on NEXT at all. Genre boards rank by profit made on that
          genre&apos;s artists.
        </p>
        <p className="m-0">
          <strong style={{ color: 'var(--text)' }}>Private leagues</strong> rank just you and the friends you invite, by portfolio
          return since each person joined the league — so someone who joins late starts level instead of behind. Only
          members can see a league&apos;s standings; anyone with its invite link can see its name and size.
        </p>
      </Section>

      <Section id="challenges" title="Weekly challenges">
        <p className="m-0">
          Five challenges reset every Monday at 00:00 UTC: be one of the first {EARLY_DISCOVERY_RANK_THRESHOLD} backers of an artist,
          back a genre you&apos;ve never backed, back an artist while Scouts rate them higher than the market, listen to previews from
          five different artists, and get someone to join a league you run. Finish {STREAK_MIN} in a week to extend your streak.
          They&apos;re counted from your activity on NEXT, and there are no prizes.
        </p>
      </Section>

      <Section id="fair" title="Fair play">
        <ul className="m-0 pl-5 flex flex-col gap-1">
          <li>One account per person. Signing up again with an email alias (like name+1@…) is blocked.</li>
          <li>A repeated or double-clicked trade is only ever carried out once, and you can make at most {TRADE_RATE_LIMIT_PER_MINUTE} trades a minute.</li>
          <li>Patterns that look like manipulation — rapid back-and-forth trading, or accounts that consistently trade the same artists together — are flagged for a person at NEXT to review.</li>
          <li>Artists can&apos;t pay for a higher Score or a better position on NEXT.</li>
        </ul>
      </Section>

      <Section id="limits" title="What NEXT doesn't measure (yet)">
        <p className="m-0">
          NEXT doesn&apos;t currently show live, independently verified audience numbers — streams, monthly listeners or
          follower growth. Where an artist page mentions followers, that&apos;s a figure recorded by a Scout, not a live feed.
          We&apos;d rather tell you that than show numbers we can&apos;t stand behind; verified growth data will be labelled
          with its source and date when it arrives.
        </p>
      </Section>

      <div className="flex gap-3 flex-wrap">
        <Link href="/next" className="next-btn-primary px-5 py-2.5 rounded-[10px] text-sm font-semibold">Discover artists</Link>
        <Link href="/terms" className="next-btn-ghost px-5 py-2.5 rounded-[10px] text-sm">Terms</Link>
        <Link href="/privacy" className="next-btn-ghost px-5 py-2.5 rounded-[10px] text-sm">Privacy</Link>
      </div>
    </div>
  );
}
