import Link from 'next/link';
import type { PublicScoreChange, ScoreInputs } from '@/lib/types';
import { scoreGroups, scoreStrengths } from '@/lib/scoring-guidelines';

function formatDate(iso: string) {
  return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

// "Why the Score is what it is" — server component. Every part of the
// NEXT Score is a Scout's rating, so it's shown as three plainly labelled
// groups (no colour that would suggest live data), the categories the
// Scout rated as strengths, the Scout's own reasoning, when it was last
// rated, and how the Score has changed. Takes plain values computed
// server-side; the raw per-category ratings are never sent to the browser.
export default function ScoreExplainer({
  ratings, rationale, scoredAt, changes,
}: { ratings: ScoreInputs; rationale?: string | null; scoredAt?: string | null; changes: PublicScoreChange[] }) {
  const groups = scoreGroups(ratings);
  const strengths = scoreStrengths(ratings);
  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-baseline justify-between gap-3 flex-wrap">
        <div className="text-xs uppercase tracking-[0.06em] font-mono" style={{ color: 'var(--text-faint)' }}>Why the Score is what it is</div>
        {scoredAt && <div className="text-xs" style={{ color: 'var(--text-faint)' }}>Last rated {formatDate(scoredAt)}</div>}
      </div>
      <ul className="flex flex-col gap-2.5 list-none p-0 m-0">
        {groups.map((g) => (
          <li key={g.key} className="flex items-center gap-3" title={g.categories.join(', ')}>
            <div className="w-[88px] shrink-0 text-[12.5px]" style={{ color: 'var(--text-muted)' }}>{g.label}</div>
            <div
              className="flex-1 h-[6px] rounded-full overflow-hidden"
              style={{ background: 'var(--surface-2)' }}
              role="img"
              aria-label={`${g.label}: ${g.points.toFixed(0)} of ${g.maxPoints} points`}
            >
              <div className="h-full rounded-full" style={{ width: `${(g.points / g.maxPoints) * 100}%`, background: 'var(--ember)' }} />
            </div>
            <div className="num text-[12.5px] w-16 text-right shrink-0" aria-hidden="true">
              <span className="font-semibold" style={{ color: 'var(--text)' }}>{g.points.toFixed(0)}</span>
              <span style={{ color: 'var(--text-faint)' }}> / {g.maxPoints}</span>
            </div>
          </li>
        ))}
      </ul>
      <p className="m-0 text-[12px] leading-relaxed" style={{ color: 'var(--text-faint)' }}>
        Music = talent and response to their own songs. Audience = growth and engagement as judged by the Scout. Artist = brand,
        consistency, commercial potential and professionalism. All eight are a Scout&apos;s ratings against{' '}
        <Link href="/next/how-it-works#score" className="underline underline-offset-2">written guidelines</Link> — not live
        streaming or social data.
      </p>
      {strengths.length > 0 && (
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-xs" style={{ color: 'var(--text-faint)' }}>Rated strengths:</span>
          {strengths.map((s) => <span key={s} className="next-pill text-[11px]" style={{ padding: '3px 10px' }}>{s}</span>)}
        </div>
      )}
      {rationale?.trim() && (
        <blockquote className="m-0 pl-3 text-[13.5px] leading-relaxed" style={{ borderLeft: '2px solid var(--ember-line)', color: 'var(--text-muted)' }}>
          <span className="block text-[11px] font-mono uppercase tracking-[0.06em] mb-1" style={{ color: 'var(--text-faint)' }}>Scout&apos;s notes</span>
          {rationale.trim()}
        </blockquote>
      )}
      {changes.length > 1 && (
        <details className="text-[12.5px]" style={{ color: 'var(--text-muted)' }}>
          <summary className="cursor-pointer" style={{ color: 'var(--text-faint)' }}>Score history ({changes.length} ratings)</summary>
          <ol className="mt-2 flex flex-col gap-1.5 list-none p-0 m-0">
            {changes.map((c) => (
              <li key={c.recorded_at}>
                <span className="num">{formatDate(c.recorded_at)}</span>
                {' — '}
                {c.from == null ? <>first rated <span className="num">{c.to.toFixed(0)}</span></> : (
                  <>
                    <span className="num">{c.from.toFixed(0)}</span> → <span className="num">{c.to.toFixed(0)}</span>
                  </>
                )}
                {c.rationale && <span style={{ color: 'var(--text-faint)' }}> · {c.rationale}</span>}
              </li>
            ))}
          </ol>
        </details>
      )}
    </div>
  );
}
