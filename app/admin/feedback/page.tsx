import type { Metadata } from 'next';
import { requireAdmin } from '@/lib/auth';
import { getFeedback, getFeedbackSummary } from '@/lib/feedback';
import { getProInterestSummary, PRO_FEATURES, PRO_INTENT, PRO_PRICE_IDEA_CENTS, type ProFeature, type ProIntent } from '@/lib/pro-interest';
import AdminTabs from '@/components/AdminTabs';

export const metadata: Metadata = { title: { absolute: 'Beta feedback — Scout' } };
export const dynamic = 'force-dynamic';

export default async function FeedbackAdminPage() {
  await requireAdmin();
  const [entries, summary, pro] = await Promise.all([getFeedback(), getFeedbackSummary(), getProInterestSummary()]);
  const usd = (c: number | null) => (c == null ? '-' : `$${(c / 100).toFixed(2)}`);
  return (
    <div className="space-y-6">
      <AdminTabs />
      <div>
        <h1 className="text-2xl font-bold">Beta feedback</h1>
        <p className="text-sm" style={{ color: 'var(--text-faint)' }}>From /next/feedback. Newest first.</p>
      </div>
      <div className="card">
        <p className="text-sm">
          {summary.total} {summary.total === 1 ? 'response' : 'responses'} · understood the scoring: <strong>{summary.yes}</strong> yes,{' '}
          <strong>{summary.partly}</strong> partly, <strong>{summary.no}</strong> no
        </p>
      </div>
      <section aria-labelledby="pro-survey" className="card space-y-3">
        <h2 id="pro-survey" className="font-bold text-lg m-0">NEXT Pro survey ({pro.responses} {pro.responses === 1 ? 'response' : 'responses'})</h2>
        <p className="text-sm m-0" style={{ color: 'var(--text-faint)' }}>From /next/pro. Nothing is for sale; this measures interest in a {usd(PRO_PRICE_IDEA_CENTS)}/month tier.</p>
        {pro.responses === 0 ? (
          <p className="text-sm m-0" style={{ color: 'var(--text-muted)' }}>No answers yet.</p>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-sm">
            <div className="space-y-1">
              <p className="m-0 font-semibold">Would pay {usd(PRO_PRICE_IDEA_CENTS)}/month: {pro.wouldPayPct}% (definitely + probably)</p>
              {(Object.keys(PRO_INTENT) as ProIntent[]).map((k) => <p key={k} className="m-0">{PRO_INTENT[k]}: <span className="num">{pro.intentCounts[k]}</span></p>)}
              <p className="m-0 pt-2 font-semibold">Fair-price range (medians)</p>
              <p className="m-0">Bargain {usd(pro.medians.bargain)} · getting expensive {usd(pro.medians.expensive)}</p>
              <p className="m-0" style={{ color: 'var(--text-faint)' }}>Too cheap {usd(pro.medians.tooCheap)} · too expensive {usd(pro.medians.tooExpensive)}</p>
            </div>
            <div className="space-y-1">
              <p className="m-0 font-semibold">Features (would use · most important)</p>
              {(Object.keys(PRO_FEATURES) as ProFeature[]).sort((a, b) => pro.featureCounts[b] - pro.featureCounts[a]).map((k) => (
                <p key={k} className="m-0"><span className="num">{pro.featureCounts[k]} · {pro.topCounts[k]}</span> {PRO_FEATURES[k]}</p>
              ))}
            </div>
            {pro.comments.length > 0 && (
              <div className="md:col-span-2 space-y-1">
                <p className="m-0 font-semibold">Suggestions</p>
                {pro.comments.map((c, i) => <p key={i} className="m-0 whitespace-pre-wrap">&ldquo;{c.comment}&rdquo;</p>)}
              </div>
            )}
          </div>
        )}
      </section>

      <ul className="space-y-3">
        {entries.map((f) => (
          <li key={f.id} className="card space-y-1.5 text-sm">
            <div className="flex justify-between gap-2 flex-wrap text-xs" style={{ color: 'var(--text-faint)' }}>
              <span>{f.user_name ?? 'deleted account'}{f.user_email ? ` <${f.user_email}>` : ''}{f.page ? ` · from ${f.page}` : ''}</span>
              <span>{new Date(f.created_at).toLocaleString()}</span>
            </div>
            {f.understood_scoring && <p>Understood scoring: <strong>{f.understood_scoring}</strong></p>}
            {f.enjoyed && <p><span style={{ color: 'var(--up)' }}>Enjoyed:</span> {f.enjoyed}</p>}
            {f.confused && <p><span style={{ color: 'var(--fire)' }}>Confused / wants:</span> {f.confused}</p>}
          </li>
        ))}
      </ul>
    </div>
  );
}
