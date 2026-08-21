import { MarketSentiment } from '@/lib/next-market';

const TONE_CLASSES: Record<MarketSentiment['tone'], string> = {
  undervalued: 'bg-emerald-500/20 border-emerald-500/40 text-emerald-300',
  overheated: 'bg-red-500/20 border-red-500/40 text-red-300',
  fair: 'bg-neutral-500/20 border-neutral-500/40 text-neutral-400',
};

const TONE_DOT: Record<MarketSentiment['tone'], string> = {
  undervalued: '🟢',
  overheated: '🔴',
  fair: '⚪',
};

// NEXT's headline idea made literal: NEXT Score vs. the score the current
// price implies. A big enough gap is the buy/hold/sell-equivalent signal.
export default function SentimentBadge({ sentiment, size = 'md' }: { sentiment: MarketSentiment; size?: 'sm' | 'md' }) {
  const sizeClasses = size === 'sm' ? 'text-xs px-2 py-0.5' : 'text-sm px-3 py-1';
  const pct = Math.round(Math.abs(sentiment.diff));
  return (
    <span className={`inline-flex items-center gap-1.5 rounded-lg border font-semibold ${TONE_CLASSES[sentiment.tone]} ${sizeClasses}`}>
      <span>{TONE_DOT[sentiment.tone]}</span>
      <span>{sentiment.label}</span>
      {sentiment.tone !== 'fair' && <span className="font-normal opacity-80">{sentiment.tone === 'undervalued' ? '+' : '-'}{pct}</span>}
    </span>
  );
}
