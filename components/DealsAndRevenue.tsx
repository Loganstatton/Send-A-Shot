'use client';
import { useEffect, useMemo, useState } from 'react';
import { formatCents, dollarsToCents } from '@/lib/format';
import {
  AGREEMENT_STATUS_LABELS, AGREEMENT_STATUSES, AGREEMENT_TYPE_LABELS, AGREEMENT_TYPES,
  Agreement, AgreementInput, AgreementStatus, AgreementType,
  MASTERS_OWNER_LABELS, MASTERS_OWNERS, MastersOwner,
  REVENUE_SOURCE_LABELS, REVENUE_SOURCES, RevenueEntry, RevenueSource,
} from '@/lib/types';

const STATUS_STYLE: Record<AgreementStatus, React.CSSProperties> = {
  draft: { background: 'var(--surface-2)', borderColor: 'var(--border)', color: 'var(--text-muted)' },
  active: { background: 'var(--up-dim)', borderColor: 'var(--up)', color: 'var(--up)' },
  completed: { background: 'var(--accent-dim)', borderColor: 'var(--accent-line)', color: 'var(--accent)' },
  terminated: { background: 'var(--down-dim)', borderColor: 'var(--down)', color: 'var(--down)' },
};

function todayISO() {
  return new Date().toISOString().slice(0, 10);
}

// Whole-month term between two ISO dates (e.g. Jan 2026 -> Jan 2028 is 24
// months), floored at 1 so a same-day range still reads as "1 month"
// instead of "0 months".
function termMonths(start?: string, end?: string): number | null {
  if (!start || !end) return null;
  const s = new Date(start);
  const e = new Date(end);
  let months = (e.getFullYear() - s.getFullYear()) * 12 + (e.getMonth() - s.getMonth());
  if (e.getDate() < s.getDate()) months -= 1;
  return Math.max(1, months);
}

