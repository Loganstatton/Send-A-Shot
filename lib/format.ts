export function formatCents(cents: number | null | undefined): string {
  if (cents == null) return '—';
  return (cents / 100).toLocaleString('en-US', { style: 'currency', currency: 'USD' });
}

export function dollarsToCents(dollars: number): number {
  return Math.round(dollars * 100);
}

// "Updated 3 hours ago" — a data-freshness timestamp, not a precise clock.
// Coarsens on purpose: a trader deciding whether to trust a stat cares
// whether it's from today or from three weeks ago, not the exact minute.
export function timeAgo(iso: string): string {
  const diffSec = Math.max(0, (Date.now() - new Date(iso).getTime()) / 1000);
  if (diffSec < 60) return 'just now';
  const diffMin = diffSec / 60;
  if (diffMin < 60) return `${Math.floor(diffMin)} minute${Math.floor(diffMin) === 1 ? '' : 's'} ago`;
  const diffHr = diffMin / 60;
  if (diffHr < 24) return `${Math.floor(diffHr)} hour${Math.floor(diffHr) === 1 ? '' : 's'} ago`;
  const diffDay = diffHr / 24;
  if (diffDay < 30) return `${Math.floor(diffDay)} day${Math.floor(diffDay) === 1 ? '' : 's'} ago`;
  const diffMonth = diffDay / 30;
  if (diffMonth < 12) return `${Math.floor(diffMonth)} month${Math.floor(diffMonth) === 1 ? '' : 's'} ago`;
  return `${Math.floor(diffMonth / 12)} year${Math.floor(diffMonth / 12) === 1 ? '' : 's'} ago`;
}
