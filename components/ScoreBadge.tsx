import { recommendation } from '@/lib/scoring';

const TONE_CLASSES: Record<string, string> = {
  fire: 'bg-red-500/20 border-red-500/40 text-red-300',
  watch: 'bg-amber-500/20 border-amber-500/40 text-amber-300',
  monitor: 'bg-sky-500/20 border-sky-500/40 text-sky-300',
  pass: 'bg-neutral-500/20 border-neutral-500/40 text-neutral-400',
};

export default function ScoreBadge({ score, size = 'md' }: { score: number; size?: 'sm' | 'md' | 'lg' }) {
  const rec = recommendation(score);
  const sizeClasses = size === 'lg' ? 'text-3xl px-4 py-2' : size === 'sm' ? 'text-xs px-2 py-0.5' : 'text-sm px-3 py-1';
  return (
    <span className={`inline-flex items-center gap-2 rounded-lg border font-semibold ${TONE_CLASSES[rec.tone]} ${sizeClasses}`}>
      <span>{rec.emoji}</span>
      <span>{score.toFixed(1)}</span>
      {size !== 'sm' && <span className="font-normal opacity-80">{rec.label}</span>}
    </span>
  );
}