export default function DealsAndRevenue({ artistId }: { artistId: number }) {
  const [agreements, setAgreements] = useState<Agreement[] | null>(null);
  const [revenue, setRevenue] = useState<RevenueEntry[] | null>(null);

  const [showAgreementForm, setShowAgreementForm] = useState(false);
  const [agreementType, setAgreementType] = useState<AgreementType>('development');
  const [agreementStatus, setAgreementStatus] = useState<AgreementStatus>('draft');
  const [commissionPct, setCommissionPct] = useState('15');
  const [sponsorshipPct, setSponsorshipPct] = useState('');
  const [touringPct, setTouringPct] = useState('');
  const [mastersOwnedBy, setMastersOwnedBy] = useState<MastersOwner | ''>('');
  const [investmentDollars, setInvestmentDollars] = useState('');
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [agreementNotes, setAgreementNotes] = useState('');
  const [savingAgreement, setSavingAgreement] = useState(false);

  const [showRevenueForm, setShowRevenueForm] = useState(false);
  const [revenueAgreementId, setRevenueAgreementId] = useState<string>('');
  const [revenueDate, setRevenueDate] = useState(todayISO());
  const [revenueSource, setRevenueSource] = useState<RevenueSource>('streaming');
  const [grossDollars, setGrossDollars] = useState('');
  const [revenueNotes, setRevenueNotes] = useState('');
  const [savingRevenue, setSavingRevenue] = useState(false);

  async function loadAgreements() {
    const res = await fetch(`/api/artists/${artistId}/agreements`);
    setAgreements(await res.json());
  }
  async function loadRevenue() {
    const res = await fetch(`/api/artists/${artistId}/revenue`);
    setRevenue(await res.json());
  }

  useEffect(() => {
    loadAgreements();
    loadRevenue();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [artistId]);

  const totals = useMemo(() => {
    const gross = (revenue ?? []).reduce((sum, r) => sum + r.gross_amount_cents, 0);
    const commission = (revenue ?? []).reduce((sum, r) => sum + (r.commission_amount_cents ?? 0), 0);
    return { gross, commission };
  }, [revenue]);

  function recoupFor(agreement: Agreement) {
    if (!agreement.investment_amount_cents) return null;
    const earned = (revenue ?? [])
      .filter((r) => r.agreement_id === agreement.id)
      .reduce((sum, r) => sum + (r.commission_amount_cents ?? 0), 0);
    const pct = Math.min(100, Math.round((earned / agreement.investment_amount_cents) * 100));
    return { earned, pct };
  }

  async function handleAddAgreement(e: React.FormEvent) {
    e.preventDefault();
    setSavingAgreement(true);
    try {
      const body: AgreementInput = {
        type: agreementType,
        status: agreementStatus,
        commission_pct: commissionPct ? Number(commissionPct) : undefined,
        sponsorship_commission_pct: sponsorshipPct ? Number(sponsorshipPct) : undefined,
        touring_commission_pct: touringPct ? Number(touringPct) : undefined,
        masters_owned_by: mastersOwnedBy || undefined,
        investment_amount_cents: investmentDollars ? dollarsToCents(Number(investmentDollars)) : undefined,
        start_date: startDate || undefined,
        end_date: endDate || undefined,
        notes: agreementNotes || undefined,
      };
      await fetch(`/api/artists/${artistId}/agreements`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      setShowAgreementForm(false);
      setCommissionPct('15');
      setSponsorshipPct('');
      setTouringPct('');
      setMastersOwnedBy('');
      setInvestmentDollars('');
      setStartDate('');
      setEndDate('');
      setAgreementNotes('');
      await loadAgreements();
    } finally {
      setSavingAgreement(false);
    }
  }

  async function handleDeleteAgreement(id: number) {
    if (!confirm('Delete this agreement? Revenue entries linked to it will keep their recorded numbers but lose the link.')) return;
    await fetch(`/api/artists/${artistId}/agreements/${id}`, { method: 'DELETE' });
    await Promise.all([loadAgreements(), loadRevenue()]);
  }

  async function handleAddRevenue(e: React.FormEvent) {
    e.preventDefault();
    if (!grossDollars) return;
    setSavingRevenue(true);
    try {
      await fetch(`/api/artists/${artistId}/revenue`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          agreement_id: revenueAgreementId ? Number(revenueAgreementId) : undefined,
          recorded_at: revenueDate,
          source: revenueSource,
          gross_amount_cents: dollarsToCents(Number(grossDollars)),
          notes: revenueNotes || undefined,
        }),
      });
      setShowRevenueForm(false);
      setGrossDollars('');
      setRevenueNotes('');
      await loadRevenue();
    } finally {
      setSavingRevenue(false);
    }
  }

  async function handleDeleteRevenue(id: number) {
    await fetch(`/api/artists/${artistId}/revenue/${id}`, { method: 'DELETE' });
    await loadRevenue();
  }

  return (
    <div className="card space-y-5">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <h2 className="font-bold text-lg">Deals &amp; revenue</h2>
        <div className="num flex gap-4 text-sm" style={{ color: 'var(--text-muted)' }}>
          <span>Gross tracked: <strong style={{ color: 'var(--text)' }}>{formatCents(totals.gross)}</strong></span>
          <span>Commission earned: <strong style={{ color: 'var(--text)' }}>{formatCents(totals.commission)}</strong></span>
        </div>
      </div>
      <p className="text-xs -mt-3" style={{ color: 'var(--text-faint)' }}>
        This is a ledger of negotiated terms and logged revenue, not an accounting system — real
        payout splits are whatever the actual contract says.
      </p>

      {/* Agreements */}
      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <h3 className="font-medium" style={{ color: 'var(--text-muted)' }}>Agreements</h3>
          <button type="button" className="btn text-sm" onClick={() => setShowAgreementForm((s) => !s)}>
            {showAgreementForm ? 'Cancel' : '+ Add agreement'}
          </button>
        </div>

        {showAgreementForm && (
          <form onSubmit={handleAddAgreement} className="space-y-2 rounded-lg p-3" style={{ border: '1px solid var(--border-soft)' }}>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
              <select className="input" value={agreementType} onChange={(e) => setAgreementType(e.target.value as AgreementType)}>
                {AGREEMENT_TYPES.map((t) => <option key={t} value={t}>{AGREEMENT_TYPE_LABELS[t]}</option>)}
              </select>
              <select className="input" value={agreementStatus} onChange={(e) => setAgreementStatus(e.target.value as AgreementStatus)}>
                {AGREEMENT_STATUSES.map((s) => <option key={s} value={s}>{AGREEMENT_STATUS_LABELS[s]}</option>)}
              </select>
              <input className="input" type="number" step="0.1" min="0" max="100" placeholder="Commission %" value={commissionPct} onChange={(e) => setCommissionPct(e.target.value)} />
              <input className="input" type="number" step="0.01" min="0" placeholder="Investment $" value={investmentDollars} onChange={(e) => setInvestmentDollars(e.target.value)} />
            </div>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
              <input className="input" type="number" step="0.1" min="0" max="100" placeholder="Sponsorship % (if different)" value={sponsorshipPct} onChange={(e) => setSponsorshipPct(e.target.value)} />
              <input className="input" type="number" step="0.1" min="0" max="100" placeholder="Touring % (if different)" value={touringPct} onChange={(e) => setTouringPct(e.target.value)} />
              <select className="input" value={mastersOwnedBy} onChange={(e) => setMastersOwnedBy(e.target.value as MastersOwner | '')}>
                <option value="">Masters owned by…</option>
                {MASTERS_OWNERS.map((m) => <option key={m} value={m}>{MASTERS_OWNER_LABELS[m]}</option>)}
              </select>
            </div>
            <div className="grid grid-cols-2 gap-2">
              <div>
                <label className="label">Start date</label>
                <input className="input" type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} />
              </div>
              <div>
                <label className="label">End date</label>
                <input className="input" type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} />
              </div>
            </div>
            <textarea className="input min-h-[60px]" placeholder="Terms, notes…" value={agreementNotes} onChange={(e) => setAgreementNotes(e.target.value)} />
            <button type="submit" className="btn btn-primary" disabled={savingAgreement}>
              {savingAgreement ? 'Saving…' : 'Save agreement'}
            </button>
          </form>
        )}

        {agreements?.length === 0 && !showAgreementForm && (
          <p className="text-sm" style={{ color: 'var(--text-faint)' }}>No agreements yet.</p>
        )}

        {agreements?.map((a) => {
          const recoup = recoupFor(a);
          const term = termMonths(a.start_date, a.end_date);
          return (
            <div key={a.id} className="pt-2 flex items-start justify-between gap-3" style={{ borderTop: '1px solid var(--border-soft)' }}>
              <div className="min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="font-medium">{AGREEMENT_TYPE_LABELS[a.type]}</span>
                  <span className="badge" style={STATUS_STYLE[a.status]}>{AGREEMENT_STATUS_LABELS[a.status]}</span>
                  {a.commission_pct != null && <span className="num text-xs" style={{ color: 'var(--text-faint)' }}>{a.commission_pct}% commission</span>}
                </div>
                <div className="num text-xs mt-1 flex gap-3 flex-wrap" style={{ color: 'var(--text-faint)' }}>
                  {a.investment_amount_cents != null && <span>Investment: {formatCents(a.investment_amount_cents)}</span>}
                  {a.start_date && <span>Start {a.start_date}</span>}
                  {a.end_date && <span>End {a.end_date}</span>}
                  {term != null && <span>Term: {term} {term === 1 ? 'month' : 'months'}</span>}
                  {a.created_by_name && <span>by {a.created_by_name}</span>}
                </div>
                {(a.sponsorship_commission_pct != null || a.touring_commission_pct != null || a.masters_owned_by) && (
                  <div className="num text-xs mt-1 flex gap-3 flex-wrap" style={{ color: 'var(--text-faint)' }}>
                    <span>Sponsorship: {a.sponsorship_commission_pct != null ? `${a.sponsorship_commission_pct}%` : 'same as commission'}</span>
                    <span>Touring: {a.touring_commission_pct != null ? `${a.touring_commission_pct}%` : 'same as commission'}</span>
                    {a.masters_owned_by && <span>Masters: {MASTERS_OWNER_LABELS[a.masters_owned_by]}</span>}
                  </div>
                )}
                {recoup && (
                  <div className="num mt-1 text-xs" style={{ color: 'var(--text-muted)' }}>
                    Recouped {formatCents(recoup.earned)} of {formatCents(a.investment_amount_cents)} ({recoup.pct}%)
                    <div className="w-full max-w-[200px] h-1.5 rounded-full mt-1 overflow-hidden" style={{ background: 'var(--surface-2)' }}>
                      <div className="h-full" style={{ width: `${recoup.pct}%`, background: 'var(--up)' }} />
                    </div>
                  </div>
                )}
                {a.notes && <p className="text-sm mt-1" style={{ color: 'var(--text-muted)' }}>{a.notes}</p>}
              </div>
              <button type="button" className="text-sm shrink-0 hover:opacity-80" style={{ color: 'var(--text-faint)' }} onClick={() => handleDeleteAgreement(a.id)} aria-label="Delete agreement">✕</button>
            </div>
          );
        })}
      </div>

      {/* Revenue */}
      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <h3 className="font-medium" style={{ color: 'var(--text-muted)' }}>Revenue log</h3>
          <button type="button" className="btn text-sm" onClick={() => setShowRevenueForm((s) => !s)}>
            {showRevenueForm ? 'Cancel' : '+ Log revenue'}
          </button>
        </div>

        {showRevenueForm && (
          <form onSubmit={handleAddRevenue} className="space-y-2 rounded-lg p-3" style={{ border: '1px solid var(--border-soft)' }}>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
              <input className="input" type="date" value={revenueDate} onChange={(e) => setRevenueDate(e.target.value)} required />
              <select className="input" value={revenueSource} onChange={(e) => setRevenueSource(e.target.value as RevenueSource)}>
                {REVENUE_SOURCES.map((s) => <option key={s} value={s}>{REVENUE_SOURCE_LABELS[s]}</option>)}
              </select>
              <input className="input" type="number" step="0.01" min="0" placeholder="Gross $" value={grossDollars} onChange={(e) => setGrossDollars(e.target.value)} required />
              <select className="input" value={revenueAgreementId} onChange={(e) => setRevenueAgreementId(e.target.value)}>
                <option value="">No agreement link</option>
                {agreements?.map((a) => (
                  <option key={a.id} value={a.id}>{AGREEMENT_TYPE_LABELS[a.type]} ({a.commission_pct ?? 0}%)</option>
                ))}
              </select>
            </div>
            <textarea className="input min-h-[50px]" placeholder="Notes…" value={revenueNotes} onChange={(e) => setRevenueNotes(e.target.value)} />
            <button type="submit" className="btn btn-primary" disabled={savingRevenue}>
              {savingRevenue ? 'Saving…' : 'Log revenue'}
            </button>
          </form>
        )}

        {revenue?.length === 0 && !showRevenueForm && (
          <p className="text-sm" style={{ color: 'var(--text-faint)' }}>No revenue logged yet.</p>
        )}

        {revenue && revenue.length > 0 && (
          <div className="max-h-64 overflow-y-auto text-sm">
            <table className="w-full">
              <thead className="text-left">
                <tr>
                  <th className="font-normal pb-1" style={{ color: 'var(--text-faint)' }}>Date</th>
                  <th className="font-normal pb-1" style={{ color: 'var(--text-faint)' }}>Source</th>
                  <th className="font-normal pb-1 text-right" style={{ color: 'var(--text-faint)' }}>Gross</th>
                  <th className="font-normal pb-1 text-right" style={{ color: 'var(--text-faint)' }}>Commission</th>
                  <th className="font-normal pb-1"></th>
                </tr>
              </thead>
              <tbody>
                {revenue.map((r) => (
                  <tr key={r.id} style={{ borderTop: '1px solid var(--border-soft)' }}>
                    <td className="num py-1" style={{ color: 'var(--text-muted)' }}>{r.recorded_at}</td>
                    <td className="py-1" style={{ color: 'var(--text-muted)' }}>{REVENUE_SOURCE_LABELS[r.source]}</td>
                    <td className="num py-1 text-right">{formatCents(r.gross_amount_cents)}</td>
                    <td className="num py-1 text-right" style={{ color: 'var(--text-muted)' }}>
                      {r.commission_amount_cents != null ? formatCents(r.commission_amount_cents) : '—'}
                    </td>
                    <td className="py-1 text-right">
                      <button type="button" className="hover:opacity-80" style={{ color: 'var(--text-faint)' }} onClick={() => handleDeleteRevenue(r.id)} aria-label="Delete entry">✕</button>
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
