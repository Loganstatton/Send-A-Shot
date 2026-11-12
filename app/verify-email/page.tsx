import VerifyEmailStatus from '@/components/VerifyEmailStatus';

export const dynamic = 'force-dynamic';

export default async function VerifyEmailPage(props: { searchParams: Promise<{ token?: string }> }) {
  const searchParams = await props.searchParams;
  return <VerifyEmailStatus token={searchParams.token ?? ''} />;
}
