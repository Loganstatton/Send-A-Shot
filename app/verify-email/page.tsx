import VerifyEmailStatus from '@/components/VerifyEmailStatus';

export const dynamic = 'force-dynamic';

export default function VerifyEmailPage({ searchParams }: { searchParams: { token?: string } }) {
  return <VerifyEmailStatus token={searchParams.token ?? ''} />;
}
