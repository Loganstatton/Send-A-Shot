export function formatCents(cents: number | null | undefined): string {
  if (cents == null) return '—';
  return (cents / 100).toLocaleString('en-US', { style: 'currency', currency: 'USD' });
}

export function dollarsToCents(dollars: number): number {
  return Math.round(dollars * 100);
}
