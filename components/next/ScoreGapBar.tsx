import { MarketSentiment } from '@/lib/next-market';

// The visual form of NEXT's actual headline idea: NEXT Score (where the
// marker sits) vs. the score the current NEXT Price implies (how far the
// track is filled). The gap between them IS the signal — this is meant to
// be the one thing people associate with NEXT, so every place a score and
// a price appear together should use this, not a plain number.
export default function ScoreGapBar({ score, sentiment }: { score: number; sentiment: MarketSentiment }) {
  const fillPct = Math.max(0, Math.min(100, sentiment.impliedScore));
  const markerPct = Math.max(0, Math.min(100, score));
  const toneColor = sentiment.tone === 'undervalued' ? 'var(--ember)' : sentiment.tone === 'overheated' ? 'var(--down)' : 'var(--text-faint)';
  const glow = sentiment.tone === 'undervalued' ? '0 0 6px var(--ember)' : 'none';
  const caption =
    sentiment.tone === 'fair'
      ? 'fair value'
      : `${sentiment.tone === 'undervalued' ? '+' : ''}${Math.round(sentiment.diff)} vs price · ${sentiment.tone}`;

  return (
    <div className="flex flex-col gap-[3px]">
      <div className="relative h-[5px]">
        <div className="absolute inset-0 rounded-[3px] bg-[var(--surface-2)] overflow-hidden">
          <div className="absolute inset-y-0 left-0 rounded-[3px] bg-[var(--text-faint)]" style={{ width: `${fillPct}%` }} />
        </div>
        <div
          className="absolute -top-[2px] -bottom-[2px] w-[3px] rounded-[2px]"
          style={{ left: `${markerPct}%`, background: toneColor, boxShadow: glow }}
        />
      </div>
      <span className="text-[10.5px] font-mono" style={{ color: toneColor }}>{caption}</span>
    </div>
  );
}
