import { recommendation } from '@/lib/scoring';

const TONE_STYLE: Record<string, { background: string; borderColor: string; color: string }> = {
  fire: { background: 'var(--fire-dim)', borderColor: 'var(--fire-line)', color: 'var(--fire)' },
  watch: { background: 'var(--accent-dim)', borderColor: 'var(--accent-line)', color: 'var(--accent)' },
  monitor: { background: 'var(--surface-2)', borderColor: 'var(--border)', color: 'var(--text-muted)' },
  pass: { background: 'var(--surface-2)', borderColor: 'var(--border-soft)', color: 'var(--text-faint)' },
};

export default function ScoreBadge({ score, size = 'md' }: { score: number; size?: 'sm' | 'md' | 'lg' }) {
  const rec = recommendation(score);
  const sizeClasses = size === 'lg' ? 'text-3xl px-4 py-2' : size === 'sm' ? 'text-xs px-2 py-0.5' : 'text-sm px-3 py-1';
  return (
    <span className={`inline-flex items-center gap-2 rounded-md border font-semibold ${sizeClasses}`} style={TONE_STYLE[rec.tone]}>
      <span>{rec.emoji}</span>
      <span className="num">{score.toFixed(1)}</span>
      {size !== 'sm' && <span className="font-normal opacity-80">{rec.label}</span>}
    </span>
  );
}
