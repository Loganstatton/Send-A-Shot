import type { Metadata } from 'next';
import Link from 'next/link';
import { requireUser } from '@/lib/auth';
import { safeReturnPath } from '@/lib/return-path';
import FeedbackForm from '@/components/next/FeedbackForm';

export const metadata: Metadata = { title: 'Send feedback', robots: { index: false } };
export const dynamic = 'force-dynamic';

export default async function FeedbackPage(props: { searchParams: Promise<{ from?: string }> }) {
  await requireUser();
  const { from } = await props.searchParams;
  const fromPage = from ? safeReturnPath(from, '') || null : null;
  return (
    <div className="flex flex-col gap-5 max-w-[640px]">
      <div>
        <h1 className="font-display font-bold text-[30px] m-0">Tell us what you think</h1>
        <p className="mt-1 mb-0 text-sm" style={{ color: 'var(--text-muted)' }}>
          NEXT is in beta. Short or long, everything helps us decide what to build next. Answer any or all.
        </p>
      </div>
      <FeedbackForm fromPage={fromPage} />
      <p className="m-0 text-sm" style={{ color: 'var(--text-muted)' }}>
        Thinking about a paid tier? <Link href="/next/pro" className="underline underline-offset-2" style={{ color: 'var(--text)' }}>Tell us what NEXT Pro should include</Link> (nothing is for sale).
      </p>
    </div>
  );
}
