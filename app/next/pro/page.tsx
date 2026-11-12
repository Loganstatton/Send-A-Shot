import type { Metadata } from 'next';
import { requireUser } from '@/lib/auth';
import ProSurveyForm from '@/components/next/ProSurveyForm';
import { getMyProInterest, PRO_FEATURES, PRO_INTENT } from '@/lib/pro-interest';

export const metadata: Metadata = { title: 'Help shape NEXT Pro', robots: { index: false } };
export const dynamic = 'force-dynamic';

const dollars = (c: number | null) => (c == null ? '' : (Number(c) / 100).toFixed(2));

export default async function ProSurveyPage() {
  const user = await requireUser();
  const mine = await getMyProInterest(user.id);
  return (
    <div className="flex flex-col gap-5 max-w-[680px]">
      <div className="flex flex-col gap-2">
        <h1 className="font-display font-bold text-[30px] m-0">Help shape NEXT Pro</h1>
        <p className="m-0 text-sm" style={{ color: 'var(--text-muted)' }}>
          We&apos;re considering an optional paid tier. <strong style={{ color: 'var(--text)' }}>It doesn&apos;t exist yet and there&apos;s
          nothing to buy</strong> — we&apos;re asking first, so we only build what people want.
        </p>
        <p className="m-0 text-sm" style={{ color: 'var(--text-muted)' }}>
          Whatever happens, NEXT stays free to play, and Pro would never sell credits or anything that helps you win.
          Everyone competes on the same terms.
        </p>
      </div>
      <ProSurveyForm
        features={PRO_FEATURES}
        intents={PRO_INTENT}
        initial={{
          features: mine?.features ?? [], topFeature: mine?.top_feature ?? '', intent: mine?.intent ?? '',
          tooCheap: dollars(mine?.too_cheap_cents ?? null), bargain: dollars(mine?.bargain_cents ?? null),
          expensive: dollars(mine?.expensive_cents ?? null), tooExpensive: dollars(mine?.too_expensive_cents ?? null),
          comment: mine?.comment ?? '',
        }}
      />
    </div>
  );
}
