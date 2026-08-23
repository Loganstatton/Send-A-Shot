'use client';
import { useEffect, useMemo, useState } from 'react';
import { formatCents, dollarsToCents } from '@/lib/format';
import {
  Agreement, AGREEMENT_TYPE_LABELS,
  INVESTMENT_CATEGORIES, INVESTMENT_CATEGORY_LABELS, InvestmentCategory, InvestmentEntry,
  RevenueEntry,
} from '@/lib/types';

function todayISO() {
  return new Date().toISOString().slice(0, 10);
}

export default function InvestmentLedger({ artistId }: { artistId: number }) {
  const [entries, setEntries] = useState<InvestmentEntry[] | null>(null);
  const [revenue, setRevenue] = useState<RevenueEntry[] | null>(null);
  const [agreements, setAgreements] = useState<Agreement[] | null>(null);

  const [showForm, setShowForm] = useState(false);
  const [date, setDate] = useState(todayISO());
  const [category, setCategory] = useState<InvestmentCategory>('marketing');
  const [dollars, setDollars] = useState('');
  const [agreementId, setAgreementId] = useState('');
  const [notes, setNotes] = useState('');
  const [saving, setSaving] = useState(false);

  async function loadEntries() {
    const res = await fetch(`/api/artists/${artistId}/investments`);
    setEntries(await res.json());
  }
  async function loadRevenue() {
    const res = await fetch(`/api/artists/${artistId}/revenue`);
    setRevenue(await res.json());
  }
  async function loadAgreements() {
    const res = await fetch(`/api/artists/${artistId}/agreements`);
    setAgreements(await res.json());
  }

  useEffect(() => {
    loadEntries();
    loadRevenue();
    loadAgreements();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [artistId]);

  const totalInvested = useMemo(
    () => (entries ?? []).reduce((sum, e) => sum + e.amount_cents, 0),
    [entries]
  );
  const totalRecovered = useMemo(
    () => (revenue ?? []).reduce((sum, r) => sum + (r.commission_amount_cents ?? 0), 0),
    [revenue]
  );
  const roiPct = totalInvested > 0
    ? Math.round(((totalRecovered - totalInvested) / totalInvested) * 1000) / 10
    : null;

  const byCategory = useMemo(() => {
    const totals = new Map<InvestmentCategory, number>();
    for (const e of entries ?? []) {
      totals.set(e.category, (totals.get(e.category) ?? 0) + e.amount_cents);
    }
    return INVESTMENT_CATEGORIES
      .map((c) => ({ category: c, cents: totals.get(c) ?? 0 }))
      .filter((c) => c.cents > 0);
  }, [entries]);

  async function handleAdd(e: React.FormEvent) {
    e.preventDefault();
    if (!dollars) return;
    setSaving(true);
    try {
      await fetch(`/api/artists/${artistId}/investments`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          recorded_at: date,
          category,
          amount_cents: dollarsToCents(Number(dollars)),
          agreement_id: agreementId ? Number(agreementId) : undefined,
          notes: notes || undefined,
        }),
      });
      setDollars('');
      setNotes('');
      await loadEntries();
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete(id: number) {
    await fetch(`/api/artists/${artistId}/investments/${id}`, { method: 'DELETE' });
    await loadEntries();
  }

  return (
    <div className="card space-y-5">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <h2 className="font-bold text-lg">Investment &amp; ROI</h2>
        <div className="num flex gap-4 text-sm flex-wrap" style={{ color: 'var(--text-muted)' }}>
          <span>Invested: <strong style={{ color: 'var(--text)' }}>{formatCents(totalInvested)}</strong></span>
          <span>Recovered: <strong style={{ color: 'var(--text)' }}>{formatCents(totalRecovered)}</strong></span>
          {roiPct != null && (
            <span>ROI: <strong style={{ color: roiPct >= 0 ? 'var(--up)' : 'var(--down)' }}>{roiPct > 0 ? '+' : ''}{roiPct}%</strong></span>
          )}
        </div>
      </div>
      <p className="text-xs -mt-3" style={{ color: 'var(--text-faint)' }}>
        Actual categorized spend (marketing/studio/video/etc), separate from an agreement's negotiated
        investment ceiling. Recovered = commission earned on logged revenue.
      </p>

      {byCategory.length > 0 && (
        <div className="space-y-1.5">
          {byCategory.map(({ category: c, cents }) => {
            const pct = totalInvested > 0 ? Math.round((cents / totalInvested) * 100) : 0;
            return (
              <div key={c} className="flex items-center gap-3 text-sm">
                <span className="w-20 shrink-0" style={{ color: 'var(--text-muted)' }}>{INVESTMENT_CATEGORY_LABELS[c]}</span>
                <div className="flex-1 h-1.5 rounded-full overflow-hidden" style={{ background: 'var(--surface-2)' }}>
                  <div className="h-full" style={{ width: `${pct}%`, background: 'var(--accent)' }} />
                </div>
                <span className="num w-20 shrink-0 text-right" style={{ color: 'var(--text-muted)' }}>{formatCents(cents)}</span>
              </div>
            );
          })}
        </div>
      )}

      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <h3 className="font-medium" style={{ color: 'var(--text-muted)' }}>Spend log</h3>
          <button type="button" className="btn text-sm" onClick={() => setShowForm((s) => !s)}>
            {showForm ? 'Cancel' : '+ Log spend'}
          </button>
        </div>

        {showForm && (
          <form onSubmit={handleAdd} className="space-y-2 rounded-lg p-3" style={{ border: '1px solid var(--border-soft)' }}>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
              <input className="input" type="date" value={date} onChange={(e) => setDate(e.target.value)} required />
              <select className="input" value={category} onChange={(e) => setCategory(e.target.value as InvestmentCategory)}>
                {INVESTMENT_CATEGORIES.map((c) => <option key={c} value={c}>{INVESTMENT_CATEGORY_LABELS[c]}</option>)}
              </select>
              <input className="input" type="number" step="0.01" min="0" placeholder="Amount $" value={dollars} onChange={(e) => setDollars(e.target.value)} required />
              <select className="input" value={agreementId} onChange={(e) => setAgreementId(e.target.value)}>
                <option value="">No agreement link</option>
                {agreements?.map((a) => (
                  <option key={a.id} value={a.id}>{AGREEMENT_TYPE_LABELS[a.type]}</option>
                ))}
              </select>
            </div>
            <textarea className="input min-h-[50px]" placeholder="Notes…" value={notes} onChange={(e) => setNotes(e.target.value)} />
            <button type="submit" className="btn btn-primary" disabled={saving}>
              {saving ? 'Saving…' : 'Log spend'}
            </button>
          </form>
        )}

        {entries?.length === 0 && !showForm && (
          <p className="text-sm" style={{ color: 'var(--text-faint)' }}>No spend logged yet.</p>
        )}

        {entries && entries.length > 0 && (
          <div className="max-h-64 overflow-y-auto text-sm">
            <table className="w-full">
              <thead className="text-left">
                <tr>
                  <th className="font-normal pb-1" style={{ color: 'var(--text-faint)' }}>Date</th>
                  <th className="font-normal pb-1" style={{ color: 'var(--text-faint)' }}>Category</th>
                  <th className="font-normal pb-1 text-right" style={{ color: 'var(--text-faint)' }}>Amount</th>
                  <th className="font-normal pb-1"></th>
                </tr>
              </thead>
              <tbody>
                {entries.map((e) => (
                  <tr key={e.id} style={{ borderTop: '1px solid var(--border-soft)' }}>
                    <td className="num py-1" style={{ color: 'var(--text-muted)' }}>{e.recorded_at}</td>
                    <td className="py-1" style={{ color: 'var(--text-muted)' }}>{INVESTMENT_CATEGORY_LABELS[e.category]}</td>
                    <td className="num py-1 text-right">{formatCents(e.amount_cents)}</td>
                    <td className="py-1 text-right">
                      <button type="button" className="hover:opacity-80" style={{ color: 'var(--text-faint)' }} onClick={() => handleDelete(e.id)} aria-label="Delete entry">✕</button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
